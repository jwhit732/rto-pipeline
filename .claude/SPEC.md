# RTO Outreach Pipeline — Implementation Spec

## Project overview

Build a local CLI pipeline that takes a CSV of 1,500+ Australian RTOs, enriches each record using the training.gov.au public REST API, generates AI-personalised cold emails with tracked links, presents them for human review, and sends approved emails through Google Workspace Gmail using the `gws` CLI.

This is NOT a web app. It is a series of scripts that each produce a file consumed by the next step. Every step can be run independently and re-run safely.

The pipeline integrates with the existing **RTO Link Tracker** (deployed on Vercel) to generate tracked URLs embedded in each email.

---

## Product goals

### Primary goal
Send personalised, tracked cold emails to RTOs at scale using AI-generated content, with full human review before sending.

### Secondary goals
- Enrich RTO data with current training.gov.au status and scope
- Personalise emails using industry, training packages, location, and contact role
- Track engagement via the existing link tracker dashboard
- Log all sends to a Google Sheet for record keeping
- Keep the system simple enough to run from the terminal in 10 minutes

---

## Non-goals for MVP

Do NOT build:
- Web interface or dashboard (the link tracker handles engagement visibility)
- CRM or contact management features
- Automated follow-up sequences
- Response monitoring or auto-reply (future phase)
- Email scheduling (send manually when ready)
- A/B testing
- Unsubscribe management (include manual unsubscribe line in email)

---

## Pipeline steps

### Step 1: Enrichment

**Input:** `data/input/rto-prospects.csv`
**Output:** `data/enriched/rto-enriched-{date}.csv`

Read the source CSV. For each RTO:
1. Call `https://training.gov.au/api/organisation/{rto_code}` with `Accept: application/json`
2. Extract: current status, RTO status, training package scope
3. If API returns an error or RTO not found, log warning and keep original data
4. Add enrichment columns to the CSV
5. Save enriched CSV with date stamp

#### API details
- Base URL: `https://training.gov.au/api/organisation/{code}`
- Method: GET
- Headers: `Accept: application/json`
- No authentication required
- Rate limit: Add 500ms delay between requests to be respectful
- Expected fields: `organisationId`, `code`, `name`, `isRto`, `rtoStatus`, `tradingNames`, `scopes`

#### Enrichment columns to add
| Column | Source |
|--------|--------|
| `api_status` | `rtoStatus` field |
| `api_name` | `name` from API (cross-reference) |
| `scope_count` | count of items in `scopes` array |
| `scope_summary` | first 5 training package codes, comma-separated |
| `enriched_at` | ISO timestamp |
| `enrichment_error` | error message if API call failed |

#### Error handling
- HTTP 404: mark as "not found", continue
- HTTP 429 or 5xx: retry once after 2 seconds, then mark as "api error"
- Network error: log and continue
- Never crash the batch for a single RTO failure

#### Tests
- Valid RTO code returns enriched data
- Invalid RTO code handled gracefully
- Rate limiting delay is applied
- CSV output matches expected format
- Partial failures don't crash the batch

---

### Step 2: Email generation

**Input:** `data/enriched/rto-enriched-{date}.csv`
**Output:** `data/drafts/outreach-drafts-{date}.json`

For each RTO in the enriched CSV:
1. Skip if `api_status` is not active/current (don't email dead RTOs)
2. Skip if `contact_email` is empty
3. Build a prompt for Claude API using the RTO's data
4. Call Claude API (Sonnet 4.6) to generate a personalised email
5. Generate or retrieve a tracked link from the link tracker
6. Insert tracked link into the email body
7. Save as a draft JSON object

#### Claude API prompt structure

System prompt:
```
You are a business development writer for Smart AI Solutions, an Australian AI consulting firm that helps Registered Training Organisations (RTOs) integrate AI into their training and compliance workflows.

Write a short, personalised cold email to an RTO contact. The email should:
- Be 150-200 words maximum
- Reference something specific about their organisation (training packages, industry, location)
- Explain one concrete benefit of AI for their specific context
- Include a clear but low-pressure call to action
- Sound human, not salesy — like a knowledgeable colleague reaching out
- Use Australian English

Do NOT:
- Use "I hope this email finds you well" or similar clichés
- Make claims about specific ROI or savings without context
- Use exclamation marks excessively
- Sound like a template

Output only the email subject line and body, separated by "---".
```

User prompt:
```
Write a cold email to:
Name: {contact_name}
Position: {contact_position}
Organisation: {rto_name} (RTO code: {rto_code})
Industry: {industry}
Location: {location}
Training packages: {training_packages}
Current scope includes: {scope_summary}

Include this tracked link naturally in the email: {tracked_url}
```

#### Tracked link integration
- For each RTO, call the link tracker's batch creation API or generate the URL using the known format: `{LINK_TRACKER_URL}/r/{rto_code}`
- If the link tracker already has an active link for that RTO code, reuse it
- The destination URL is set via `LINK_TRACKER_DEST_URL` env var

#### Draft JSON format
```json
[
  {
    "rto_code": "30979",
    "rto_name": "Building Trades Australia",
    "contact_name": "Jane Smith",
    "contact_email": "jane@bta.edu.au",
    "contact_position": "Training Manager",
    "subject": "AI for compliance at Building Trades",
    "body": "Hi Jane,\n\nI noticed Building Trades...",
    "tracked_url": "https://url-tracker.vercel.app/r/30979",
    "generated_at": "2026-03-15T10:00:00Z",
    "status": "pending",
    "skip_reason": null
  }
]
```

#### Skipped RTOs
RTOs skipped due to inactive status or missing email should be logged in a separate file: `data/drafts/skipped-{date}.json` with a `skip_reason` field.

#### Cost estimate
- ~1,500 API calls to Claude Sonnet 4.6
- ~500 input tokens + ~300 output tokens per call
- Estimated cost: ~$1.50–$3.00 total

#### Tests
- Valid RTO generates a well-formed draft
- Inactive RTOs are skipped with reason
- Missing email RTOs are skipped with reason
- Claude API error is handled gracefully
- Tracked URL is correctly inserted
- Output JSON matches expected schema

---

### Step 3: Interactive review

**Input:** `data/drafts/outreach-drafts-{date}.json`
**Output:** `data/approved/outreach-approved-{date}.json`

Present draft emails for human review in an interactive CLI:
1. Load drafts JSON
2. Display emails one at a time or in batches of 5-10
3. For each email, show: RTO name, contact, subject, body preview
4. Offer actions:
   - `a` — approve as-is
   - `e` — edit (open in default editor or inline edit)
   - `s` — skip this RTO
   - `q` — quit and save progress
5. Save approved emails to approved JSON
6. Track review progress so you can resume where you left off

#### Resume support
- Write a `.review-progress` file tracking the last reviewed index
- On restart, ask "Resume from email #247?" or "Start from beginning?"

#### Tests
- Approved emails are saved correctly
- Skipped emails are not included in output
- Progress file tracks position accurately
- Quit and resume works

---

### Step 4: Batch sender

**Input:** `data/approved/outreach-approved-{date}.json`
**Output:** `data/logs/send-log-{date}.csv`

Send approved emails using `gws gmail +send`:
1. Load approved JSON
2. For each email:
   - Run: `gws gmail +send --to {email} --subject "{subject}" --body "{body}"`
   - Log result (success/failure) with timestamp
   - Wait `BATCH_DELAY_MS` between sends
3. Stop after `BATCH_SIZE` emails per run
4. Save send log CSV

#### Send log columns
| Column | Description |
|--------|-------------|
| `rto_code` | RTO identifier |
| `rto_name` | Organisation name |
| `contact_email` | Recipient |
| `subject` | Email subject |
| `sent_at` | Timestamp |
| `status` | success / failed |
| `error` | Error message if failed |
| `gws_message_id` | Gmail message ID if available |

#### Batch controls
- `BATCH_SIZE` env var controls how many to send per run (default 50)
- `BATCH_DELAY_MS` env var controls delay between sends (default 2000ms)
- If a send fails, log error and continue to next
- Print running count: "Sent 23/50 — 2 failures"

#### Google Sheets logging (nice to have)
After the batch completes, append summary to a Google Sheet:
```bash
gws sheets +append --spreadsheet {SHEET_ID} --values "{date},{batch_size},{success_count},{fail_count}"
```

#### Tests
- Successful sends are logged correctly
- Failed sends are logged with error
- Batch size limit is respected
- Delay between sends is applied
- Dry run mode available (--dry-run flag that logs without sending)

---

## Edge cases to handle

- RTO with no contact email → skip in generation, log reason
- RTO not found on training.gov.au → enrich with error flag, still generate email if contact exists
- Claude API returns malformed response → retry once, then skip with error
- gws send fails → log error, continue batch
- Duplicate RTO codes in source CSV → dedupe, keep first occurrence
- Very long training package lists → truncate to first 5 in prompt
- Special characters in email body → ensure proper encoding for gws
- Resume interrupted enrichment → check enriched CSV for existing entries, skip already-enriched

---

## Environment variables

```bash
# Claude API
ANTHROPIC_API_KEY=

# Link tracker
LINK_TRACKER_URL=https://your-tracker.vercel.app
LINK_TRACKER_DEST_URL=https://smartaisolutions.com/demo

# Google Workspace
GWS_SEND_FROM=jimmy@smartaisolutions.com

# Batch controls  
BATCH_SIZE=50
BATCH_DELAY_MS=2000

# Google Sheets logging (optional)
SEND_LOG_SHEET_ID=

# Email content
DIGEST_TO_EMAIL=jimmy@smartaisolutions.com
```

---

## Implementation order

### Phase 1: Scaffold
- Init Node.js project with TypeScript
- Install dependencies: `@anthropic-ai/sdk`, `csv-parse`, `csv-stringify`, `commander`, `dotenv`, `chalk`
- Create folder structure
- Define shared types
- Create config module that reads env vars
- Create .env.example

### Phase 2: Enrichment script
- CSV reader
- training.gov.au API client with rate limiting
- Enrichment logic
- CSV writer with enrichment columns
- CLI entry point: `npm run enrich`
- Tests for API client and enrichment logic

### Phase 3: Email generation
- Load enriched CSV
- Filter out inactive/no-email RTOs
- Claude API client
- Prompt builder
- Tracked link URL builder
- Draft JSON writer
- CLI entry point: `npm run generate`
- Tests for prompt building and draft output

### Phase 4: Interactive review
- Draft JSON reader
- Terminal UI for review (display + action keys)
- Edit support (inline or external editor)
- Progress tracking and resume
- Approved JSON writer
- CLI entry point: `npm run review`

### Phase 5: Batch sender
- Approved JSON reader
- gws gmail send wrapper
- Batch size + delay controls
- Send log CSV writer
- Dry run mode
- CLI entry point: `npm run send`
- Tests for batch logic and logging

### Phase 6: Integration + polish
- Google Sheets logging
- Error summary report after each step
- README with full setup instructions
- .env.example with all variables documented
- End-to-end test with 3-5 test RTOs

---

## Testing approach

Use a small test CSV with 3-5 fake RTOs for end-to-end testing:
```csv
rto_code,rto_name,contact_email,contact_name,contact_position,industry,training_packages,location
99999,Test RTO One,jimmy@smartaisolutions.com,Jimmy,Director,Education,BSB50120,Brisbane QLD
99998,Test RTO Two,jimmy@smartaisolutions.com,Jimmy,Manager,Health,HLT43021,Sydney NSW
```

All test sends go to your own email address.

### Dry run mode
Every script should support a `--dry-run` flag that:
- Enrichment: calls API but doesn't write CSV (just prints results)
- Generation: generates emails but doesn't write JSON (just prints first 3)
- Review: loads drafts in read-only mode
- Send: formats gws commands but doesn't execute them

---

## Deliverables

1. Working enrichment script with training.gov.au integration
2. Working email generator with Claude API personalisation
3. Interactive review CLI with resume support
4. Batch sender using gws gmail
5. Send logging to CSV and Google Sheets
6. Dry run mode for all steps
7. Test suite
8. README with setup, usage, and env var documentation

---

## Future phases (not for this build)

- Response monitoring using `gws gmail +watch`
- Auto-classification of replies (interested / not interested / OOO)
- Follow-up email generation for non-responders
- Cowork skills that wrap these scripts for conversational access
- Dashboard or reporting beyond the link tracker
- CSV import directly into the link tracker
