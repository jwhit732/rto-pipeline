# RTO Outreach Pipeline

A local CLI pipeline that sends personalised, tracked cold emails to Australian RTOs at scale — with human review before anything goes out.

```
[1] Input CSV/XLSX  →  [2] Enrich (TGA API)  →  [3] Generate (Claude AI)
                                                         ↓
                    [6] Send log (CSV)  ←  [5] Send  ←  [4] Review (CLI)
```

Each step runs independently and writes a file consumed by the next. You can re-run any step safely.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | ESM, built-in `fetch` |
| [gws CLI](https://github.com/bounteous/gws) | Google Workspace CLI — used for sending |
| Google Workspace account | Email must come from a real Workspace account |
| Anthropic API key | For email generation (Claude Sonnet 4.6) |

### Install gws

Follow the [gws installation guide](https://github.com/bounteous/gws). Then authenticate with your Google Workspace account:

```bash
gws auth
```

The OAuth credentials (`GOOGLE_WORKSPACE_CLI_CLIENT_ID` / `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET`) must be set in `.env` before authenticating.

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file and fill in your values
cp .env.example .env
```

Edit `.env` with your values (see [Environment variables](#environment-variables) below).

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key — used by `npm run generate` |
| `LINK_TRACKER_URL` | Yes | Base URL of your deployed link tracker (e.g. `https://your-tracker.vercel.app`) |
| `LINK_TRACKER_DEST_URL` | Yes | Destination URL tracked links redirect to |
| `GWS_SEND_FROM` | Yes | Workspace email address emails are sent from |
| `SENDER_NAME` | No | First name used in email sign-off (e.g. `James`). Defaults to blank — Claude will write `[Your Name]` if unset. |
| `GOOGLE_WORKSPACE_CLI_CLIENT_ID` | Yes | OAuth client ID for gws |
| `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET` | Yes | OAuth client secret for gws |
| `BATCH_SIZE` | No | Emails per send run. Default: `50` |
| `BATCH_DELAY_MS` | No | Milliseconds between sends. Default: `2000` |
| `SEND_LOG_SHEET_ID` | No | Google Sheets ID for optional send summary logging |
| `DIGEST_TO_EMAIL` | No | Email address for notifications |

---

## Running the pipeline

### Step 1 — Enrich

Fetches current status and training scope for each RTO from training.gov.au.

```bash
# From a CSV
npm run enrich -- --input data/input/rto-prospects.csv

# From the xlsx prospect tracker
npm run enrich -- --input /path/to/asqa_rtos_scored.xlsx

# Dry run — hits the API but doesn't write output
npm run enrich -- --input data/input/rto-prospects.csv --dry-run

# If a run was interrupted, re-running automatically resumes (skips already-enriched RTOs).
# To force a full re-run from scratch:
npm run enrich -- --input data/input/rto-prospects.csv --from-scratch
```

**Output:** `data/enriched/rto-enriched-YYYY-MM-DD.csv`

**Notes:**
- Fake/test RTO codes (like `99999`) will get `enrichment_error: not found` — that's fine, generation will still run for them.
- Rate limited to 500ms between API calls to respect training.gov.au.
- 3,600 RTOs takes approximately 30 minutes. Resume is automatic if interrupted.
- RTOs with `first contact` populated in the xlsx are automatically skipped (already emailed).

---

### Step 2 — Generate

Calls Claude Sonnet 4.6 to write a personalised cold email for each RTO. Skips inactive RTOs and any without a contact email.

```bash
# Generate from the latest enriched CSV
npm run generate

# Generate from a specific enriched file
npm run generate -- --input data/enriched/rto-enriched-2026-03-15.csv

# Dry run — generates and prints first 3, doesn't write JSON
npm run generate -- --dry-run

# Limit to first N RTOs (useful for testing)
npm run generate -- --limit 10
npm run generate -- --limit 10 --dry-run
```

**Output:** `data/drafts/outreach-drafts-YYYY-MM-DD.json`
**Also writes:** `data/drafts/skipped-YYYY-MM-DD.json` (RTOs skipped with reason)

**Notes:**
- Skips RTOs where `api_status` is not `active` or `current` (e.g. `suspended`, `cancelled`).
- Skips RTOs with no `contact_email`.
- RTOs where enrichment failed (TGA API returned 404) are still emailed — they use the training packages from the source data.
- Estimated cost: ~$1.50–$3.00 for 1,500 emails.

---

### Step 3 — Review

Interactive CLI to approve, edit, or skip draft emails before sending. Nothing gets sent without going through this step.

```bash
npm run review

# Review a specific drafts file
npm run review -- --input data/drafts/outreach-drafts-2026-03-15.json

# Read-only preview (no approvals recorded)
npm run review -- --dry-run
```

**Keys:**
| Key | Action |
|---|---|
| `a` | Approve as-is |
| `e` | Open in `$EDITOR` (defaults to Notepad on Windows, `nano` elsewhere). Edit subject/body, then confirm with `y` |
| `s` | Skip this RTO |
| `q` | Quit and save progress |
| Ctrl+C | Quit and save progress |

**Resume:** If you quit mid-session, re-running will ask `Resume from email 247/3200? [y/n]`. Progress is saved after every action.

**Editor:** Set `EDITOR=code --wait` in your shell to use VS Code. Any blocking editor works.

**Output:** `data/approved/outreach-approved-YYYY-MM-DD.json`

---

### Step 4 — Send

Sends approved emails in batches via `gws gmail +send`. Requires `gws auth` to have been run first.

```bash
# Send up to BATCH_SIZE (default 50) approved emails
npm run send

# Send from a specific approved file
npm run send -- --input data/approved/outreach-approved-2026-03-15.json

# Dry run — prints what would be sent, doesn't call gws
npm run send -- --dry-run
```

**Output:** `data/logs/send-log-YYYY-MM-DDTHH-MM-SS.csv`

**Notes:**
- Never sends more than `BATCH_SIZE` emails per run. Run again tomorrow for the next batch.
- Status is written back to the approved JSON after every send — if the script crashes mid-batch, already-sent emails won't be re-sent.
- Failed sends are logged and skipped — the batch continues regardless.
- If `SEND_LOG_SHEET_ID` is set, a summary row (`date, total, sent, failed`) is appended to that Google Sheet after each batch.

---

## Testing with the test CSV

A 3-row test CSV is included at `data/input/rto-test.csv` with fake RTO codes pointing at `jimmy@smartaisolutions.com`. Use this to verify the full pipeline without touching real data:

```bash
# 1. Enrich (will get "not found" for fake codes — expected)
npm run enrich -- --input data/input/rto-test.csv

# 2. Generate (dry run first to check output)
npm run generate -- --dry-run --limit 3

# 3. Generate for real
npm run generate -- --limit 3

# 4. Review
npm run review

# 5. Send (dry run)
npm run send -- --dry-run
```

---

## Project structure

```
data/
  input/          Source CSV or xlsx goes here
  enriched/       TGA-enriched CSV output (rto-enriched-YYYY-MM-DD.csv)
  drafts/         Generated email drafts JSON + skipped JSON
  approved/       Approved emails ready to send
  logs/           Send log CSVs

src/
  enrich/         TGA API enrichment script
  generate/       Claude API email generation
  review/         Interactive review CLI
  send/           gws batch sender
  shared/         Types, config, logger

tests/            Vitest unit tests
templates/        Email templates (reference only — Claude generates content)
```

---

## Batching strategy

**Do not send all 3,600 emails at once.** The default batch size is 50/day. A reasonable schedule:

- Run `npm run generate -- --limit 500` to generate a chunk
- Review and approve in the CLI
- Run `npm run send` each day (sends 50, stops)
- The approved JSON tracks who's been sent — re-running send picks up where you left off

Adjust `BATCH_SIZE` in `.env` to change how many are sent per run. Stay under ~100/day on a new domain to protect deliverability.

---

## Troubleshooting

**`gws: command not found`**
Install gws and make sure it's on your PATH.

**`Gmail auth failed: Failed to get token`**
Run `gws auth` to authenticate with your Google Workspace account.

**`Missing required environment variable: ANTHROPIC_API_KEY`**
Check your `.env` file exists and is populated. The file must be in the project root.

**`No enriched CSV found in data/enriched/`**
Run `npm run enrich` first.

**`No drafts JSON found in data/drafts/`**
Run `npm run generate` first.

**`No approved JSON found in data/approved/`**
Run `npm run review` and approve at least one email.

**`stdin is not a TTY — interactive review requires a real terminal`**
Run `npm run review` in a proper terminal (not a piped shell or some CI environments).

**Enrichment taking too long / interrupted**
Re-run the same command — it automatically resumes from where it left off. Use `--from-scratch` to force a full re-run.

---

## Running tests

```bash
npm test           # run once
npm run test:watch # watch mode
npm run typecheck  # TypeScript type check only
```
