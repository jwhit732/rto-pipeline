import 'dotenv/config';

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
} as const;

// Lazy validation — call this at the start of scripts that need specific vars
export function requireConfig(...keys: (keyof typeof config)[]): void {
  for (const key of keys) {
    config[key](); // throws if missing
  }
}
