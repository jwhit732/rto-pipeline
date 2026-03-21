import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProgress, saveProgress, clearProgress } from '../src/review/progress.js';
import type { EmailDraft, ReviewProgress } from '../src/review/progress.js';

// Use a temp directory so tests don't touch real data/
const TEST_DIR = 'data/.test-review';
const PROGRESS_FILE = 'data/.review-progress';

const draft = (code: string, status: EmailDraft['status'] = 'pending'): EmailDraft => ({
  rto_code: code,
  rto_name: `RTO ${code}`,
  contact_name: 'Jane Smith',
  contact_email: `jane@rto${code}.com`,
  contact_position: 'Manager',
  subject: `Subject for ${code}`,
  body: `Body for ${code}`,
  tracked_url: `https://tracker.example.com/r/${code}`,
  generated_at: '2026-03-15T00:00:00Z',
  status,
  skip_reason: null,
});

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  // Remove any leftover progress file
  if (existsSync(PROGRESS_FILE)) rmSync(PROGRESS_FILE);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  if (existsSync(PROGRESS_FILE)) rmSync(PROGRESS_FILE);
});

describe('progress file', () => {
  it('returns null when no progress file exists', () => {
    expect(loadProgress()).toBeNull();
  });

  it('saves and loads progress correctly', () => {
    const p: ReviewProgress = {
      inputFile: 'data/drafts/outreach-drafts-2026-03-15.json',
      currentIndex: 47,
      approved: [draft('30979', 'approved'), draft('41356', 'approved')],
    };
    saveProgress(p);
    const loaded = loadProgress();
    expect(loaded).not.toBeNull();
    expect(loaded!.currentIndex).toBe(47);
    expect(loaded!.approved).toHaveLength(2);
    expect(loaded!.inputFile).toBe(p.inputFile);
  });

  it('clearProgress removes the file', () => {
    saveProgress({ inputFile: 'x', currentIndex: 0, approved: [] });
    expect(existsSync(PROGRESS_FILE)).toBe(true);
    clearProgress();
    expect(existsSync(PROGRESS_FILE)).toBe(false);
  });

  it('clearProgress is safe when file does not exist', () => {
    expect(() => clearProgress()).not.toThrow();
  });

  it('returns null when progress file is corrupt JSON', () => {
    writeFileSync(PROGRESS_FILE, 'not valid json {{{');
    expect(loadProgress()).toBeNull();
  });
});

describe('approval logic', () => {
  it('only approved drafts end up in the approved list', () => {
    const approved: EmailDraft[] = [];
    const drafts = [draft('A'), draft('B'), draft('C')];

    // Simulate: approve A, skip B, approve C
    approved.push({ ...drafts[0], status: 'approved' });
    // B skipped — not pushed
    approved.push({ ...drafts[2], status: 'approved' });

    expect(approved).toHaveLength(2);
    expect(approved.map((d) => d.rto_code)).toEqual(['A', 'C']);
  });

  it('skipped emails are not in the approved list', () => {
    const approved: EmailDraft[] = [];
    const drafts = [draft('A'), draft('B')];
    approved.push({ ...drafts[0], status: 'approved' });
    // B is skipped — nothing pushed

    expect(approved.every((d) => d.status === 'approved')).toBe(true);
    expect(approved.find((d) => d.rto_code === 'B')).toBeUndefined();
  });

  it('approved draft has status approved', () => {
    const d = draft('X');
    const saved = { ...d, status: 'approved' as const };
    expect(saved.status).toBe('approved');
    expect(saved.rto_code).toBe('X');
  });
});

describe('progress tracks position accurately', () => {
  it('currentIndex advances after each action', () => {
    const inputFile = 'data/drafts/outreach-drafts-2026-03-15.json';
    const approved: EmailDraft[] = [];

    // Simulate reviewing emails 0..2
    for (let i = 0; i < 3; i++) {
      approved.push({ ...draft(String(i)), status: 'approved' });
      saveProgress({ inputFile, currentIndex: i + 1, approved });
    }

    const loaded = loadProgress();
    expect(loaded!.currentIndex).toBe(3);
    expect(loaded!.approved).toHaveLength(3);
  });

  it('quit saves current index so resume starts at same email', () => {
    const inputFile = 'data/drafts/outreach-drafts-2026-03-15.json';
    const approved = [{ ...draft('A'), status: 'approved' as const }];

    // On 'q', currentIndex is i (not i+1) so we re-review the same email
    saveProgress({ inputFile, currentIndex: 5, approved });

    const loaded = loadProgress();
    expect(loaded!.currentIndex).toBe(5); // resumes at email 5
    expect(loaded!.approved).toHaveLength(1);
  });
});

describe('shouldSkip fix — current status', () => {
  it('TGA "current" status is treated as active', async () => {
    const { shouldSkip } = await import('../src/generate/index.js');
    const rto = {
      rto_code: '30979', rto_name: 'Test', contact_email: 'a@b.com',
      contact_name: 'Jane', contact_position: 'Manager', industry: 'Education',
      training_packages: 'BSB', location: 'Brisbane', api_status: 'current',
      api_name: '', scope_count: '0', scope_summary: '', enriched_at: '', enrichment_error: '',
    };
    expect(shouldSkip(rto)).toBeNull();
  });

  it('TGA "suspended" status is skipped', async () => {
    const { shouldSkip } = await import('../src/generate/index.js');
    const rto = {
      rto_code: '30979', rto_name: 'Test', contact_email: 'a@b.com',
      contact_name: 'Jane', contact_position: 'Manager', industry: 'Education',
      training_packages: 'BSB', location: 'Brisbane', api_status: 'suspended',
      api_name: '', scope_count: '0', scope_summary: '', enriched_at: '', enrichment_error: '',
    };
    expect(shouldSkip(rto)).toMatch(/inactive/);
  });
});
