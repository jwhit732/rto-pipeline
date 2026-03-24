import { program } from 'commander';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stringify } from 'csv-stringify/sync';
import { gwsSend, gwsSendHtml } from './gws.js';
import { buildSchedule, formatAest, isInSendWindow, nextWindowStart, summariseSchedule } from './scheduler.js';
import { findLatestQueue, loadQueue, saveQueue, updateQueue, type QueueEntry } from './queue.js';
import { logger } from '../shared/logger.js';
import { config } from '../shared/config.js';
import type { EmailDraft, SendLogEntry } from '../shared/types.js';

program
  .option('--input <path>', 'Approved JSON path (defaults to latest in data/approved/)')
  .option('--dry-run', 'Print what would be sent without calling gws')
  .option('--schedule', 'Queue emails spread across next Mon-Thu 9-11 AM AEST window')
  .option('--process-queue [path]', 'Send queued emails whose scheduled time has passed')
  .option('--no-sync', 'Skip auto-sync to prospect spreadsheet after sending')
  .allowExcessArguments(true);

program.parse(process.argv);

const cmdOpts = program.opts<{
  input?: string;
  dryRun: boolean;
  schedule: boolean;
  processQueue?: string | boolean;
  sync: boolean;
}>();
const dryRun = cmdOpts.dryRun || process.env.npm_config_dry_run != null;

/** Find approved emails — checks data/approved/ first, falls back to drafts with status "approved" */
function findLatestApproved(): string {
  // First check for explicit approved files
  const approvedDir = 'data/approved';
  if (existsSync(approvedDir)) {
    const files = readdirSync(approvedDir)
      .filter((f) => f.startsWith('outreach-approved-') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length > 0) return join(approvedDir, files[0]);
  }

  // Fallback: check drafts for any with status "approved" and copy them to approved/
  const draftsDir = 'data/drafts';
  if (existsSync(draftsDir)) {
    const draftFiles = readdirSync(draftsDir)
      .filter((f) => f.startsWith('outreach-drafts-') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of draftFiles) {
      const path = join(draftsDir, file);
      const drafts = JSON.parse(readFileSync(path, 'utf8')) as EmailDraft[];
      const approved = drafts.filter((d) => d.status === 'approved');
      if (approved.length > 0) {
        const date = file.replace('outreach-drafts-', '').replace('.json', '');
        const approvedPath = join(approvedDir, `outreach-approved-${date}.json`);
        writeFileSync(approvedPath, JSON.stringify(approved, null, 2));
        logger.info(`Created ${approvedPath} from ${approved.length} approved drafts`);
        return approvedPath;
      }
    }
  }

  throw new Error('No approved emails found in data/approved/ or data/drafts/ — run review first');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendDraft(draft: EmailDraft | QueueEntry, dryRunMode: boolean) {
  const from = config.gwsSendFrom();
  if (draft.body_html) {
    return gwsSendHtml(from, draft.contact_email, draft.subject, draft.body, draft.body_html, dryRunMode);
  }
  return gwsSend(draft.contact_email, draft.subject, draft.body, dryRunMode);
}

function writeLog(log: SendLogEntry[]) {
  const datetime = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  const logPath = join('data/logs', `send-log-${datetime}.csv`);
  const cols: (keyof SendLogEntry)[] = [
    'rto_code', 'rto_name', 'contact_email', 'subject',
    'sent_at', 'status', 'error', 'gws_message_id',
  ];
  writeFileSync(logPath, stringify(log, { header: true, columns: cols }));
  logger.success(`Send log written to ${logPath}`);
}

// ── --schedule ───────────────────────────────────────────────────────────────
async function runSchedule(inputFile: string) {
  const allDrafts = JSON.parse(readFileSync(inputFile, 'utf8')) as EmailDraft[];
  const unsent = allDrafts.filter((d) => d.status === 'approved');

  if (unsent.length === 0) {
    logger.warn('No approved emails to schedule');
    return;
  }

  const now = new Date();
  const windowStart = isInSendWindow(now) ? now : nextWindowStart(now);

  if (!isInSendWindow(now)) {
    logger.info(`Outside send window. Next window opens: ${formatAest(windowStart)}`);
  }

  const timestamps = buildSchedule(unsent.length, windowStart);
  const date = now.toISOString().slice(0, 10);

  const entries: QueueEntry[] = unsent.map((draft, i) => ({
    rto_code: draft.rto_code,
    rto_name: draft.rto_name,
    contact_email: draft.contact_email,
    subject: draft.subject,
    body: draft.body,
    body_html: draft.body_html,
    tracked_url: draft.tracked_url,
    scheduled_for: timestamps[i],
    status: 'pending' as const,
    source_file: inputFile,
    source_index: allDrafts.indexOf(draft),
  }));

  const queuePath = saveQueue(entries, date);
  logger.success(`${unsent.length} emails queued: ${summariseSchedule(timestamps)}`);
  logger.info(`Queue file: ${queuePath}`);
  logger.info('Run "npm run send -- --process-queue" during the window to send.');
}

// ── --process-queue ──────────────────────────────────────────────────────────
async function runProcessQueue(queuePath: string) {
  const entries = loadQueue(queuePath);
  const now = new Date();
  const due = entries.filter((e) => e.status === 'pending' && new Date(e.scheduled_for) <= now);
  const pending = entries.filter((e) => e.status === 'pending');

  if (due.length === 0) {
    const next = pending.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))[0];
    const msg = next ? `Next email due: ${formatAest(new Date(next.scheduled_for))}` : 'Queue complete';
    logger.info(msg);
    return;
  }

  logger.info(`Sending ${due.length} due emails (${pending.length - due.length} still pending)`);
  const log: SendLogEntry[] = [];
  let success = 0, fail = 0;

  for (const entry of due) {
    if (dryRun) {
      logger.info(`[dry-run] ${entry.contact_email} — ${entry.rto_name}`);
      continue;
    }

    const result = await sendDraft(entry, false);
    const sentAt = new Date().toISOString();

    if (result.ok) {
      entry.status = 'sent';
      success++;
      logger.success(`${entry.rto_name} <${entry.contact_email}>`);
    } else {
      entry.status = 'failed';
      entry.error = result.error;
      fail++;
      logger.error(`${entry.rto_name}: ${result.error}`);
    }

    log.push({
      rto_code: entry.rto_code, rto_name: entry.rto_name,
      contact_email: entry.contact_email, subject: entry.subject,
      sent_at: sentAt, status: result.ok ? 'success' : 'failed',
      error: result.error ?? '', gws_message_id: result.messageId,
    });

    updateQueue(queuePath, entries);
    await sleep(config.batchDelayMs());
  }

  logger.info(`Done — ${success} sent, ${fail} failed`);
  if (log.length > 0) writeLog(log);
}

// ── normal send ──────────────────────────────────────────────────────────────
async function runSend(inputFile: string) {
  const allDrafts = JSON.parse(readFileSync(inputFile, 'utf8')) as EmailDraft[];
  const unsent = allDrafts.filter((d) => d.status === 'approved');

  if (unsent.length === 0) {
    logger.warn('No approved emails to send — all already sent or failed');
    return;
  }

  const batchSize = config.batchSize();
  const delayMs = config.batchDelayMs();
  const batch = unsent.slice(0, batchSize);

  logger.info(`Sending ${batch.length} of ${unsent.length} (batch: ${batchSize}, delay: ${delayMs}ms)`);
  if (dryRun) logger.warn('Dry run — gws will not be called');

  const log: SendLogEntry[] = [];
  let successCount = 0, failCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const draft = batch[i];
    if (dryRun) {
      logger.info(`[${i + 1}/${batch.length}] Would send: ${draft.rto_name} <${draft.contact_email}>`);
    }

    const result = await sendDraft(draft, dryRun);
    const sentAt = new Date().toISOString();

    log.push({
      rto_code: draft.rto_code, rto_name: draft.rto_name,
      contact_email: draft.contact_email, subject: draft.subject,
      sent_at: sentAt, status: result.ok ? 'success' : 'failed',
      error: result.error, gws_message_id: result.messageId,
    });

    if (result.ok) {
      successCount++;
      draft.status = dryRun ? 'approved' : 'sent';
      if (!dryRun) logger.success(`[${i + 1}/${batch.length}] ${draft.rto_name}`);
    } else {
      failCount++;
      draft.status = 'failed';
      logger.error(`[${i + 1}/${batch.length}] ${draft.rto_name}: ${result.error}`);
    }

    if (!dryRun) {
      writeFileSync(inputFile, JSON.stringify(allDrafts, null, 2));
      process.stdout.write(`\r  ${successCount + failCount}/${batch.length} — ${successCount} sent, ${failCount} failed`);
    }

    if (i < batch.length - 1) await sleep(dryRun ? 0 : delayMs);
  }

  if (!dryRun) console.log();
  logger.info(`Batch complete — ${successCount} sent, ${failCount} failed`);
  const remaining = unsent.length - batch.length;
  if (remaining > 0) logger.info(`${remaining} remaining — run again for next batch`);

  writeLog(log);

  const sheetId = config.sendLogSheetId();
  if (sheetId && !dryRun) {
    const date = new Date().toISOString().slice(0, 10);
    const res = spawnSync('gws', ['sheets', '+append', '--spreadsheet', sheetId,
      '--values', `${date},${batch.length},${successCount},${failCount}`],
      { encoding: 'utf8', env: { ...process.env } });
    if (res.status === 0) logger.info('Batch summary appended to Google Sheet');
    else logger.warn(`Sheets append failed: ${res.stdout?.trim() ?? res.stderr?.trim()}`);
  }

  // Auto-sync send status to prospect spreadsheet
  if (!dryRun && cmdOpts.sync !== false) {
    await autoSyncSends();
  }
}

async function autoSyncSends() {
  try {
    const xlsxPath = config.prospectXlsxPath();
    if (!existsSync(xlsxPath)) {
      logger.warn(`Auto-sync skipped — prospect xlsx not found: ${xlsxPath}`);
      return;
    }
    logger.info('Auto-syncing send status to prospect spreadsheet...');
    const result = spawnSync('node', ['--import', 'tsx', 'src/sync/sync-sends.ts'],
      { encoding: 'utf8', cwd: process.cwd(), env: { ...process.env }, stdio: 'inherit' });
    if (result.status === 0) {
      logger.success('Prospect spreadsheet synced');
    } else {
      logger.warn('Auto-sync failed — run "npm run sync-sends" manually');
    }
  } catch (err) {
    logger.warn(`Auto-sync error: ${err}`);
  }
}

// ── entry point ──────────────────────────────────────────────────────────────
async function run() {
  if (cmdOpts.processQueue !== undefined) {
    const queuePath = typeof cmdOpts.processQueue === 'string'
      ? cmdOpts.processQueue
      : findLatestQueue();
    if (!queuePath) throw new Error('No queue file found — run with --schedule first');
    await runProcessQueue(queuePath);
    return;
  }

  const inputFile = cmdOpts.input ?? findLatestApproved();

  if (cmdOpts.schedule) {
    logger.info('Schedule mode — emails will be queued, not sent immediately');
    await runSchedule(inputFile);
    return;
  }

  await runSend(inputFile);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => { logger.error(String(err)); process.exit(1); });
}
