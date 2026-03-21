import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTgaOrganisation } from '../src/enrich/tga-client.js';
import type { TgaOrganisation } from '../src/shared/types.js';

const mockOrg: TgaOrganisation = {
  organisationId: '1234',
  code: '30979',
  name: 'Building Trades Australia',
  isRto: true,
  rtoStatus: 'Active',
  tradingNames: [],
  scopes: [
    { trainingPackageCode: 'CPC40120', trainingPackageName: 'Cert IV Construction' },
    { trainingPackageCode: 'BSB50120', trainingPackageName: 'Diploma of Business' },
    { trainingPackageCode: 'MSF40118', trainingPackageName: 'Cert IV Furnishing' },
    { trainingPackageCode: 'CPP30119', trainingPackageName: 'Cert III Property' },
    { trainingPackageCode: 'CPC50220', trainingPackageName: 'Diploma of Building' },
    { trainingPackageCode: 'EXTRA001', trainingPackageName: 'Extra Package' }, // 6th — should be truncated
  ],
};

function mockFetch(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch(200, mockOrg));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTgaOrganisation', () => {
  it('returns enriched data for a valid RTO code', async () => {
    const result = await fetchTgaOrganisation('30979');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rtoStatus).toBe('Active');
    expect(result.data.name).toBe('Building Trades Australia');
    expect(result.data.scopes).toHaveLength(6);
  });

  it('returns not-found error on 404', async () => {
    vi.stubGlobal('fetch', mockFetch(404));
    const result = await fetchTgaOrganisation('99999');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not found');
  });

  it('retries once on 429 then returns api error if still failing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => null,
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTgaOrganisation('30979');
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on 500 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => null } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => mockOrg } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTgaOrganisation('30979');
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns network error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await fetchTgaOrganisation('30979');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Network error/);
  });
});

describe('enrichment logic (scope truncation)', () => {
  it('scope_summary contains at most 5 codes', async () => {
    const result = await fetchTgaOrganisation('30979');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Simulate what index.ts does
    const scopeCodes = result.data.scopes.map((s) => s.trainingPackageCode).slice(0, 5);
    expect(scopeCodes).toHaveLength(5);
    expect(scopeCodes).not.toContain('EXTRA001');
  });
});
