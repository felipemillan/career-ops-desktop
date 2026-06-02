/**
 * scan-history.ts — Pure parser for data/scan-history.tsv.
 *
 * TSV columns (confirmed from real file):
 *   url | first_seen | portal | title | company | status | location
 *
 * The header row is detected by checking if the first column equals the literal
 * string "url" (the header value). This avoids index-based skipping.
 * Location is optional (may be missing/empty).
 *
 * No node:fs, no invoke — pure function only.
 */

export type ScanHistoryRow = {
  /** Sequential row number (1-based, assigned at parse time) */
  num: number;
  url: string;
  first_seen: string;
  portal: string;
  title: string;
  company: string;
  status: string;
  location: string;
};

const HEADER_FIRST_COLUMN = 'url';

/**
 * Parse the raw text content of scan-history.tsv into typed rows.
 * Skips the header row (detected by first column == "url") and blank lines.
 */
export function parseScanHistory(content: string): ScanHistoryRow[] {
  if (!content || !content.trim()) return [];

  const rows: ScanHistoryRow[] = [];
  let num = 0;

  for (const raw of content.split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;

    const cols = line.split('\t');
    // Skip header row
    if (cols[0] === HEADER_FIRST_COLUMN) continue;

    const url = cols[0] ?? '';
    if (!url) continue; // skip malformed/empty rows

    num += 1;
    rows.push({
      num,
      url,
      first_seen: cols[1] ?? '',
      portal: cols[2] ?? '',
      title: cols[3] ?? '',
      company: cols[4] ?? '',
      status: cols[5] ?? '',
      location: cols[6] ?? '',
    });
  }

  return rows;
}
