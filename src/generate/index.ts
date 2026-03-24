import { program } from 'commander';
import { createReadStream, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'csv-parse';
import Anthropic from '@anthropic-ai/sdk';
import { generateEmail } from './claude-client.js';
import { logger } from '../shared/logger.js';
import { config, requireConfig } from '../shared/config.js';
import type { RtoEnriched, EmailDraft } from '../shared/types.js';

program
  .option('--input <path>', 'Enriched CSV path (defaults to latest in data/enriched/)')
  .option('--dry-run', 'Generate emails but do not write JSON (prints first 3)')
  .option('--limit <n>', 'Process at most N RTOs', (v) => parseInt(v, 10))
  .option('--include-test', 'Include test RTOs (codes 99000+) — excluded by default')
  .allowExcessArguments(true)
  .parse(process.argv);

const cmdOpts = program.opts<{ input?: string; dryRun: boolean; limit?: number; includeTest: boolean }>();

const dryRun = cmdOpts.dryRun || process.env.npm_config_dry_run != null;
const orphan = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const limit = cmdOpts.limit ?? (orphan !== undefined ? parseInt(orphan, 10) : undefined);
const includeTest = cmdOpts.includeTest ?? false;
const opts = { input: cmdOpts.input, dryRun, limit };

export function shouldSkip(rto: RtoEnriched): string | null {
  if (!rto.contact_email?.trim()) return 'no contact email';
  if (rto.api_status && !/^(active|current)$/i.test(rto.api_status.trim())) {
    return `inactive api_status: ${rto.api_status}`;
  }
  return null;
}

function findLatestEnrichedCsv(): string {
  const dir = 'data/enriched';
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('rto-enriched-') && f.endsWith('.csv'))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error('No enriched CSV found in data/enriched/ — run npm run enrich first');
  }
  return join(dir, files[0]);
}

async function readEnrichedCsv(filePath: string): Promise<RtoEnriched[]> {
  return new Promise((resolve, reject) => {
    const records: RtoEnriched[] = [];
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on('data', (row: RtoEnriched) => records.push(row))
      .on('end', () => resolve(records))
      .on('error', reject);
  });
}

// Calls POST /api/links/create for a batch of RTOs.
// Returns a map of rto_code → full tracked URL.
// Chunks into 100s to avoid oversized payloads.
const LINK_CHUNK_SIZE = 100;

async function createTrackedLinks(rtos: RtoEnriched[]): Promise<Map<string, string>> {
  const trackerBase = config.linkTrackerUrl();
  const secret = config.cronSecret();
  const destUrl = config.linkTrackerDestUrl();
  const urlMap = new Map<string, string>();

  for (let i = 0; i < rtos.length; i += LINK_CHUNK_SIZE) {
    const chunk = rtos.slice(i, i + LINK_CHUNK_SIZE);
    const res = await fetch(
      `${trackerBase}/api/links/create?secret=${encodeURIComponent(secret)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination_url: destUrl,
          rtos: chunk.map((r) => ({ rto_code: r.rto_code, rto_name: r.rto_name })),
        }),
      }
    );

    if (!res.ok) {
      throw new Error(`Link creation API returned ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { links: { rto_code: string; tracked_url: string }[] };
    for (const link of data.links) {
      urlMap.set(link.rto_code, `${trackerBase}${link.tracked_url}`);
    }

    if (rtos.length > LINK_CHUNK_SIZE) {
      logger.info(`Links: registered ${Math.min(i + LINK_CHUNK_SIZE, rtos.length)}/${rtos.length}`);
    }
  }

  return urlMap;
}

function buildDraft(
  rto: RtoEnriched,
  trackedUrl: string,
  subject: string,
  body: string,
  bodyHtml: string | undefined,
  status: EmailDraft['status'],
  skipReason: string | null
): EmailDraft {
  return {
    rto_code: rto.rto_code,
    rto_name: rto.rto_name,
    contact_name: rto.contact_name,
    contact_email: rto.contact_email,
    contact_position: rto.contact_position,
    subject,
    body,
    ...(bodyHtml ? { body_html: bodyHtml } : {}),
    tracked_url: trackedUrl,
    generated_at: new Date().toISOString(),
    status,
    skip_reason: skipReason,
  };
}

/** Collect RTO codes that already have drafts or have been sent. */
function alreadyProcessedCodes(): Set<string> {
  const codes = new Set<string>();

  // Check all existing draft files
  const draftsDir = 'data/drafts';
  try {
    for (const f of readdirSync(draftsDir)) {
      if (f.startsWith('outreach-drafts-') && f.endsWith('.json')) {
        const drafts = JSON.parse(readFileSync(join(draftsDir, f), 'utf8')) as { rto_code: string }[];
        for (const d of drafts) codes.add(d.rto_code);
      }
    }
  } catch { /* no drafts dir yet */ }

  // Check all existing approved files
  const approvedDir = 'data/approved';
  try {
    for (const f of readdirSync(approvedDir)) {
      if (f.startsWith('outreach-approved-') && f.endsWith('.json')) {
        const approved = JSON.parse(readFileSync(join(approvedDir, f), 'utf8')) as { rto_code: string }[];
        for (const a of approved) codes.add(a.rto_code);
      }
    }
  } catch { /* no approved dir yet */ }

  return codes;
}

async function run() {
  requireConfig('anthropicApiKey', 'linkTrackerUrl', 'linkTrackerDestUrl', 'cronSecret');

  const inputPath = opts.input ?? findLatestEnrichedCsv();
  logger.info(`Reading enriched CSV: ${inputPath}`);

  const all = await readEnrichedCsv(inputPath);

  // Filter out RTOs that already have drafts or have been sent
  const processed = alreadyProcessedCodes();
  let remaining = all.filter((r) => !processed.has(r.rto_code));
  if (processed.size > 0) {
    logger.info(`Skipped ${processed.size} already-processed RTOs`);
  }

  // Filter out test RTOs (codes 99000+) unless --include-test is passed
  if (!includeTest) {
    const before = remaining.length;
    remaining = remaining.filter((r) => {
      const code = parseInt(r.rto_code, 10);
      return isNaN(code) || code < 99000;
    });
    const testCount = before - remaining.length;
    if (testCount > 0) logger.info(`Skipped ${testCount} test RTOs (use --include-test to include)`);
  }

  const rtos = opts.limit ? remaining.slice(0, opts.limit) : remaining;
  logger.info(`Processing ${rtos.length} RTOs${opts.limit ? ` (limited to ${opts.limit})` : ''}`);

  // Split into skippable and to-generate before hitting any APIs
  const toGenerate: RtoEnriched[] = [];
  const skipped: EmailDraft[] = [];

  for (const rto of rtos) {
    const skipReason = shouldSkip(rto);
    if (skipReason) {
      logger.warn(`Skipping ${rto.rto_code} (${rto.rto_name}): ${skipReason}`);
      skipped.push(buildDraft(rto, '', '', '', undefined, 'skipped', skipReason));
    } else {
      toGenerate.push(rto);
    }
  }

  if (toGenerate.length === 0) {
    logger.warn('No RTOs to generate emails for');
    return;
  }

  // Register tracked links before generating — ensures clicks resolve correctly
  logger.info(`Registering ${toGenerate.length} tracked links...`);
  let urlMap: Map<string, string>;
  if (opts.dryRun) {
    // In dry-run, build URLs without hitting the API
    const base = config.linkTrackerUrl();
    urlMap = new Map(toGenerate.map((r) => [r.rto_code, `${base}/r/${r.rto_code}`]));
  } else {
    urlMap = await createTrackedLinks(toGenerate);
    logger.success(`Tracked links registered (${urlMap.size})`);
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey() });
  const senderName = config.senderName();
  const date = new Date().toISOString().slice(0, 10);
  const drafts: EmailDraft[] = [];
  let errors = 0;

  for (let i = 0; i < toGenerate.length; i++) {
    const rto = toGenerate[i];
    const trackedUrl = urlMap.get(rto.rto_code);

    if (!trackedUrl) {
      logger.warn(`${rto.rto_code}: no tracked link returned — skipping`);
      skipped.push(buildDraft(rto, '', '', '', undefined, 'skipped', 'tracked link not created'));
      continue;
    }

    const result = await generateEmail(client, rto, trackedUrl, senderName);

    if (!result.ok) {
      logger.error(`${rto.rto_code} (${rto.rto_name}): ${result.error}`);
      skipped.push(buildDraft(rto, trackedUrl, '', '', undefined, 'skipped', result.error));
      errors++;
      continue;
    }

    logger.success(`${rto.rto_code} (${rto.rto_name}): generated`);
    const draft = buildDraft(rto, trackedUrl, result.subject, result.body, result.bodyHtml, 'pending', null);
    drafts.push(draft);

    if (opts.dryRun && drafts.length <= 3) {
      console.log(`\n--- ${rto.rto_name} ---`);
      console.log(`Subject: ${result.subject}`);
      console.log(result.body);
    }
  }

  logger.info(`Done. ${drafts.length} drafts, ${skipped.length} skipped, ${errors} errors`);

  if (opts.dryRun) {
    logger.warn('Dry run — no files written');
    return;
  }

  const draftsPath = join('data/drafts', `outreach-drafts-${date}.json`);
  writeFileSync(draftsPath, JSON.stringify(drafts, null, 2));
  logger.success(`Drafts written to ${draftsPath}`);

  if (skipped.length > 0) {
    const skippedPath = join('data/drafts', `skipped-${date}.json`);
    writeFileSync(skippedPath, JSON.stringify(skipped, null, 2));
    logger.info(`Skipped written to ${skippedPath}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    logger.error(String(err));
    process.exit(1);
  });
}
