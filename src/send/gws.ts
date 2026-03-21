import { spawnSync } from 'node:child_process';

export interface GwsSendResult {
  ok: boolean;
  messageId: string;
  error: string;
}

function parseOutput(stdout: string, stderr: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    const match = (stdout + '\n' + stderr).match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { /* fall through */ }
    }
    return {};
  }
}

export function gwsSend(
  to: string,
  subject: string,
  body: string,
  dryRun = false
): GwsSendResult {
  if (dryRun) return { ok: true, messageId: 'dry-run', error: '' };

  const result = spawnSync(
    'gws',
    ['gmail', '+send', '--to', to, '--subject', subject, '--body', body, '--format', 'json'],
    { encoding: 'utf8', env: { ...process.env } }
  );

  if (result.error) {
    return { ok: false, messageId: '', error: `gws not found: ${result.error.message}` };
  }

  const parsed = parseOutput(result.stdout ?? '', result.stderr ?? '');

  if (result.status !== 0) {
    const apiErr = parsed.error as Record<string, unknown> | undefined;
    const msg = (apiErr?.message as string) ?? result.stdout?.trim() ?? 'Unknown gws error';
    return { ok: false, messageId: '', error: msg };
  }

  return { ok: true, messageId: (parsed.id as string) ?? '', error: '' };
}

// Sends an HTML email via gws gmail +send --html
export async function gwsSendHtml(
  _from: string,
  to: string,
  subject: string,
  bodyText: string,
  bodyHtml: string,
  dryRun = false
): Promise<GwsSendResult> {
  if (dryRun) return { ok: true, messageId: 'dry-run', error: '' };

  const fullHtml = `<!DOCTYPE html><html><body>${bodyHtml}</body></html>`;

  const result = spawnSync(
    'gws',
    ['gmail', '+send', '--to', to, '--subject', subject, '--body', fullHtml, '--html', '--format', 'json'],
    { encoding: 'utf8', env: { ...process.env } }
  );

  if (result.error) {
    return { ok: false, messageId: '', error: `gws not found: ${result.error.message}` };
  }

  const parsed = parseOutput(result.stdout ?? '', result.stderr ?? '');

  if (result.status !== 0) {
    const apiErr = parsed.error as Record<string, unknown> | undefined;
    const msg = (apiErr?.message as string) ?? result.stdout?.trim() ?? 'Unknown gws error';
    return { ok: false, messageId: '', error: msg };
  }

  return { ok: true, messageId: (parsed.id as string) ?? '', error: '' };
}
