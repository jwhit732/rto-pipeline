import XLSX from 'xlsx';
import { copyFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { program } from 'commander';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';

const DEFAULT_XLSX = config.prospectXlsxPath();

const CLICK_COLS = ['link_clicks', 'first_click', 'last_click', 'click_synced_at'] as const;
type ClickCol = (typeof CLICK_COLS)[number];

program
  .option('--input <path>', 'Prospect xlsx path', DEFAULT_XLSX)
  .option('--since <duration>', 'Only clicks from last N days e.g. 7d (default: all-time)')
  .option('--dry-run', 'Show what would update without writing');

const argStart = process.argv.findIndex((a, i) => i >= 2 && a.startsWith('-'));
program.parse(argStart >= 0 ? process.argv.slice(argStart) : [], { from: 'user' });

const opts = program.opts<{ input: string; since?: string; dryRun: boolean }>();

interface ClickItem {
  rto_code: string;
  total_clicks: number;
  first_click: string | null;
  last_click: string | null;
}

function parseSince(raw: string): string {
  const match = /^(\d+)d$/.exec(raw);
  if (match) {
    const ms = parseInt(match[1], 10) * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - ms).toISOString();
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) throw new Error(`Invalid --since value: ${raw}`);
  return d.toISOString();
}

async function fetchClicks(sinceIso: string): Promise<ClickItem[]> {
  const url = new URL(`${config.linkTrackerUrl()}/api/clicks/summary`);
  url.searchParams.set('secret', config.cronSecret());
  url.searchParams.set('since', sinceIso);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as { rtos: ClickItem[] };
  return body.rtos;
}

async function run() {
  const sinceIso = opts.since ? parseSince(opts.since) : '2000-01-01T00:00:00.000Z';

  logger.info(`Fetching click data (since ${sinceIso})...`);
  const clicks = await fetchClicks(sinceIso);
  logger.info(`Got ${clicks.length} RTOs with clicks from API`);

  if (clicks.length === 0) {
    logger.warn('No click data returned — nothing to update');
    return;
  }

  // Build lookup: rto_code → click data
  const clickMap = new Map<string, ClickItem>(clicks.map((c) => [String(c.rto_code), c]));

  // Read xlsx
  const wb = XLSX.readFile(opts.input);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];

  // Read as AOA to access header row and data for comparison
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  if (aoa.length === 0) throw new Error('Spreadsheet is empty');

  const headers = aoa[0] as string[];
  const codeIdx = headers.indexOf('code');
  if (codeIdx === -1) throw new Error('No "code" column found in spreadsheet');

  // Find or plan new column indices
  const colIdx: Record<ClickCol, number> = {} as Record<ClickCol, number>;
  let nextCol = headers.length;
  for (const col of CLICK_COLS) {
    const idx = headers.indexOf(col);
    colIdx[col] = idx === -1 ? nextCol++ : idx;
  }

  // Extend sheet range and add header cells for any new columns
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const newMaxCol = Math.max(range.e.c, nextCol - 1);
  if (newMaxCol > range.e.c) {
    range.e.c = newMaxCol;
    range.e.r = Math.max(range.e.r, aoa.length - 1);
    sheet['!ref'] = XLSX.utils.encode_range(range);
  }
  for (const col of CLICK_COLS) {
    if (headers.indexOf(col) === -1) {
      sheet[XLSX.utils.encode_cell({ r: 0, c: colIdx[col] })] = { v: col, t: 's' };
    }
  }

  // Update rows — only touch click cells
  let updatedCount = 0;
  let newClicksTotal = 0;
  const now = new Date().toISOString();

  for (let rowIdx = 1; rowIdx < aoa.length; rowIdx++) {
    const row = aoa[rowIdx] as unknown[];
    const code = row[codeIdx] != null ? String(row[codeIdx]) : '';
    if (!code) continue;

    const clickData = clickMap.get(code);
    if (!clickData) continue; // Skip RTOs not in API response

    // Only update if click count has changed
    const existingCell = sheet[XLSX.utils.encode_cell({ r: rowIdx, c: colIdx['link_clicks'] })];
    const existingCount = existingCell?.v != null ? Number(existingCell.v) : 0;
    if (clickData.total_clicks === existingCount) continue;

    const delta = clickData.total_clicks - existingCount;
    newClicksTotal += delta;

    if (opts.dryRun) {
      logger.info(`[dry-run] ${code}: ${existingCount} → ${clickData.total_clicks} clicks`);
    }

    // Write directly to sheet cells to preserve all other cell formatting
    const set = (col: ClickCol, v: string | number, t: string) => {
      sheet[XLSX.utils.encode_cell({ r: rowIdx, c: colIdx[col] })] = { v, t };
    };
    set('link_clicks', clickData.total_clicks, 'n');
    set('first_click', clickData.first_click ?? '', 's');
    set('last_click', clickData.last_click ?? '', 's');
    set('click_synced_at', now, 's');

    updatedCount++;
  }

  logger.info(`Updated ${updatedCount} RTOs. ${newClicksTotal} new clicks since last sync.`);

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
