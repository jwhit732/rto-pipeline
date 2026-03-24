# RTO Outreach — Hybrid Workflow

This guide covers the recommended way to run the outreach pipeline using **Claude Code CLI for execution** and **Cowork for review and approval**.

The pipeline has two types of steps: ones that need network access (enrich, generate, send, sync) and ones that are purely local file operations (review, approve, edit drafts). CLI handles the first; Cowork handles the second.

---

## Setup

Make sure you're in the project directory for all CLI commands:

```bash
cd D:\Projects\OneDrive\Desktop\Coding_projects\rto-outreach-pipeline
```

Your Cowork workspace folder should be the same directory (or its parent), so both tools are reading and writing the same files.

---

## The Workflow

### 1. Enrich (CLI)

Fetches current RTO data from training.gov.au. Requires network access — must run in CLI.

```bash
npm run enrich -- --dry-run       # preview first
npm run enrich                     # full run (~30 mins)
```

Enrichment auto-resumes if interrupted. RTOs already contacted (with `first contact` in the xlsx) are skipped automatically.

### 2. Generate (CLI)

Calls the Anthropic API to write personalised emails. Requires network access — must run in CLI.

```bash
npm run generate -- --limit 20    # generate a batch of 20
```

The generate script automatically:
- Skips RTOs that already have drafts from previous runs
- Skips test RTOs (codes 99000+) — use `--include-test` to override
- Picks up the next batch from where it left off

Output lands in `data/drafts/outreach-drafts-YYYY-MM-DD.json`.

### 3. Review and Approve (Cowork)

This is where Cowork shines. Open Cowork and say something like:

> "Show me the new drafts"

or

> "Let's review the latest emails"

Cowork will read the draft JSON, present each email with subject line, body, and recipient details, and ask you to **approve**, **edit**, or **skip** each one.

To edit, just say what you want changed in plain English:

> "Shorten the subject line on draft 2"
> "Make the Phoenix Academy email less formal"
> "Remove the second paragraph"

When you approve drafts, Cowork updates the status in the draft JSON. The send script will automatically pick up approved drafts — even if they're still in `data/drafts/` rather than `data/approved/`.

### 4. Send or Schedule (CLI)

Requires Gmail auth via gws — must run in CLI.

**Send immediately:**
```bash
npm run send -- --dry-run          # always dry run first
npm run send                       # send for real after confirming
```

**Schedule for business hours:**
```bash
npm run send -- --schedule         # queues for Mon-Thu 9-11 AM AEST
```

After sending, the script **automatically syncs** send status to your prospect xlsx. Use `--no-sync` to skip this.

### 5. Sync Manually (CLI — only if needed)

Auto-sync runs after every send, so you shouldn't need this often. But if you do:

```bash
npm run sync-sends                 # update xlsx from send logs
```

### 6. Check Engagement (CLI → Cowork)

Sync click data from the link tracker, then review in Cowork:

```bash
npm run sync-clicks                # pulls click data into xlsx
```

Then in Cowork:

> "Who's clicked? Show me the engaged RTOs"

---

## Quick Reference

| Step | Where | Command / Action |
|---|---|---|
| Enrich | CLI | `npm run enrich` |
| Generate | CLI | `npm run generate -- --limit 20` |
| Review & approve | **Cowork** | "Show me the drafts" / "Approve all" |
| Send | CLI | `npm run send -- --dry-run` then `npm run send` |
| Schedule | CLI | `npm run send -- --schedule` |
| Sync clicks | CLI | `npm run sync-clicks` |
| Review engagement | **Cowork** | "Who clicked?" |

---

## Tips

**Batch size:** Don't generate or send everything at once. Work in batches of 20-50. This lets you review quality, adjust the prompt if needed, and stay under daily send limits for deliverability.

**Generate is incremental.** Just run `npm run generate -- --limit 20` each time — it skips already-processed RTOs and test data automatically.

**Review in Cowork is faster than the CLI.** You can approve multiple drafts at once ("approve all"), make bulk edits ("shorten all subject lines over 60 chars"), and get a second opinion on tone and personalisation quality.

**Send finds approved drafts automatically.** You don't need to manually copy files to `data/approved/`. If Cowork marks drafts as approved in the draft JSON, the send script picks them up.

**Spreadsheet syncs automatically after send.** No need to run `sync-sends` manually unless something went wrong.

**If something goes wrong with send:** Check `data/logs/send-log-*.csv` for error details. Re-running send is safe — it won't re-send emails that already went out.

**Re-auth Gmail:** If send fails with an auth error, run `gws auth login` in your terminal before retrying.

**OS-aware paths:** The `.env` file supports both `PROSPECT_XLSX_PATH` (Windows) and `PROSPECT_XLSX_PATH_LINUX` (for Cowork sandbox). The config auto-detects which to use — no need to swap paths manually.
