import XLSX from 'xlsx';
import type { RtoInput } from '../shared/types.js';

// Raw shape of rows in the source xlsx — only columns we use
interface XlsxRow {
  code?: number | string;
  name?: string;
  location_area?: string;
  contact_name?: string;
  contact_role?: string;
  contact_email?: string;
  industry?: string;
  qualifications?: string;
  'first contact'?: string | number;
}

export interface XlsxReadResult {
  records: RtoInput[];
  alreadyContacted: number;
  missingCode: number;
}

export function readXlsx(filePath: string): XlsxReadResult {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<XlsxRow>(sheet);

  let alreadyContacted = 0;
  let missingCode = 0;
  const records: RtoInput[] = [];

  for (const row of rows) {
    // Skip RTOs we've already emailed
    if (row['first contact']) {
      alreadyContacted++;
      continue;
    }

    if (!row.code) {
      missingCode++;
      continue;
    }

    // name can be comma-separated trading names — use the first
    const rto_name = (row.name ?? '').split(',')[0].trim();

    records.push({
      rto_code: String(row.code),
      rto_name,
      contact_email: row.contact_email ?? '',
      contact_name: row.contact_name ?? '',
      contact_position: row.contact_role ?? '',
      industry: row.industry ?? '',
      training_packages: row.qualifications ?? '',
      location: row.location_area ?? '',
    });
  }

  return { records, alreadyContacted, missingCode };
}
