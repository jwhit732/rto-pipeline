import { program } from 'commander';
import { createInterface } from 'node:readline';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { loadProgress, saveProgress, clearProgress } from './progress.js';
import { displayDraft, clearScreen, print } from './display.js';
import { logger } from '../shared/logger.js';
import type { EmailDraft } from '../shared/types.js';

program
  .option('--input <path>', 'Drafts JSON path (defaults to latest in data/drafts/)')
  .option('--dry-run', 'Read-only mode — display emails without recording approvals');

const argStart = process.argv.findIndex((a, i) => i >= 2 && a.startsWith('-'));
program.parse(argStart >= 0 ? process.argv.slice(argStart) : [], { from: 'user' });

const opts = program.opts<{ input?: string; dryRun: boolean }>();

function findLatestDraftsJson(): string {
  const dir = 'data/drafts';
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('outreach-drafts-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error('No drafts JSON found in data/drafts/ — run npm run generate first');
  }
  return join(dir, files[0]);
}

// Read a single raw keystroke from stdin (must be in raw mode)
function readKey(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.once('data', (buf: Buffer) => resolve(buf.toString()));
  });
}

// Prompt using readline (for when stdin is NOT in raw mode)
async function askQuestion(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function pauseRaw(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

function resumeRaw(): void {
  process.stdin.resume();
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
}

async function openEditor(draft: EmailDraft): Promise<EmailDraft> {
  pauseRaw();

  const tmpFile = join(tmpdir(), `rto-review-${draft.rto_code}.txt`);
  writeFileSync(tmpFile, `${draft.subject}\n---\n${draft.body}\n`);

  const editor = process.env.EDITOR ?? (process.platform === 'win32' ? 'notepad' : 'nano');
  spawnSync(editor, [tmpFile], { stdio: 'inherit' });

  resumeRaw();

  const content = readFileSync(tmpFile, 'utf8');
  const sepIdx = content.indexOf('\n---\n');

  if (sepIdx === -1) {
    print(chalk.yellow('⚠ Could not parse edited content — keeping original'));
    return draft;
  }

  return {
    ...draft,
    subject: content.slice(0, sepIdx).trim(),
    body: content.slice(sepIdx + 5).trim(),
  };
}

async function run() {
  const inputFile = opts.input ?? findLatestDraftsJson();
  const allDrafts: EmailDraft[] = JSON.parse(readFileSync(inputFile, 'utf8')) as EmailDraft[];
  const pending = allDrafts.filter((d) => d.status === 'pending');

  if (pending.length === 0) {
    logger.warn('No pending drafts to review');
    return;
  }

  logger.info(`Loaded ${pending.length} pending drafts from ${inputFile}`);

  let startIndex = 0;
  let approved: EmailDraft[] = [];

  // Resume check (before entering raw mode, so we can use readline)
  const prev = loadProgress();
  if (prev && prev.inputFile === inputFile && prev.currentIndex > 0) {
    const answer = await askQuestion(
      `  Resume from email ${prev.currentIndex + 1} / ${pending.length}? [y/n] `
    );
    if (answer.toLowerCase() !== 'n') {
      startIndex = prev.currentIndex;
      approved = prev.approved;
      logger.info(`Resuming from ${startIndex + 1} (${approved.length} already approved)`);
    }
  }

  if (!process.stdin.isTTY) {
    logger.error('stdin is not a TTY — interactive review requires a real terminal');
    process.exit(1);
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();

  let quit = false;

  for (let i = startIndex; i < pending.length && !quit; i++) {
    const draft = pending[i];
    displayDraft(draft, i, pending.length);

    // Dry-run: just page through
    if (opts.dryRun) {
      print(chalk.dim('Dry run — [any key] next   [q] quit'));
      const k = await readKey();
      if (k === 'q' || k === '\u0003') quit = true;
      continue;
    }

    let handled = false;
    while (!handled) {
      const key = (await readKey()).toLowerCase();

      if (key === '\u0003') { // Ctrl+C
        saveProgress({ inputFile, currentIndex: i, approved });
        quit = true;
        handled = true;
        break;
      }

      switch (key) {
        case 'a':
          approved.push({ ...draft, status: 'approved' });
          saveProgress({ inputFile, currentIndex: i + 1, approved });
          print(chalk.green('✓ Approved'));
          handled = true;
          break;

        case 'e': {
          const edited = await openEditor(draft);
          displayDraft(edited, i, pending.length);
          print(chalk.blue('Save edit and approve? [y/n]'));
          const confirm = (await readKey()).toLowerCase();
          if (confirm === 'y') {
            approved.push({ ...edited, status: 'approved' });
            saveProgress({ inputFile, currentIndex: i + 1, approved });
            print(chalk.green('✓ Edited and approved'));
            handled = true;
          } else {
            // Discard edit — re-display original and ask again
            displayDraft(draft, i, pending.length);
            print(chalk.dim('Edit discarded'));
          }
          break;
        }

        case 's':
          saveProgress({ inputFile, currentIndex: i + 1, approved });
          print(chalk.yellow('→ Skipped'));
          handled = true;
          break;

        case 'q':
          saveProgress({ inputFile, currentIndex: i, approved });
          print(chalk.red('Progress saved — run again to resume'));
          quit = true;
          handled = true;
          break;
      }
    }

    // Brief pause so the status line is visible before the next email loads
    if (handled && !quit) await new Promise((r) => setTimeout(r, 100));
  }

  process.stdin.setRawMode(false);
  process.stdin.pause();

  if (quit) {
    process.exit(0);
  }

  // All reviewed — write output
  clearScreen();
  logger.success(`Review complete. ${approved.length} approved out of ${pending.length} pending.`);

  if (opts.dryRun || approved.length === 0) {
    if (approved.length === 0) logger.warn('No emails approved — nothing written');
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const outPath = join('data/approved', `outreach-approved-${date}.json`);
  writeFileSync(outPath, JSON.stringify(approved, null, 2));
  logger.success(`Written to ${outPath}`);
  clearProgress();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    logger.error(String(err));
    process.exit(1);
  });
}
