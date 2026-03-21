Run the full RTO outreach pipeline step by step.

## Behaviour
Walk through each step in order. Wait for user confirmation between steps. Never skip ahead.

### Step 1: Enrichment
- Run `npm run enrich -- --dry-run` to preview
- Ask: "Enrichment preview looks good. Run the full enrichment? (This takes ~30 mins for all RTOs, or you can skip if already enriched today)"
- If today's enriched CSV already exists, tell the user and ask if they want to skip this step

### Step 2: Generate emails
- Ask: "How many emails do you want to generate?"
- Run `npm run generate -- --limit {number} --dry-run` to preview
- Show 2-3 example emails from the dry run
- Ask: "These look good? Generate for real?"
- Run `npm run generate -- --limit {number}`

### Step 3: Review
- Tell the user: "Opening the review interface. Controls: a=approve, e=edit, s=skip, q=quit"
- Run `npm run review`
- After review finishes, report: "X approved, Y skipped"

### Step 4: Send
- Ask: "Do you want to send immediately or schedule for business hours (Mon-Thu 9-11 AM AEST)?"
- If immediate: run `npm run send -- --dry-run` first, show summary, ask for confirmation
- If schedule: run `npm run send -- --schedule`, show the queue summary

### Step 5: Done
- Summarise what was done: "Enriched X RTOs, generated Y emails, approved Z, sent/scheduled W"
- Remind: "Run /sync-clicks later to check who clicked"

## Important
- NEVER send without dry run + user confirmation
- If any step fails, stop and help troubleshoot before continuing
- The user can quit at any step and resume later — progress is saved
