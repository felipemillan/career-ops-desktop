import type { ReportSummary, ReportContent } from "../types";

const RE_URL = /^\*\*URL:\*\*\s*(https?:\S+)/m;
const RE_LEGITIMACY = /^\*\*Legitimacy:\*\*\s*(.+)$/m;
const RE_REPORT_FILENAME = /^(\d{3})-([a-z0-9-]+)-(\d{4}-\d{2}-\d{2})\.md$/;

/**
 * Match a report filename and return its parsed parts, or null if not a valid report filename.
 */
export function matchReportFilename(filename: string): ReportSummary | null {
  const m = filename.match(RE_REPORT_FILENAME);
  if (!m) return null;
  const id = filename.replace(/\.md$/, "");
  return {
    id,
    number: m[1],
    company: m[2],
    date: m[3],
    path: filename,
  };
}

/**
 * Parse the markdown content of a report file.
 * `id` must be in the format "NNN-company-YYYY-MM-DD" (no .md extension).
 * Returns null if the id doesn't match the expected pattern.
 */
export function parseReportContent(id: string, markdown: string): ReportContent | null {
  const m = id.match(/^(\d{3})-([a-z0-9-]+)-(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  const urlMatch = markdown.match(RE_URL);
  const legitMatch = markdown.match(RE_LEGITIMACY);
  return {
    id,
    number: m[1],
    company: m[2],
    date: m[3],
    path: `${id}.md`,
    markdown,
    url: urlMatch?.[1],
    legitimacy: legitMatch?.[1].trim(),
  };
}
