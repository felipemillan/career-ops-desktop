import { describe, it, expect } from 'vitest';
import { parseScanHistory, type ScanHistoryRow } from './scan-history';

// ---------------------------------------------------------------------------
// Fixture — first real lines from data/scan-history.tsv (506 data rows + header)
// ---------------------------------------------------------------------------

const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';

const ROW1 =
  'https://jobs.ashbyhq.com/n8n/a8aea5b5-bde5-491e-adc0-affde5b3af3d\t2026-05-15\tashby\tHead of Developer Relations\tn8n\tadded\tRemote East Coast or Europe';
const ROW2 =
  'https://jobs.ashbyhq.com/n8n/dc7cdf46-c1ac-4330-b251-002c8d51c1a4\t2026-05-15\tashby\tHead of Product Marketing\tn8n\tadded\tRemote Europe';
const ROW3 =
  'https://jobs.ashbyhq.com/langfuse/60231438-f158-4e7b-b08d-12e5222fcc16\t2026-05-15\tashby\tFounding DevRel Engineer\tLangfuse\tadded';
const ROW4 =
  'https://jobs.ashbyhq.com/elevenlabs/40e06dd8-5108-4ec8-ab62-a3f1d1715794\t2026-05-15\tashby\tDeveloper Advocate\tElevenLabs\tadded';
const ROW5 =
  'https://job-boards.greenhouse.io/arizeai/jobs/5704428004\t2026-05-15\tgreenhouse\tDeveloper Relations Engineer\tArize AI\tadded\tRemote (San Francisco)';

const FIXTURE_WITH_HEADER = [HEADER, ROW1, ROW2, ROW3, ROW4, ROW5].join('\n');
const FIXTURE_NO_HEADER = [ROW1, ROW2, ROW3].join('\n');
const FIXTURE_EMPTY = '';
const FIXTURE_ONLY_HEADER = HEADER;
const FIXTURE_WITH_BLANKS = [HEADER, '', ROW1, '', ROW2].join('\n');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseScanHistory', () => {
  it('returns empty array for empty string', () => {
    expect(parseScanHistory(FIXTURE_EMPTY)).toEqual([]);
  });

  it('returns empty array when content is only whitespace', () => {
    expect(parseScanHistory('   \n\n  ')).toEqual([]);
  });

  it('returns empty array when content is only the header row', () => {
    const result = parseScanHistory(FIXTURE_ONLY_HEADER);
    expect(result).toHaveLength(0);
  });

  it('excludes the header row and returns correct row count', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    expect(result).toHaveLength(5);
  });

  it('assigns sequential 1-based num values', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    expect(result.map((r) => r.num)).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses url correctly', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    expect(result[0].url).toBe(
      'https://jobs.ashbyhq.com/n8n/a8aea5b5-bde5-491e-adc0-affde5b3af3d'
    );
  });

  it('parses first_seen correctly', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    expect(result[0].first_seen).toBe('2026-05-15');
  });

  it('parses portal correctly', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    expect(result[0].portal).toBe('ashby');
    expect(result[4].portal).toBe('greenhouse');
  });

  it('parses title correctly', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    expect(result[0].title).toBe('Head of Developer Relations');
    expect(result[2].title).toBe('Founding DevRel Engineer');
  });

  it('parses company correctly', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    expect(result[0].company).toBe('n8n');
    expect(result[4].company).toBe('Arize AI');
  });

  it('parses status correctly', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    expect(result[0].status).toBe('added');
  });

  it('parses location (present) correctly', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    expect(result[0].location).toBe('Remote East Coast or Europe');
    expect(result[4].location).toBe('Remote (San Francisco)');
  });

  it('returns empty string for missing location column', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    // ROW3 and ROW4 have no location column
    expect(result[2].location).toBe('');
    expect(result[3].location).toBe('');
  });

  it('skips blank lines between data rows', () => {
    const result = parseScanHistory(FIXTURE_WITH_BLANKS);
    expect(result).toHaveLength(2);
  });

  it('works correctly without a header row', () => {
    // If file somehow has no header, all rows should be parsed
    const result = parseScanHistory(FIXTURE_NO_HEADER);
    expect(result).toHaveLength(3);
    expect(result[0].url).toBe(
      'https://jobs.ashbyhq.com/n8n/a8aea5b5-bde5-491e-adc0-affde5b3af3d'
    );
  });

  it('returns correctly typed ScanHistoryRow objects', () => {
    const result = parseScanHistory(FIXTURE_WITH_HEADER);
    const row: ScanHistoryRow = result[0];
    expect(typeof row.num).toBe('number');
    expect(typeof row.url).toBe('string');
    expect(typeof row.first_seen).toBe('string');
    expect(typeof row.portal).toBe('string');
    expect(typeof row.title).toBe('string');
    expect(typeof row.company).toBe('string');
    expect(typeof row.status).toBe('string');
    expect(typeof row.location).toBe('string');
  });
});
