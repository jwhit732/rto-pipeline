import type { TgaOrganisation } from '../shared/types.js';

const BASE_URL = 'https://training.gov.au/api/organisation';
const RATE_LIMIT_DELAY_MS = 500;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOrg(rtoCode: string): Promise<Response> {
  return fetch(`${BASE_URL}/${rtoCode}`, {
    headers: { Accept: 'application/json' },
  });
}

export type TgaResult =
  | { ok: true; data: TgaOrganisation }
  | { ok: false; error: string };

export async function fetchTgaOrganisation(rtoCode: string): Promise<TgaResult> {
  let response: Response;

  try {
    response = await fetchOrg(rtoCode);
  } catch (err) {
    return { ok: false, error: `Network error: ${String(err)}` };
  }

  // Retry once on 429 or 5xx
  if (response.status === 429 || response.status >= 500) {
    await sleep(RETRY_DELAY_MS);
    try {
      response = await fetchOrg(rtoCode);
    } catch (err) {
      return { ok: false, error: `Network error on retry: ${String(err)}` };
    }
  }

  if (response.status === 404) {
    return { ok: false, error: 'not found' };
  }

  if (!response.ok) {
    return { ok: false, error: `api error (HTTP ${response.status})` };
  }

  try {
    const data = (await response.json()) as TgaOrganisation;
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'failed to parse API response' };
  }
}

export { RATE_LIMIT_DELAY_MS, sleep };
