import { createReadStream, createWriteStream } from 'node:fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import type { RtoInput, RtoEnriched } from '../shared/types.js';

async function readCsv<T>(filePath: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const records: T[] = [];
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on('data', (row: T) => records.push(row))
      .on('end', () => resolve(records))
      .on('error', reject);
  });
}

export const readInputCsv = (filePath: string) => readCsv<RtoInput>(filePath);
export const readEnrichedCsv = (filePath: string) => readCsv<RtoEnriched>(filePath);

export async function writeEnrichedCsv(
  filePath: string,
  records: RtoEnriched[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const columns: (keyof RtoEnriched)[] = [
      'rto_code', 'rto_name', 'contact_email', 'contact_name',
      'contact_position', 'industry', 'training_packages', 'location',
      'api_status', 'api_name', 'scope_count', 'scope_summary',
      'enriched_at', 'enrichment_error',
    ];

    const ws = createWriteStream(filePath);
    stringify(records, { header: true, columns })
      .pipe(ws)
      .on('finish', resolve)
      .on('error', reject);
  });
}
