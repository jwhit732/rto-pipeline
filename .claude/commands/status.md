Show the current status of the outreach pipeline.

## Behaviour
Check and report on each stage:

### Enrichment
- Check if data/enriched/rto-enriched-{today}.csv exists
- If yes: report row count and when it was created
- If no: report most recent enriched CSV and its date

### Drafts
- Check data/drafts/ for the most recent drafts JSON
- Report: how many drafts, how many pending/generated/skipped

### Approved
- Check data/approved/ for the most recent approved JSON
- Report: how many approved, how many sent, how many pending

### Send log
- Check data/logs/ for the most recent send log
- Report: total sent, success/fail counts, last send date

### Queue
- Check data/queue/ for any pending scheduled sends
- Report: how many queued, next scheduled time

### Format
Show a clean summary like:
```
Pipeline Status
───────────────
Enriched:  3,247 RTOs (2026-03-14)
Drafts:    50 generated, 3 skipped (2026-03-15)
Approved:  42 approved, 5 skipped (2026-03-15)
Sent:      38 sent, 4 failed (2026-03-15)
Queued:    0 scheduled
Clicks:    12 total, 3 new since last sync
```
