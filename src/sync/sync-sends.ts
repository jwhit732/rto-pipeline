import XLSX from 'xlsx';
import { copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { program } from 'commander';
import { parse } from 'csv-parse/sync';
import { logger } from '../shared/logger.js';

const DEFAULT_XLSX =
  'D:\\Projects\\OneDrive\\Desktop\\Coding_projects\\prospect_tracker\\prospects\\asqa_rtos_scored.xlsx';

const SEND_COLS = ['email_sent_at', 'email_status', 'email_subject'] as const;
type SendCol = (typeof SEND_COLS)[number];

program
  .option('--input <path>', 'Prospect xlsx path', DEFAULT_XLSX)
  .option('--logs <dir>', 'Send logs directory', 'data/logs')
  .option('--dry-run', 'Show what would update without writing');

const argStart = process.argv.findIndex((a, i) => i >= 2 && a.startsWith('-'));
program.parse(argStart >= 0 ? process.argv.slice(argStart) : [], { from: 'user' });

const opts = program.opts<{ input: string; logs: string; dryRun: boolean }>();

interface SendLogRow {
  rto_code: string;
  rto_name: string;
  contact_email: string;
  subject: string;
  sent_at: string;
  status: string;
  error: string;
  gws_message_id: string;
}

/** Read all send-log CSVs and build a map of rto_code → latest successful send */
function loadSendLogs(logsDir: string): Map<string, SendLogRow> {
  const files = readdirSync(logsDir)
    .filter((f) => f.startsWith('send-log-') && f.endsWith('.csv'))
    .sort();

  const map = new Map<string, SendLogRow>();

  for (const file of files) {
    const csv = readFileSync(join(logsDir, file), 'utf8');
    const rows = parse(csv, { columns: true, skip_empty_lines: true }) as SendLogRow[];

    for (const row of rows) {
      if (!row.rto_code) continue;
      const existing = map.get(row.rto_code);

      // Keep the most recent successful send; if no success, keep the most recent attempt
      if (!existing) {
        map.set(row.rto_code, row);
      } else if (row.status === 'success' && existing.status !== 'success') {
        map.set(row.rto_code, row);
      } else if (row.status === existing.status && row.sent_at > existing.sent_at) {
        map.set(row.rto_code, row);
      }
    }
  }

  return map;
}

async function run() {
  logger.info(`Reading send logs from ${opts.logs}...`);
  const sendMap = loadSendLogs(opts.logs);
  logger.info(`Found ${sendMap.size} RTOs with send records across all logs`);

  if (sendMap.size === 0) {
    logger.warn('No send logs found — nothing to update');
    return;
  }

  // Read xlsx
  const wb = XLSX.readFile(opts.input);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  if (aoa.length === 0) throw new Error('Spreadsheet is empty');

  const headers = aoa[0] as string[];
  const codeIdx = headers.indexOf('code');
  if (codeIdx === -1) throw new Error('No "code" column found in spreadsheet');

  // Find or create column indices
  const colIdx: Record<SendCol, number> = {} as Record<SendCol, number>;
  let nextCol = headers.length;
  for (const col of SEND_COLS) {
    const idx = headers.indexOf(col);
    colIdx[col] = idx === -1 ? nextCol++ : idx;
  }

  // Extend sheet range and add header cells for new columns
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const newMaxCol = Math.max(range.e.c, nextCol - 1);
  if (newMaxCol > range.e.c) {
    range.e.c = newMaxCol;
    range.e.r = Math.max(range.e.r, aoa.length - 1);
    sheet['!ref'] = XLSX.utils.encode_range(range);
  }
  for (const col of SEND_COLS) {
    if (headers.indexOf(col) === -1) {
      sheet[XLSX.utils.encode_cell({ r: 0, c: colIdx[col] })] = { v: col, t: 's' };
    }
  }

  // Update rows
  let updatedCount = 0;

  for (let rowIdx = 1; rowIdx < aoa.length; rowIdx++) {
    const row = aoa[rowIdx] as unknown[];
    const code = row[codeIdx] != null ? String(row[codeIdx]) : '';
    if (!code) continue;

    const sendData = sendMap.get(code);
    if (!sendData) continue;

    // Only update if status or timestamp has changed
    const existingCell = sheet[XLSX.utils.encode_cell({ r: rowIdx, c: colIdx['email_sent_at'] })];
    const existingSentAt = existingCell?.v != null ? String(existingCell.v) : '';
    if (existingSentAt === sendData.sent_at) continue;

    if (opts.dryRun) {
      const label = existingSentAt ? `${existingSentAt} → ${sendData.sent_at}` : 'new';
      logger.info(`[dry-run] ${code} (${sendData.rto_name}): ${sendData.status} (${label})`);
    }

    const set = (col: SendCol, v: string | number, t: string) => {
      sheet[XLSX.utils.encode_cell({ r: rowIdx, c: colIdx[col] })] = { v, t };
    };
    set('email_sent_at', sendData.sent_at, 's');
    set('email_status', sendData.status, 's');
    set('email_subject', sendData.subject, 's');

    updatedCount++;
  }

  logger.info(`${updatedCount} RTOs to update`);

  if (opts.dryRun) {
    logger.warn('Dry run — no file written');
    return;
  }

  if (updatedCount === 0) {
    logger.info('No changes — skipping write');
    return;
  }

  // Backup before writing
  const date = new Date().toISOString().slice(0, 10);
  const dir = dirname(opts.input);
  const base = basename(opts.input, '.xlsx');
  const backupPath = join(dir, `${base}.backup-${date}.xlsx`);
  copyFileSync(opts.input, backupPath);
  logger.info(`Backup saved to ${basename(backupPath)}`);

  XLSX.writeFile(wb, opts.input);
  logger.success(`Spreadsheet updated: ${opts.input}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    logger.error(String(err));
    process.exit(1);
  });
}
