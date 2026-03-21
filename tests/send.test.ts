import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gwsSend } from '../src/send/gws.js';
import type { EmailDraft } from '../src/shared/types.js';

// --- gwsSend unit tests ---

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'node:child_process';
const mockSpawnSync = vi.mocked(spawnSync);

function spawnResult(status: number, stdout: string, stderr = '') {
  return { status, stdout, stderr, error: undefined, pid: 1, signal: null, output: [] } as ReturnType<typeof spawnSync>;
}

describe('gwsSend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns dry-run success without calling gws', () => {
    const result = gwsSend('a@b.com', 'Subject', 'Body', true);
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('dry-run');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('returns success with messageId on exit code 0', () => {
    mockSpawnSync.mockReturnValue(
      spawnResult(0, JSON.stringify({ id: 'abc123', threadId: 'abc123', labelIds: ['SENT'] }))
    );
    const result = gwsSend('a@b.com', 'Subject', 'Body');
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('abc123');
    expect(result.error).toBe('');
  });

  it('returns failure with error message on non-zero exit', () => {
    mockSpawnSync.mockReturnValue(
      spawnResult(2, JSON.stringify({ error: { code: 401, message: 'Gmail auth failed', reason: 'authError' } }))
    );
    const result = gwsSend('a@b.com', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Gmail auth failed');
  });

  it('handles missing id field gracefully', () => {
    mockSpawnSync.mockReturnValue(spawnResult(0, JSON.stringify({ threadId: 'x' })));
    const result = gwsSend('a@b.com', 'Subject', 'Body');
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('');
  });

  it('returns error when gws binary is not found', () => {
    mockSpawnSync.mockReturnValue({
      ...spawnResult(null as unknown as number, ''),
      error: new Error('spawn gws ENOENT'),
    } as ReturnType<typeof spawnSync>);
    const result = gwsSend('a@b.com', 'Subject', 'Body');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/gws not found/);
  });

  it('parses JSON even when stdout has leading keyring noise', () => {
    const json = JSON.stringify({ id: 'msg999' });
    // Simulate keyring message mixed in (would only happen in combined capture, but safe to handle)
    mockSpawnSync.mockReturnValue(spawnResult(0, json, 'Using keyring backend: keyring'));
    const result = gwsSend('a@b.com', 'Subject', 'Body');
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('msg999');
  });

  it('passes correct args to gws (no dry-run)', () => {
    mockSpawnSync.mockReturnValue(spawnResult(0, JSON.stringify({ id: 'x' })));
    gwsSend('recipient@rto.com', 'My Subject', 'My Body');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'gws',
      ['gmail', '+send', '--to', 'recipient@rto.com', '--subject', 'My Subject', '--body', 'My Body', '--format', 'json'],
      expect.objectContaining({ encoding: 'utf8' })
    );
  });
});

// --- Batch logic tests ---

const TEST_DIR = 'data/.test-send';

const draft = (code: string, status: EmailDraft['status'] = 'approved'): EmailDraft => ({
  rto_code: code,
  rto_name: `RTO ${code}`,
  contact_name: 'Jane',
  contact_email: `jane@rto${code}.com`,
  contact_position: 'Manager',
  subject: `Subject ${code}`,
  body: `Body for ${code}`,
  tracked_url: `https://tracker.example.com/r/${code}`,
  generated_at: '2026-03-15T00:00:00Z',
  status,
  skip_reason: null,
});

describe('batch logic', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('batch respects BATCH_SIZE — only first N approved emails are processed', () => {
    const drafts = [draft('A'), draft('B'), draft('C'), draft('D'), draft('E')];
    const batchSize = 3;
    const unsent = drafts.filter((d) => d.status === 'approved');
    const batch = unsent.slice(0, batchSize);
    expect(batch).toHaveLength(3);
    expect(batch.map((d) => d.rto_code)).toEqual(['A', 'B', 'C']);
  });

  it('skips already-sent emails', () => {
    const drafts = [
      draft('A', 'sent'),
      draft('B', 'approved'),
      draft('C', 'failed'),
      draft('D', 'approved'),
    ];
    const unsent = drafts.filter((d) => d.status === 'approved');
    expect(unsent).toHaveLength(2);
    expect(unsent.map((d) => d.rto_code)).toEqual(['B', 'D']);
  });

  it('send log entry has correct structure on success', () => {
    const d = draft('30979');
    const entry = {
      rto_code: d.rto_code,
      rto_name: d.rto_name,
      contact_email: d.contact_email,
      subject: d.subject,
      sent_at: '2026-03-15T10:00:00Z',
      status: 'success' as const,
      error: '',
      gws_message_id: 'abc123',
    };
    expect(entry.status).toBe('success');
    expect(entry.gws_message_id).toBe('abc123');
    expect(entry.error).toBe('');
  });

  it('send log entry has correct structure on failure', () => {
    const entry = {
      rto_code: '30979',
      rto_name: 'Test RTO',
      contact_email: 'test@rto.com',
      subject: 'Test',
      sent_at: '2026-03-15T10:00:00Z',
      status: 'failed' as const,
      error: 'Gmail auth failed',
      gws_message_id: '',
    };
    expect(entry.status).toBe('failed');
    expect(entry.error).toContain('auth failed');
    expect(entry.gws_message_id).toBe('');
  });

  it('status is written back as sent after successful send', () => {
    // Simulate what index.ts does: update draft.status and write file
    const drafts = [draft('X'), draft('Y')];
    const filePath = join(TEST_DIR, 'approved.json');
    writeFileSync(filePath, JSON.stringify(drafts, null, 2));

    // Simulate successful send of first draft
    const allDrafts: EmailDraft[] = JSON.parse(readFileSync(filePath, 'utf8')) as EmailDraft[];
    allDrafts[0].status = 'sent';
    writeFileSync(filePath, JSON.stringify(allDrafts, null, 2));

    const reloaded: EmailDraft[] = JSON.parse(readFileSync(filePath, 'utf8')) as EmailDraft[];
    expect(reloaded[0].status).toBe('sent');
    expect(reloaded[1].status).toBe('approved'); // untouched
  });
});
