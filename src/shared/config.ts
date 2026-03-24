import dotenv from 'dotenv';
dotenv.config({ override: true });

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const val = process.env[name];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
}

/** Resolve prospect xlsx path with OS-aware fallback.
 *  Checks PROSPECT_XLSX_PATH first, then PROSPECT_XLSX_PATH_LINUX on non-Windows. */
function resolveProspectPath(): string {
  const primary = process.env['PROSPECT_XLSX_PATH'];
  const linuxFallback = process.env['PROSPECT_XLSX_PATH_LINUX'];

  if (primary && !primary.includes('\\')) return primary; // already a Unix path
  if (primary && process.platform === 'win32') return primary; // Windows path on Windows — fine
  if (linuxFallback && process.platform !== 'win32') return linuxFallback; // Linux fallback
  if (primary) return primary; // use whatever is set
  throw new Error('Missing required environment variable: PROSPECT_XLSX_PATH');
}

export const config = {
  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),
  linkTrackerUrl: () => required('LINK_TRACKER_URL'),
  cronSecret: () => required('CRON_SECRET'),
  linkTrackerDestUrl: () => required('LINK_TRACKER_DEST_URL'),
  gwsSendFrom: () => required('GWS_SEND_FROM'),
  batchSize: () => optionalInt('BATCH_SIZE', 50),
  batchDelayMs: () => optionalInt('BATCH_DELAY_MS', 2000),
  senderName: () => optional('SENDER_NAME'),
  sendLogSheetId: () => optional('SEND_LOG_SHEET_ID'),
  digestToEmail: () => optional('DIGEST_TO_EMAIL'),
  prospectXlsxPath: () => resolveProspectPath(),
} as const;

// Lazy validation — call this at the start of scripts that need specific vars
export function requireConfig(...keys: (keyof typeof config)[]): void {
  for (const key of keys) {
    config[key](); // throws if missing
  }
}
