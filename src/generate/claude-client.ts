import Anthropic from '@anthropic-ai/sdk';
import type { RtoEnriched } from '../shared/types.js';

export const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are a business development writer for Smart AI Solutions, an Australian AI consulting firm that helps Registered Training Organisations (RTOs) integrate AI into their training and compliance workflows.

Write a short, personalised cold email to an RTO contact. The email should:
- Be 120-150 words maximum
- Reference something specific about their organisation (training packages, industry, location)
- Explain one concrete benefit of AI for their specific context
- Include a call-to-action link using markdown format: [here]({{TRACKED_LINK}})
  Always use "here" as the anchor text — e.g. "take a look here" or "you can see how it works here"
- Sound human, not salesy — like a knowledgeable colleague reaching out
- Use Australian English

Do NOT:
- Use "I hope this email finds you well" or similar clichés
- Skip the greeting — always open with "Hi [name],"
- Use a run-on CTA — pick one ask and end cleanly after the link
- Open with "I came across [org name]" or any variant — it sounds fake when the email is clearly researched and personalised. Instead, open by referencing something specific about their work or context directly.
- Make claims about specific ROI or savings without context
- Use em-dashes (—) anywhere in the email or subject line — use a comma, full stop, or rewrite the sentence instead
- Use exclamation marks excessively
- Sound like a template
- Repeat the same word twice in close succession (e.g. "drafting documentation drafts")
- Make spelling errors — double-check all words before outputting, especially in the subject line
- Add a placeholder like [Your Name] — use the sender name provided
- Include the raw URL in the email body — use only the markdown link format above
- Prefix the subject line with "Subject:"

Output ONLY in this exact format — subject line first, then a line containing just "---", then the email body:

<subject line here>
---
<email body here>`;

export function buildUserPrompt(rto: RtoEnriched, senderName = ''): string {
  const scope = rto.scope_summary ||
    rto.training_packages.split(/[;,]/).map(s => s.trim()).filter(Boolean).slice(0, 5).join(', ');
  const signOff = `End the email with just "Cheers," on its own line — do not include a name or organisation, as the sender's signature is added separately.`;
  return `Write a cold email to:
Name: ${rto.contact_name}
Position: ${rto.contact_position}
Organisation: ${rto.rto_name} (RTO code: ${rto.rto_code})
Industry: ${rto.industry}
Location: ${rto.location}
Training packages: ${rto.training_packages}
Current scope includes: ${scope}

${signOff}`;
}

export function parseClaudeResponse(text: string): { subject: string; body: string } | null {
  const idx = text.indexOf('---');
  if (idx === -1) return null;
  const subject = text.slice(0, idx).trim().replace(/^Subject:\s*/i, '');
  const body = text.slice(idx + 3).trim();
  if (!subject || !body) return null;
  return { subject, body };
}

// Converts raw body (with {{TRACKED_LINK}}) into plain-text and HTML versions.
// Claude writes: [anchor text]({{TRACKED_LINK}})
// Customisation: change fallback anchor text or HTML wrapper style here.
export function applyTrackedLink(
  rawBody: string,
  trackedUrl: string
): { bodyText: string; bodyHtml: string } {
  const mdLink = /\[([^\]]+)\]\(\{\{TRACKED_LINK\}\}\)/g;

  const bodyText = rawBody
    .replace(mdLink, (_, anchor) => `${anchor}: ${trackedUrl}`)
    .replace(/\{\{TRACKED_LINK\}\}/g, trackedUrl);

  const escaped = rawBody
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const withLink = escaped
    .replace(mdLink, (_, anchor) => `<a href="${trackedUrl}">${anchor}</a>`)
    .replace(/\{\{TRACKED_LINK\}\}/g, `<a href="${trackedUrl}">see a quick demo</a>`);

  const paragraphs = withLink
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 12px 0">${p.replace(/\n/g, ' ')}</p>`)
    .join('\n');

  const signature = `<div style="font-family: Arial, sans-serif; font-size:14px; color:#333; max-width:450px;">
  <p style="margin:0; font-size:16px; font-weight:bold; color:#2a7ae2;">James Whittle</p>
  <p style="margin:0; color:#555;">Founder | Smart AI Solutions</p>
  <hr style="border:none; border-top:2px solid #2a7ae2; margin:8px 0; width:100%;">
  <p style="margin:0;">
    <a href="https://smartaisolutions.au/" style="color:#2a7ae2; text-decoration:none;">smartaisolutions.au</a><br>
    <a href="mailto:james@smartaisolutions.au" style="color:#2a7ae2; text-decoration:none;">james@smartaisolutions.au</a><br>
    <a href="tel:+61448962943" style="color:#2a7ae2; text-decoration:none;">0448 962 943</a><br>
    <a href="https://www.linkedin.com/in/jwhittle1" style="color:#2a7ae2; text-decoration:none;">LinkedIn</a>
  </p>
</div>`;

  const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:750px">\n${paragraphs}\n${signature}\n</div>`;

  return { bodyText, bodyHtml };
}

export type GenerateResult =
  | { ok: true; subject: string; body: string; bodyHtml: string }
  | { ok: false; error: string };

async function callClaude(client: Anthropic, rto: RtoEnriched, senderName: string): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(rto, senderName) }],
  });
  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude API');
  return block.text;
}

export async function generateEmail(
  client: Anthropic,
  rto: RtoEnriched,
  trackedUrl: string,
  senderName = ''
): Promise<GenerateResult> {
  let lastError = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callClaude(client, rto, senderName);
      const parsed = parseClaudeResponse(text);
      if (!parsed) {
        return { ok: false, error: 'Could not parse Claude response (missing ---)' };
      }
      const { bodyText, bodyHtml } = applyTrackedLink(parsed.body, trackedUrl);
      return { ok: true, subject: parsed.subject, body: bodyText, bodyHtml };
    } catch (err) {
      lastError = String(err);
    }
  }

  return { ok: false, error: `Claude API error: ${lastError}` };
}
