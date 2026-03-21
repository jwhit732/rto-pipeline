# Phase 7 — Link Creation, HTML Emails, and Scheduled Sending

## Overview

This phase fixes the critical tracked URL bug and adds two improvements to email quality and delivery timing. It spans both the link tracker and outreach pipeline projects.

---

## 7.1 Tracked Link Creation API (Link Tracker Project)

### Problem
The generate script builds tracked URLs using the pattern `/r/{rto_code}`, but never creates the corresponding tracked link record in the link tracker database. When a recipient clicks, the tracker returns 404.

### What to build

Add a new API endpoint to the link tracker:

```
POST /api/links/create
```

### Authentication
Same as the clicks API — require `secret` query parameter matching `CRON_SECRET` env var. Return 401 if missing or wrong.

### Request body

```json
{
  "destination_url": "https://chatgpt.com/g/g-6975ad515fc0819185cb70409b0201f9-trainer-guide-creator-smart-ai-solutions-demo",
  "rtos": [
    { "rto_code": "30979", "rto_name": "Building Trades Australia" },
    { "rto_code": "1718", "rto_name": "Performance Training Pty Limited" }
  ]
}
```

### Behaviour

For each RTO in the array:
1. Upsert the `Rto` record (create if new, update name if changed)
2. Check if an active `TrackedLink` already exists for that `rtoCode`
   - If yes: update its `destinationUrl` to match the request. Return status `"reused"`.
   - If no: create a new `TrackedLink` with `slug = rtoCode`, `isActive = true`. Return status `"created"`.
3. Create a `LinkBatch` record for the request (use `"api-batch"` as default label)

### Response

```json
{
  "batch_id": "clxyz123",
  "destination_url": "https://chatgpt.com/g/...",
  "links": [
    {
      "rto_code": "30979",
      "rto_name": "Building Trades Australia",
      "slug": "30979",
      "tracked_url": "/r/30979",
      "status": "created"
    },
    {
      "rto_code": "1718",
      "rto_name": "Performance Training Pty Limited",
      "slug": "1718",
      "tracked_url": "/r/1718",
      "status": "reused"
    }
  ],
  "created": 1,
  "reused": 1,
  "total": 2
}
```

### Validation
- `destination_url` must be a valid absolute URL (http or https)
- Each RTO must have `rto_code` (required) and `rto_name` (required)
- Skip entries with missing fields and include them in an `errors` array in the response
- Dedupe by `rto_code` within the same request

### Error response

```json
{
  "error": "Validation failed",
  "details": [
    { "rto_code": "", "error": "rto_code is required" }
  ]
}
```

### File to create
- `app/api/links/create/route.ts`

### Tests
- Valid request creates tracked links and returns correct response
- Existing RTO with active link returns `"reused"` and updates destination URL
- New RTO creates both Rto record and TrackedLink
- Missing rto_code or rto_name is rejected with error detail
- Duplicate rto_codes in same request are deduped
- Missing or invalid secret returns 401
- Invalid destination_url returns 400
- Created links actually redirect correctly (integration test)

### Deployment
After building, commit, push, and wait for Vercel redeploy. Test with curl:
```bash
curl.exe -X POST "https://url-tracker-tawny.vercel.app/api/links/create?secret=YOUR_SECRET" -H "Content-Type: application/json" -d "{\"destination_url\": \"https://example.com\", \"rtos\": [{\"rto_code\": \"99999\", \"rto_name\": \"Test RTO\"}]}"
```

---

## 7.2 Wire Generate Script to Link Creation API (Outreach Pipeline Project)

### Problem
The generate script currently constructs tracked URLs without verifying they exist in the link tracker.

### What to change

Update `src/generate/index.ts` to:

1. Before generating any emails, collect all RTOs that will receive emails
2. Call `POST {LINK_TRACKER_URL}/api/links/create?secret={CRON_SECRET}` with:
   - `destination_url` from `LINK_TRACKER_DEST_URL` env var
   - All RTOs in the batch as the `rtos` array
3. Parse the response and build a map of `rto_code → full tracked URL`
4. Only generate emails for RTOs where the tracked link was successfully created or reused
5. If the API call fails entirely, abort the generate step with a clear error message

### Tracked URL construction
Use the response from the API to build full URLs:
```
{LINK_TRACKER_URL}{tracked_url}
```
e.g. `https://url-tracker-tawny.vercel.app/r/30979`

### Batch size for API calls
If generating more than 100 emails, chunk the link creation calls into batches of 100 RTOs per request. This avoids sending a single massive payload.

### Tests
- Generate script calls the link creation API before generating emails
- Emails only generated for RTOs with confirmed tracked links
- API failure aborts generation with clear error
- Tracked URLs in generated emails match the API response

---

## 7.3 HTML Emails with Hidden Links (Outreach Pipeline Project)

### Problem
Emails currently contain the raw tracker URL like `https://url-tracker-tawny.vercel.app/r/30979` which looks suspicious and unprofessional.

### What to change

Update the email generation and sending to use HTML format instead of plain text.

#### Generate script changes (`src/generate/index.ts`)

Update the Claude API system prompt to:
- Generate email body as plain text (no HTML) — Claude writes the words
- Include a placeholder for the tracked link: `{{TRACKED_LINK}}`
- Specify anchor text in the prompt: "Include a natural call-to-action link. Use the placeholder {{TRACKED_LINK}} where the link should go. Write the anchor text that should be clickable, like 'take a look at how this works' or 'see a quick demo'."

After Claude generates the email, replace `{{TRACKED_LINK}}` with an HTML anchor:
```html
<a href="https://url-tracker-tawny.vercel.app/r/30979">take a look at how this works</a>
```

The draft JSON should store both:
- `body_text` — plain text version (for preview in the review CLI)
- `body_html` — HTML version with the anchor tag (for sending)

#### Send script changes (`src/send/index.ts`)

Update the gws send command to send HTML email. Check if `gws gmail +send` supports an `--html` flag or if the raw Gmail API needs to be used with a MIME message.

If gws doesn't support HTML natively:
- Build a MIME message with both text/plain and text/html parts
- Use `gws gmail users messages send` with the raw MIME encoded as base64

#### Review script changes (`src/review/index.ts`)

Show `body_text` in the terminal (plain text is more readable in CLI). Note in the display that the sent version will include a clickable link.

### Tests
- Generated drafts include both body_text and body_html
- HTML body contains a valid anchor tag with the tracked URL
- Anchor text reads naturally (not "click here")
- Plain text fallback doesn't contain HTML tags
- Sent HTML email renders correctly (send test to yourself)

---

## 7.4 Scheduled Sending During Business Hours (Outreach Pipeline Project)

### Problem
Sending 50 emails in rapid succession at any time of day reduces deliverability and open rates. Emails sent during business hours on weekdays perform better.

### What to build

Add a `--schedule` flag to the send script that spreads sends across optimal windows.

```bash
npm run send -- --schedule
```

### Schedule rules
- Only send Monday to Thursday (Friday emails get buried over the weekend)
- Only send between 9:00 AM and 11:00 AM AEST (peak open time for business email)
- Spread sends evenly across the window with random jitter (±30 seconds)
- If run outside the send window, calculate when the next window opens and tell the user:
  "Next send window: Monday 9:00 AM AEST. Queue 47 emails to send then?"

### Queue file
When `--schedule` is used:
1. Write approved emails to `data/queue/send-queue-{date}.json` with a `scheduled_for` timestamp for each
2. Show the schedule: "47 emails queued: Mon 12 × 9:00-9:30, 12 × 9:30-10:00, 12 × 10:00-10:30, 11 × 10:30-11:00"

### Execution options
Two ways to run the scheduled queue:

**Option A: Manual trigger during window**
User runs `npm run send -- --process-queue` during the send window. It sends any emails whose `scheduled_for` time has passed.

**Option B: Long-running process**
User runs `npm run send -- --schedule --watch`. The script stays alive and sends emails as their scheduled time arrives. Shows a countdown to the next send.

Build Option A for MVP. Option B is nice-to-have.

### Without --schedule flag
The existing behaviour (`npm run send`) remains unchanged — sends immediately with the configured batch delay.

### Tests
- `--schedule` creates queue file with correct timestamps
- All scheduled times fall within Mon-Thu 9-11 AM AEST
- `--process-queue` only sends emails whose time has passed
- Queue correctly tracks sent/pending status
- Running outside window shows next window time

---

## Implementation order

1. **7.1** — Link creation API in the link tracker (build, deploy, test with curl)
2. **7.2** — Wire generate script to the API (fixes the critical bug)
3. **7.3** — HTML emails (improves professionalism)
4. **7.4** — Scheduled sending (improves deliverability)

## Files affected

### Link tracker project
- `app/api/links/create/route.ts` (new)

### Outreach pipeline project
- `src/generate/index.ts` (modified — API integration + HTML generation)
- `src/send/index.ts` (modified — HTML sending + schedule flag)
- `src/send/scheduler.ts` (new — schedule logic)
- `src/send/queue.ts` (new — queue file management)
- `src/review/display.ts` (minor — note about HTML version)
- Claude API system prompt (modified — {{TRACKED_LINK}} placeholder)
