Enrich RTO prospect data from training.gov.au.

## Default behaviour
- Run `npm run enrich -- --dry-run` first to preview 3 results
- Show the user what the enrichment found
- Ask if they want to run the full enrichment

## Arguments
If the user provides $ARGUMENTS, parse them for:
- "dry" or "preview" → dry run only
- "full" → skip dry run, run full enrichment
- "fresh" → add --from-scratch flag to re-enrich all RTOs

## Notes
- Full enrichment takes ~30 minutes for 3,600 RTOs (500ms delay between API calls)
- If interrupted, it auto-resumes from where it left off
- Enriched CSV is saved to data/enriched/rto-enriched-{date}.csv
- Source spreadsheet: D:\Projects\OneDrive\Desktop\Coding_projects\prospect_tracker\prospects\asqa_rtos_scored.xlsx
