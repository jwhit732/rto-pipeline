# RTO Outreach Pipeline

## What this is
A hybrid outreach system for Smart AI Solutions. Automates cold email outreach to 1,500+ Australian RTOs using AI-personalised emails sent through Google Workspace, with click tracking via the existing link tracker app.

This is a batch pipeline, not a web app. It runs locally when needed and produces files at each stage that feed into the next.

## Architecture
```
[1] CSV (1,500 RTOs with contact data)
         ↓
[2] Enrichment script (training.gov.au REST API) → enriched CSV
         ↓
[3] Email generation (Claude API + link tracker integration) → drafts JSON
         ↓
[4] Review (manual — human approves/edits/skips in batches)
         ↓
[5] Batch sender (gws gmail +send) → send log CSV
         ↓
[6] Link tracker dashboard (already deployed — shows who clicked)
```

Each step is a standalone script. Output files are the interface between steps. No tight coupling.

## Stack
- **Node.js / TypeScript** for all scripts
- **Google Workspace CLI (gws)** for sending emails and logging to Sheets
- **Anthropic Claude API (Sonnet 4.6)** for email personalisation
- **training.gov.au REST API** for RTO enrichment (open, no auth)
- **Existing link tracker** at the deployed Vercel URL for tracked links

## Key commands
- `npm run enrich` — run enrichment against training.gov.au
- `npm run generate` — generate personalised email drafts
- `npm run review` — interactive CLI to approve/edit/skip drafts
- `npm run send` — send approved emails in batches via gws
- `npm test` — run tests

## Project structure
```
/data
  /input              — source CSV goes here
  /enriched           — enriched CSV output
  /drafts             — generated email drafts (JSON)
  /approved           — approved emails ready to send (JSON)
  /logs               — send logs, error logs
/src
  /enrich             — training.gov.au enrichment logic
  /generate           — Claude API email generation
  /review             — interactive review CLI
  /send               — gws gmail batch sender
  /shared             — types, config, utilities
/templates
  /email              — email template(s) with merge fields
/tests
```

## Code standards
- TypeScript strict mode
- Australian English in all email copy
- Keep files under 200 lines
- No premature abstraction — this is a pipeline, not a framework
- Each script reads from a file and writes to a file
- Comment only where the why isn't obvious
- Handle errors gracefully — log and continue, don't crash the batch

## Data model

### Input CSV columns
- `rto_code` — unique identifier
- `rto_name` — organisation name
- `contact_email` — primary contact
- `contact_name` — contact person
- `contact_position` — their role
- `industry` — sector/industry
- `training_packages` — scope of training
- `location` — state/city

### Enriched CSV adds
- `current_status` — active/inactive from training.gov.au
- `scope_summary` — current training package scope
- `recent_changes` — any scope changes detected
- `enriched_at` — timestamp

### Draft email JSON
```json
{
  "rto_code": "30979",
  "rto_name": "Building Trades Australia",
  "contact_name": "Jane Smith",
  "contact_email": "jane@bta.edu.au",
  "subject": "personalised subject",
  "body": "personalised email body with tracked link",
  "tracked_url": "https://url-tracker.vercel.app/r/30979",
  "generated_at": "2026-03-15T10:00:00Z",
  "status": "pending"
}
```

## Environment variables
```
ANTHROPIC_API_KEY=          # for email generation
LINK_TRACKER_URL=           # your deployed link tracker base URL
LINK_TRACKER_DEST_URL=      # destination URL for tracked links
DIGEST_TO_EMAIL=            # your email for notifications
GWS_SEND_FROM=              # your Workspace email address
BATCH_SIZE=50               # emails per send batch
BATCH_DELAY_MS=2000         # delay between sends (avoid rate limits)
```

## Important rules
- NEVER send all 1,500 emails at once. Batch in groups of 50-100/day.
- ALWAYS generate drafts for review before sending. No auto-send without human approval.
- Log every send attempt (success or failure) with timestamp, RTO code, and status.
- If gws or API errors, log the error and skip to next — don't crash the batch.
- Store all intermediate files so any step can be re-run independently.
- Emails must come from the Smart AI Solutions Workspace account, not a transactional service.

## Build order
Phase 1: Project scaffold + shared types + config
Phase 2: Enrichment script (training.gov.au API)
Phase 3: Email generation (Claude API + tracked links)
Phase 4: Interactive review CLI
Phase 5: Batch sender (gws gmail)
Phase 6: Send logging + Google Sheets integration
Phase 7: Testing + error handling + README

## Mistakes to avoid
- Don't use Resend or other transactional email — use gws gmail for deliverability
- Don't build a web UI — this is a CLI pipeline
- Don't over-engineer the enrichment — just get current status and scope
- Don't send without the review step — always human-in-the-loop
- Don't forget rate limiting on training.gov.au API calls
