import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface QueueEntry {
  rto_code: string;
  rto_name: string;
  contact_email: string;
  subject: string;
  body: string;
  body_html?: string;
  tracked_url: string;
  scheduled_for: string; // ISO timestamp
  status: 'pending' | 'sent' | 'failed';
  error?: string;
  source_file: string;   // path to the approved JSON this came from
  source_index: number;  // index in that file — used to flip status on send
}

const QUEUE_DIR = 'data/queue';

export function saveQueue(entries: QueueEntry[], date: string): string {
  mkdirSync(QUEUE_DIR, { recursive: true });
  const path = join(QUEUE_DIR, `send-queue-${date}.json`);
  writeFileSync(path, JSON.stringify(entries, null, 2));
  return path;
}

export function loadQueue(filePath: string): QueueEntry[] {
  return JSON.parse(readFileSync(filePath, 'utf8')) as QueueEntry[];
}

export function findLatestQueue(): string | null {
  if (!existsSync(QUEUE_DIR)) return null;
  const files = readdirSync(QUEUE_DIR)
    .filter((f) => f.startsWith('send-queue-') && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length > 0 ? join(QUEUE_DIR, files[0]) : null;
}

export function updateQueue(filePath: string, entries: QueueEntry[]): void {
  writeFileSync(filePath, JSON.stringify(entries, null, 2));
}
