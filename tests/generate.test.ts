import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseClaudeResponse, buildUserPrompt, generateEmail, MODEL } from '../src/generate/claude-client.js';
import { shouldSkip } from '../src/generate/index.js';
import type { RtoEnriched } from '../src/shared/types.js';

const baseRto: RtoEnriched = {
  rto_code: '30979',
  rto_name: 'Building Trades Australia',
  contact_email: 'jane@bta.edu.au',
  contact_name: 'Jane Smith',
  contact_position: 'Training Manager',
  industry: 'Construction',
  training_packages: 'CPC40120',
  location: 'Brisbane QLD',
  api_status: 'Active',
  api_name: 'Building Trades Australia',
  scope_count: '3',
  scope_summary: 'CPC40120, BSB50120, MSF40118',
  enriched_at: '2026-03-15T00:00:00Z',
  enrichment_error: '',
};

// --- parseClaudeResponse ---

describe('parseClaudeResponse', () => {
  it('parses a valid subject/body response', () => {
    const raw = 'AI for compliance at Building Trades\n---\nHi Jane,\n\nGreat work...';
    const result = parseClaudeResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.subject).toBe('AI for compliance at Building Trades');
    expect(result!.body).toContain('Hi Jane');
  });

  it('returns null when --- is missing', () => {
    expect(parseClaudeResponse('Subject only, no separator')).toBeNull();
  });

  it('returns null when subject is empty', () => {
    expect(parseClaudeResponse('---\nBody only')).toBeNull();
  });

  it('returns null when body is empty', () => {
    expect(parseClaudeResponse('Subject line\n---')).toBeNull();
  });

  it('trims whitespace from subject and body', () => {
    const result = parseClaudeResponse('  My Subject  \n---\n  Body text  ');
    expect(result!.subject).toBe('My Subject');
    expect(result!.body).toBe('Body text');
  });
});

// --- buildUserPrompt ---

describe('buildUserPrompt', () => {
  it('includes rto_name and contact_name', () => {
    const prompt = buildUserPrompt(baseRto);
    expect(prompt).toContain('Building Trades Australia');
    expect(prompt).toContain('Jane Smith');
  });

  it('falls back to training_packages when scope_summary is empty', () => {
    const rto = { ...baseRto, scope_summary: '' };
    const prompt = buildUserPrompt(rto);
    expect(prompt).toContain('CPC40120');
  });

  it('uses scope_summary when present', () => {
    const prompt = buildUserPrompt(baseRto);
    expect(prompt).toContain('CPC40120, BSB50120, MSF40118');
  });
});

// --- shouldSkip ---

describe('shouldSkip', () => {
  it('returns null for a valid active RTO with email', () => {
    expect(shouldSkip(baseRto)).toBeNull();
  });

  it('skips when contact_email is empty', () => {
    expect(shouldSkip({ ...baseRto, contact_email: '' })).toMatch(/no contact email/);
  });

  it('skips when contact_email is whitespace', () => {
    expect(shouldSkip({ ...baseRto, contact_email: '   ' })).toMatch(/no contact email/);
  });

  it('skips when api_status is Inactive', () => {
    expect(shouldSkip({ ...baseRto, api_status: 'Inactive' })).toMatch(/inactive api_status/);
  });

  it('skips when api_status is Cancelled', () => {
    expect(shouldSkip({ ...baseRto, api_status: 'Cancelled' })).toMatch(/inactive api_status/);
  });

  it('does NOT skip when api_status is empty (enrichment failed — still email if contact exists)', () => {
    expect(shouldSkip({ ...baseRto, api_status: '' })).toBeNull();
  });

  it('is case-insensitive for Active status', () => {
    expect(shouldSkip({ ...baseRto, api_status: 'active' })).toBeNull();
    expect(shouldSkip({ ...baseRto, api_status: 'ACTIVE' })).toBeNull();
  });
});

// --- generateEmail ---

describe('generateEmail', () => {
  const trackedUrl = 'https://tracker.example.com/r/30979';

  function makeClient(responses: Array<() => Promise<unknown>>) {
    let call = 0;
    return {
      messages: {
        create: vi.fn(async () => responses[call++]()),
      },
    } as unknown as import('@anthropic-ai/sdk').default;
  }

  function successResponse(text: string) {
    return async () => ({ content: [{ type: 'text', text }] });
  }

  function errorResponse(msg: string) {
    return async () => { throw new Error(msg); };
  }

  it('returns subject and body for a valid Claude response', async () => {
    const client = makeClient([successResponse('AI for compliance\n---\nHi Jane, ...')]);
    const result = await generateEmail(client, baseRto, trackedUrl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toBe('AI for compliance');
    expect(result.body).toBe('Hi Jane, ...');
  });

  it('retries once on API error then returns error', async () => {
    const createMock = vi.fn()
      .mockRejectedValueOnce(new Error('Rate limit'))
      .mockRejectedValueOnce(new Error('Rate limit'));
    const client = { messages: { create: createMock } } as unknown as import('@anthropic-ai/sdk').default;
    const result = await generateEmail(client, baseRto, trackedUrl);
    expect(result.ok).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on error then succeeds', async () => {
    const createMock = vi.fn()
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Subject\n---\nBody' }] });
    const client = { messages: { create: createMock } } as unknown as import('@anthropic-ai/sdk').default;
    const result = await generateEmail(client, baseRto, trackedUrl);
    expect(result.ok).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('returns error when Claude response has no separator', async () => {
    const client = makeClient([successResponse('No separator here at all')]);
    const result = await generateEmail(client, baseRto, trackedUrl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/parse/i);
  });

  it('uses the correct model', () => {
    expect(MODEL).toBe('claude-sonnet-4-6');
  });
});
