# Outreach Pipeline — Click Sync Script

## What to build

Add a `npm run sync-clicks` command that pulls click data from the link tracker API and updates the prospect spreadsheet with engagement data.

## Flow

1. Call the link tracker's `/api/clicks/summary` endpoint
2. Read the prospect xlsx spreadsheet
3. For each RTO in the summary, update or add columns in the spreadsheet
4. Save the spreadsheet

## Source

```
GET {LINK_TRACKER_URL}/api/clicks/summary?secret={CRON_SECRET}&since={optional}
```

Environment variables (already in .env):
- `LINK_TRACKER_URL` — base URL of the link tracker
- `CRON_SECRET` — shared secret for API auth

## Columns to add/update in the xlsx

| Column | Source | Description |
|--------|--------|-------------|
| `link_clicks` | `total_clicks` | Total click count for this RTO |
| `first_click` | `first_click` | Timestamp of first click |
| `last_click` | `last_click` | Timestamp of most recent click |
| `click_synced_at` | current time | When this sync ran |

## Matching logic

Match rows by `code` column in the xlsx to `rto_code` from the API response.

If an RTO has clicks in the API but doesn't exist in the spreadsheet, skip it (don't add new rows).

## Behaviour

- Only update rows where click data has changed (compare `link_clicks` to existing value)
- Preserve all existing data and formatting in the spreadsheet — only touch the four click columns
- If the click columns don't exist yet, create them at the end of the existing columns
- Print a summary when done: "Updated 12 RTOs. 3 new clicks since last sync."

## CLI

```
npm run sync-clicks                    # sync all-time click data
npm run sync-clicks -- --since 7d      # only clicks from last 7 days
npm run sync-clicks -- --dry-run       # show what would update without writing
```

The `--since` flag converts to an ISO datetime and passes it to the API's `since` parameter.

## File

- `src/sync/index.ts` — main entry point

## Important

- Read and write to the actual xlsx at the path configured as default input (the prospect tracker spreadsheet)
- Use the same xlsx library already in the project
- Do NOT create a copy — update in place
- Back up the file before writing: copy to `{filename}.backup-{date}.xlsx` in the same directory

## Testing

- Dry run shows updates without writing
- Backup file is created before writing
- Only click columns are modified — existing data untouched
- RTOs not in spreadsheet are skipped
- Summary output is accurate
