/**
 * analytics-aggregates.ts — Pure, zero-side-effect aggregation helpers for
 * Phase 3.5 analytics. All functions are safe for empty arrays and guard
 * against NaN/Infinity (divide-by-zero checks everywhere).
 *
 * Constraint: no React imports, no UI dependencies — pure TS, fully testable.
 */

import type { CareerApplication } from "../types";
import { isoWeek } from "./compute-metrics";

// ---------------------------------------------------------------------------
// Date-range filter helpers
// ---------------------------------------------------------------------------

export type DateRangePreset = "30d" | "90d" | "all";

export interface DateRange {
  preset: DateRangePreset;
  /** Custom from boundary (ISO string). Only used when preset === "all" with custom bounds. */
  from?: string;
  /** Custom to boundary (ISO string). Only used when preset === "all" with custom bounds. */
  to?: string;
}

/** Return the cutoff Date for a preset, or null for "all" with no custom bounds. */
export function presetCutoff(range: DateRange, now: Date = new Date()): Date | null {
  if (range.preset === "30d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d;
  }
  if (range.preset === "90d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 90);
    return d;
  }
  // "all" — custom bounds handled by caller
  return null;
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Filter apps by:
 *  - active statuses (empty set → include all)
 *  - date range preset or custom from/to
 */
export function filterApps(
  apps: CareerApplication[],
  activeStatuses: Set<string>,
  range: DateRange,
  now: Date = new Date()
): CareerApplication[] {
  const cutoff = presetCutoff(range, now);
  const fromDate = range.from ? safeDate(range.from) : null;
  const toDate = range.to ? safeDate(range.to) : null;

  return apps.filter((a) => {
    // Status filter
    if (activeStatuses.size > 0 && !activeStatuses.has(a.status)) return false;

    // Date range filter
    const d = safeDate(a.date);
    if (d === null) return true; // keep apps with unparseable dates in "all" view

    if (cutoff !== null && d < cutoff) return false;
    if (fromDate !== null && d < fromDate) return false;
    if (toDate !== null && d > toDate) return false;

    return true;
  });
}

// ---------------------------------------------------------------------------
// Score-vs-time: average score per ISO week or calendar month
// ---------------------------------------------------------------------------

export type ScorePeriod = "week" | "month";

export interface ScoreTrendPoint {
  /** ISO week label (e.g. "2026-W03") or YYYY-MM month label. */
  period: string;
  /** Average score for apps in this period. 0 when no scored apps. */
  avgScore: number;
  /** Number of scored apps in this period. */
  count: number;
}

function monthKey(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Compute average score per time period (week or month).
 * Returns sorted ascending by period label. Periods with no scored apps are excluded.
 */
export function computeScoreTrend(
  apps: CareerApplication[],
  period: ScorePeriod = "week"
): ScoreTrendPoint[] {
  const buckets = new Map<string, { sum: number; count: number }>();

  for (const a of apps) {
    if (a.score === null || !Number.isFinite(a.score) || a.score <= 0) continue;
    const key = period === "week" ? isoWeek(a.date) : monthKey(a.date);
    if (!key) continue;
    const b = buckets.get(key) ?? { sum: 0, count: 0 };
    b.sum += a.score;
    b.count += 1;
    buckets.set(key, b);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { sum, count }]) => ({
      period,
      avgScore: count === 0 ? 0 : sum / count,
      count,
    }));
}

// ---------------------------------------------------------------------------
// Breakdown helpers: top companies, top roles, PDF coverage
// ---------------------------------------------------------------------------

export interface RankEntry {
  label: string;
  count: number;
  pct: number;
}

/**
 * Count apps by company, return top N sorted by count desc.
 * Zero-division safe: pct is 0 when total is 0.
 */
export function topCompanies(apps: CareerApplication[], n = 10): RankEntry[] {
  const counts = new Map<string, number>();
  for (const a of apps) {
    const key = a.company.trim() || "(unknown)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = apps.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({
      label,
      count,
      pct: total === 0 ? 0 : (count / total) * 100,
    }));
}

// Naive role-keyword extractor — strips seniority prefixes and common suffixes
// to surface the core role dimension (e.g. "Senior Product Manager" → "Product Manager").
const SENIORITY_RE =
  /^(senior|sr\.?|junior|jr\.?|lead|staff|principal|associate|mid[-\s]?level|head of|director of|vp of|chief|entry[- ]level)\s+/i;
const SUFFIX_RE =
  /\s+(i{1,3}|iv|v|1|2|3|\(remote\)|\(contract\)|contract|remote|hybrid|intern)$/i;

export function normalizeRoleLabel(role: string): string {
  return role
    .trim()
    .replace(SENIORITY_RE, "")
    .replace(SUFFIX_RE, "")
    .trim() || role.trim() || "(unknown)";
}

/**
 * Count apps by normalized role keyword, return top N sorted by count desc.
 */
export function topRoles(apps: CareerApplication[], n = 10): RankEntry[] {
  const counts = new Map<string, number>();
  for (const a of apps) {
    const key = normalizeRoleLabel(a.role);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = apps.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({
      label,
      count,
      pct: total === 0 ? 0 : (count / total) * 100,
    }));
}

/**
 * PDF coverage stats.
 * Zero-division safe: pct is 0 when total is 0.
 */
export interface PdfCoverage {
  withPDF: number;
  without: number;
  total: number;
  pct: number;
}

export function computePdfCoverage(apps: CareerApplication[]): PdfCoverage {
  const withPDF = apps.filter((a) => a.hasPDF).length;
  const total = apps.length;
  return {
    withPDF,
    without: total - withPDF,
    total,
    pct: total === 0 ? 0 : (withPDF / total) * 100,
  };
}

// ---------------------------------------------------------------------------
// Conversion rates per funnel stage
// ---------------------------------------------------------------------------

export interface ConversionRate {
  from: string;
  to: string;
  fromCount: number;
  toCount: number;
  /** Rate as percentage 0–100. 0 when fromCount is 0 (zero-division guard). */
  rate: number;
}

const FUNNEL_STEPS = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
] as const;

/**
 * Compute stage-to-stage conversion rates through the funnel.
 * Each rate = nextStageCount / currentStageCount * 100.
 * Zero-division guarded: rate is 0 whenever fromCount is 0.
 */
export function computeConversionRates(
  apps: CareerApplication[]
): ConversionRate[] {
  const byStatus: Record<string, number> = {};
  for (const a of apps) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  }

  const rates: ConversionRate[] = [];
  for (let i = 0; i < FUNNEL_STEPS.length - 1; i++) {
    const from = FUNNEL_STEPS[i];
    const to = FUNNEL_STEPS[i + 1];
    const fromCount = byStatus[from] ?? 0;
    const toCount = byStatus[to] ?? 0;
    rates.push({
      from,
      to,
      fromCount,
      toCount,
      rate: fromCount === 0 ? 0 : (toCount / fromCount) * 100,
    });
  }
  return rates;
}

// ---------------------------------------------------------------------------
// Unique statuses present in the dataset (for filter chip generation)
// ---------------------------------------------------------------------------

const STATUS_ORDER = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Rejected",
  "Discarded",
  "SKIP",
];

export function uniqueStatuses(apps: CareerApplication[]): string[] {
  const seen = new Set(apps.map((a) => a.status));
  return STATUS_ORDER.filter((s) => seen.has(s));
}
