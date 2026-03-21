import chalk from 'chalk';
import type { EmailDraft } from '../shared/types.js';

const W = Math.min(process.stdout.columns ?? 72, 80);
const DIV = chalk.dim('─'.repeat(W));

export function clearScreen(): void {
  process.stdout.write('\x1Bc');
}

export function displayDraft(draft: EmailDraft, index: number, total: number): void {
  clearScreen();
  console.log(DIV);
  console.log(chalk.bold.cyan(`  Reviewing ${index + 1} / ${total}`));
  console.log(DIV);
  console.log();
  console.log(`  ${chalk.dim('RTO')}       ${chalk.bold(draft.rto_name)} ${chalk.dim(`(${draft.rto_code})`)}`);
  console.log(`  ${chalk.dim('Contact')}   ${draft.contact_name}${draft.contact_position ? chalk.dim(` — ${draft.contact_position}`) : ''}`);
  console.log(`  ${chalk.dim('Email')}     ${chalk.dim(draft.contact_email)}`);
  console.log();
  console.log(`  ${chalk.dim('Subject')}   ${chalk.yellow(draft.subject)}`);
  console.log();
  for (const line of draft.body.split('\n')) {
    console.log(`  ${line}`);
  }
  console.log();
  if (draft.body_html) {
    console.log(chalk.dim(`  ↳ Sent version will include a clickable tracked link`));
    console.log();
  }
  console.log(DIV);
  console.log(
    `  ${chalk.green.bold('[a]')} approve   ` +
    `${chalk.blue.bold('[e]')} edit   ` +
    `${chalk.yellow.bold('[s]')} skip   ` +
    `${chalk.red.bold('[q]')} quit`
  );
  console.log(DIV);
}

export function print(msg: string): void {
  console.log(`  ${msg}`);
}
