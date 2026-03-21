import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import type { EmailDraft } from '../shared/types.js';

const PROGRESS_FILE = 'data/.review-progress';

export interface ReviewProgress {
  inputFile: string;
  currentIndex: number;
  approved: EmailDraft[];
}

export function loadProgress(): ReviewProgress | null {
  if (!existsSync(PROGRESS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')) as ReviewProgress;
  } catch {
    return null;
  }
}

export function saveProgress(p: ReviewProgress): void {
  writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

export function clearProgress(): void {
  if (existsSync(PROGRESS_FILE)) unlinkSync(PROGRESS_FILE);
}
