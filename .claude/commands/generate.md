Generate outreach email drafts for RTOs.

## Default behaviour
- Run `npm run generate -- --limit 10 --dry-run` first to preview
- Show the user a summary of what was generated
- Ask if they want to generate for real before running without --dry-run

## Arguments
If the user provides $ARGUMENTS, parse them for:
- A number → use as --limit (e.g. "/generate 20" means --limit 20)
- "dry" or "preview" → add --dry-run
- "all" → no limit flag

## Examples
- `/generate` → dry run 10, then ask to confirm
- `/generate 5` → dry run 5, then ask to confirm
- `/generate 50 dry` → dry run 50 only
- `/generate all` → generate for all enriched RTOs (confirm first)

## Important
- This command automatically creates tracked links in the link tracker before generating emails
- If the link tracker API fails, generation will abort — check LINK_TRACKER_URL and CRON_SECRET in .env
- Generated drafts are saved to data/drafts/
