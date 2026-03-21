# Handover — RTO Outreach Pipeline

## What happened this session (2026-03-22)

### Fixed: HTML email sending
- **Root cause:** `gws auth export` masks all secrets, so the OAuth token exchange with Gmail REST API never worked. Every "HTML" send silently fell back to plain text.
- **Fix:** Replaced the entire OAuth + MIME approach with `gws gmail +send --html` flag. One line. gws handles auth and encoding natively.
- **File changed:** `src/send/gws.ts` — stripped out `buildMime()`, `getAccessToken()`, and the Gmail REST API call. `gwsSendHtml()` now just calls gws CLI with `--html`.

### Fixed: Line breaks in emails
- Single `\n` within paragraphs was being converted to `<br>`, causing hard breaks mid-sentence.
- **Fix:** Changed `\n` → `' '` (space) in `applyTrackedLink()`. Double newlines still split into `<p>` tags.
- **File:** `src/generate/claude-client.ts:87`

### Fixed: Email width
- `max-width:600px` was too narrow. Changed to `750px`.
- **File:** `src/generate/claude-client.ts`

### Fixed: Signature block not showing
- Signature was a separate `<div>` after the main wrapper — Gmail clipped it.
- **Fix:** Moved signature inside the main wrapper div.
- Signature HTML now matches `signature.html` in project root.

### Fixed: Failing test
- `tests/generate.test.ts:57` — `buildUserPrompt()` signature changed but test wasn't updated.

### New feature: sync-sends
- `npm run sync-sends` — reads all CSV send logs, updates prospect xlsx with `email_sent_at`, `email_status`, `email_subject` columns.
- Same pattern as `sync-clicks` — direct cell writes, backup before writing.
- **File:** `src/sync/sync-sends.ts`

## TODO after moving to C: drive

### Hardcoded paths to update
These three files have hardcoded `D:\Projects\OneDrive\Desktop\Coding_projects\prospect_tracker\prospects\asqa_rtos_scored.xlsx`:
1. `src/enrich/index.ts:11` — default `--input` option
2. `src/sync/index.ts:10` — `DEFAULT_XLSX` const
3. `src/sync/sync-sends.ts:10` — `DEFAULT_XLSX` const

**Recommended:** Move the xlsx default path into `.env` as `PROSPECT_XLSX_PATH` and read it from config instead of hardcoding.

### Memory files
Claude project memory is keyed to the working directory path. The new C: drive location will start with a fresh memory context. Point Claude at this file to re-establish context.

## Current state
- All tests passing (54/54)
- HTML emails working with signature
- Pipeline fully operational
- All phases complete including sync-clicks and sync-sends
