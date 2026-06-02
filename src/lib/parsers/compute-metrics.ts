import type {
  CareerApplication,
  PipelineMetrics,
  ProgressMetrics,
  FunnelStage,
  ScoreBucket,
  WeekActivity,
} from "../types";

// ---------------------------------------------------------------------------
// Score bands — inlined from score-thresholds.ts (no UI dependencies needed)
// ---------------------------------------------------------------------------

const SCORE_BANDS = [
  { min: 4.5, label: "4.5-5.0" },
  { min: 4.0, label: "4.0-4.4" },
  { min: 3.5, label: "3.5-3.9" },
  { min: 3.0, label: "3.0-3.4" },
  { min: 0,   label: "<3.0"    },
] as const;

export const SCORE_BUCKET_LABELS: string[] = SCORE_BANDS.map((b) => b.label);

export function scoreBucketIndex(score: number | null | undefined): number {
  if (score === null || score === undefined || !Number.isFinite(score) || score <= 0) return -1;
  for (let i = 0; i < SCORE_BANDS.length; i++) {
    if (score >= SCORE_BANDS[i].min) return i;
  }
  return SCORE_BANDS.length - 1;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ACTIONABLE = new Set(["Evaluated", "Applied", "Responded", "Interview", "Offer"]);
const FUNNEL_ORDER = ["Evaluated", "Applied", "Responded", "Interview", "Offer"];
const INACTIVE = new Set(["SKIP", "Rejected", "Discarded"]);

function isScored(s: number | null): s is number {
  return s !== null && Number.isFinite(s) && s > 0;
}

export function isoWeek(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computePipelineMetrics(apps: CareerApplication[]): PipelineMetrics {
  const byStatus: Record<string, number> = {};
  let totalScore = 0;
  let scored = 0;
  let topScore: number | null = null;
  let withPDF = 0;
  let actionable = 0;
  for (const a of apps) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    if (isScored(a.score)) {
      totalScore += a.score;
      scored += 1;
      if (topScore === null || a.score > topScore) topScore = a.score;
    }
    if (a.hasPDF) withPDF += 1;
    if (ACTIONABLE.has(a.status)) actionable += 1;
  }
  return {
    total: apps.length,
    byStatus,
    avgScore: scored === 0 ? 0 : totalScore / scored,
    topScore: topScore ?? 0,
    withPDF,
    actionable,
  };
}

export function computeProgressMetrics(apps: CareerApplication[]): ProgressMetrics {
  const byStatus: Record<string, number> = {};
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;

  const total = apps.length || 1;
  const funnelStages: FunnelStage[] = FUNNEL_ORDER.map((label) => {
    const count = byStatus[label] ?? 0;
    return { label, count, pct: (count / total) * 100 };
  });

  const buckets: ScoreBucket[] = SCORE_BUCKET_LABELS.map((label) => ({ label, count: 0 }));
  for (const a of apps) {
    if (!isScored(a.score)) continue;
    const idx = scoreBucketIndex(a.score);
    if (idx >= 0 && idx < buckets.length) buckets[idx].count++;
  }

  const weekMap = new Map<string, number>();
  for (const a of apps) {
    const w = isoWeek(a.date);
    if (!w) continue;
    weekMap.set(w, (weekMap.get(w) ?? 0) + 1);
  }
  const weeklyActivity: WeekActivity[] = [...weekMap.entries()]
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));

  const applied = byStatus["Applied"] ?? 0;
  const responded = byStatus["Responded"] ?? 0;
  const interview = byStatus["Interview"] ?? 0;
  const offer = byStatus["Offer"] ?? 0;

  // Guard zero-division: if no applications have been sent, all rates are 0
  const responseRate = applied === 0 ? 0 : (responded / applied) * 100;
  const interviewRate = applied === 0 ? 0 : (interview / applied) * 100;
  const offerRate = applied === 0 ? 0 : (offer / applied) * 100;

  let scoreSum = 0;
  let scored = 0;
  let top: number | null = null;
  let active = 0;
  for (const a of apps) {
    if (isScored(a.score)) {
      scoreSum += a.score;
      scored += 1;
      if (top === null || a.score > top) top = a.score;
    }
    if (!INACTIVE.has(a.status)) active += 1;
  }

  return {
    funnelStages,
    scoreBuckets: buckets,
    weeklyActivity,
    responseRate,
    interviewRate,
    offerRate,
    avgScore: scored === 0 ? 0 : scoreSum / scored,
    topScore: top ?? 0,
    totalOffers: offer,
    activeApps: active,
  };
}
