import type { CareerApplication } from "../types";

const RE_REPORT_LINK = /\[(\d+)\]\(([^)]+)\)/;
const RE_SCORE = /(\d+\.?\d*)\/5/;

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed.slice(1, -1).split("|").map((c) => c.trim());
}

function parseRow(cells: string[]): CareerApplication | null {
  if (cells.length < 9) return null;
  const num = parseInt(cells[0], 10);
  if (isNaN(num)) return null;

  const scoreMatch = cells[4].match(RE_SCORE);
  let score: number | null = null;
  if (scoreMatch) {
    const v = parseFloat(scoreMatch[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 5) score = v;
  }

  const reportMatch = cells[7].match(RE_REPORT_LINK);
  const reportNumber = reportMatch ? reportMatch[1] : null;
  const reportPath = reportMatch ? reportMatch[2] : null;

  return {
    number: num,
    date: cells[1],
    company: cells[2],
    role: cells[3],
    score,
    scoreRaw: cells[4],
    status: cells[5].replace(/\*\*/g, "").trim(),
    hasPDF: cells[6].includes("✅"),
    reportPath,
    reportNumber,
    notes: cells[8],
    jobURL: null,
  };
}

export function parseApplications(content: string): CareerApplication[] {
  if (!content) return [];
  const out: CareerApplication[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("# ") || t.startsWith("|---") || t.startsWith("| #")) continue;
    const cells = splitRow(t);
    const app = parseRow(cells);
    if (app) out.push(app);
  }
  return out.sort((a, b) => b.number - a.number);
}
