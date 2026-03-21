Sync click data from the link tracker to your prospect spreadsheet.

## Default behaviour
- Run `npm run sync-clicks -- --dry-run` first to preview
- Show what would be updated (which RTOs clicked, how many new clicks)
- Ask if they want to write the changes to the spreadsheet

## Arguments
If the user provides $ARGUMENTS, parse them for:
- "dry" or "preview" → dry run only
- "week" → add --since 7d
- "today" → add --since 1d
- "write" → skip dry run, write immediately

## Examples
- `/sync-clicks` → dry run, then ask to confirm
- `/sync-clicks week` → only clicks from last 7 days, dry run first
- `/sync-clicks write` → sync immediately without preview

## Notes
- Updates columns: link_clicks, first_click, last_click, click_synced_at
- Creates a backup of the xlsx before writing
- The spreadsheet is at: D:\Projects\OneDrive\Desktop\Coding_projects\prospect_tracker\prospects\asqa_rtos_scored.xlsx
