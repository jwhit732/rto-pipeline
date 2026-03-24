import { program } from 'commander';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readInputCsv, readEnrichedCsv, writeEnrichedCsv } from './csv-io.js';
import { readXlsx } from './xlsx-reader.js';
import { fetchTgaOrganisation, RATE_LIMIT_DELAY_MS, sleep } from './tga-client.js';
import { logger } from '../shared/logger.js';
import { config } from '../shared/config.js';
import type { RtoEnriched, RtoInput } from '../shared/types.js';

program
  .option('--input <path>', 'Input file path (.csv or .xlsx)', config.prospectXlsxPath())
  .option('--dry-run', 'Call API and print results, do not write CSV')
  .option('--from-scratch', 'Ignore existing enriched file and re-enrich everything');

const argStart = process.argv.findIndex((a, i) => i >= 2 && a.startsWith('-'));
program.parse(argStart >= 0 ? process.argv.slice(argStart) : [], { from: 'user' });

const opts = program.opts<{ input: string; dryRun: boolean; fromScratch: boolean }>();

async function loadInput(filePath: string): Promise<RtoInput[]> {
  if (filePath.endsWith('.xlsx')) {
    const { records, alreadyContacted, missingCode } = readXlsx(filePath);
    if (alreadyContacted > 0) logger.info(`Skipped ${alreadyContacted} already-contacted RTOs`);
    if (missingCode > 0) logger.warn(`Skipped ${missingCode} rows with missing RTO code`);
    return records;
  }
  return readInputCsv(filePath);
}

async function enrich(rto: RtoInput): Promise<RtoEnriched> {
  const result = await fetchTgaOrganisation(rto.rto_code);

  if (!result.ok) {
    logger.warn(`${rto.rto_code} (${rto.rto_name}): ${result.error}`);
    return {
      ...rto,
      api_status: '',
      api_name: '',
      scope_count: '',
      scope_summary: '',
      enriched_at: new Date().toISOString(),
      enrichment_error: result.error,
    };
  }

  const { data } = result;
  const scopeCodes = (data.scopes ?? [])
    .map((s) => s.trainingPackageCode)
    .slice(0, 5);

  logger.success(`${rto.rto_code} (${rto.rto_name}): ${data.rtoStatus}, ${data.scopes?.length ?? 0} scopes`);

  return {
    ...rto,
    api_status: data.rtoStatus ?? '',
    api_name: data.name ?? '',
    scope_count: String(data.scopes?.length ?? 0),
    scope_summary: scopeCodes.join(', '),
    enriched_at: new Date().toISOString(),
    enrichment_error: '',
  };
}

async function run() {
  logger.info(`Reading input: ${opts.input}`);
  const rtos = await loadInput(opts.input);

  // Deduplicate by rto_code — keep first occurrence
  const seen = new Set<string>();
  const unique = rtos.filter((r) => {
    if (seen.has(r.rto_code)) return false;
    seen.add(r.rto_code);
    return true;
  });

  if (unique.length < rtos.length) {
    logger.warn(`Removed ${rtos.length - unique.length} duplicate RTO code(s)`);
  }

  // Resume support: if today's enriched file already exists, skip already-enriched RTOs.
  // Pass --from-scratch to ignore the existing file and re-enrich everything.
  const date = new Date().toISOString().slice(0, 10);
  const outPath = join('data/enriched', `rto-enriched-${date}.csv`);

  let previouslyEnriched: RtoEnriched[] = [];
  const alreadyDone = new Set<string>();

  if (!opts.fromScratch && !opts.dryRun && existsSync(outPath)) {
    previouslyEnriched = await readEnrichedCsv(outPath);
    previouslyEnriched.forEach((r) => alreadyDone.add(r.rto_code));
    logger.info(`Resuming — ${previouslyEnriched.length} already enriched, skipping those`);
  }

  const todo = unique.filter((r) => !alreadyDone.has(r.rto_code));

  if (todo.length === 0) {
    logger.success('All RTOs already enriched — nothing to do (use --from-scratch to re-run)');
    return;
  }

  logger.info(`Enriching ${todo.length} of ${unique.length} RTOs...`);

  const enriched: RtoEnriched[] = [];
  let errors = 0;

  for (let i = 0; i < todo.length; i++) {
    const rto = todo[i];
    const result = await enrich(rto);
    if (result.enrichment_error) errors++;
    enriched.push(result);

    if (opts.dryRun && i < 3) {
      console.log(JSON.stringify(result, null, 2));
    }

    // Rate limit between requests, not after the last one
    if (i < todo.length - 1) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  logger.info(`Done. ${todo.length - errors} enriched, ${errors} errors`);

  if (opts.dryRun) {
    logger.warn('Dry run — no file written');
    return;
  }

  await writeEnrichedCsv(outPath, [...previouslyEnriched, ...enriched]);
  logger.success(`Written to ${outPath}`);
}

run().catch((err) => {
  logger.error(String(err));
  process.exit(1);
});
