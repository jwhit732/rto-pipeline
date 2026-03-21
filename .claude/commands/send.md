Send approved outreach emails via Google Workspace Gmail.

## Default behaviour
- ALWAYS run `npm run send -- --dry-run` first
- Show the user exactly what would be sent (count, recipients)
- Ask for explicit confirmation before running without --dry-run
- NEVER send without user approval

## Arguments
If the user provides $ARGUMENTS, parse them for:
- "dry" → dry run only
- "schedule" → run `npm run send -- --schedule` to queue for Mon-Thu 9-11 AM AEST
- "queue" or "process" → run `npm run send -- --process-queue` to send queued emails whose time has passed

## Examples
- `/send` → dry run, then ask to confirm
- `/send dry` → dry run only
- `/send schedule` → queue for business hours
- `/send queue` → process the scheduled queue

## Important
- Emails are sent as HTML from james@smartaisolutions.au via gws
- If gws auth fails, tell the user to run `gws auth login` first
- Batch size is controlled by BATCH_SIZE in .env (default 50)
- Send log is saved to data/logs/
- The script tracks what's been sent — if interrupted, it won't re-send on restart
