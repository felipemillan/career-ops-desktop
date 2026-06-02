import { describe, it, expect } from "vitest";
import {
  computePipelineMetrics,
  computeProgressMetrics,
  scoreBucketIndex,
  SCORE_BUCKET_LABELS,
  isoWeek,
} from "./compute-metrics";
import type { CareerApplication } from "../types";

function makeApp(overrides: Partial<CareerApplication> & { number: number }): CareerApplication {
  return {
    number: overrides.number,
    date: overrides.date ?? "2026-01-15",
    company: overrides.company ?? "Acme",
    role: overrides.role ?? "Manager",
    status: overrides.status ?? "Evaluated",
    score: overrides.score !== undefined ? overrides.score : 4.0,
    scoreRaw: overrides.scoreRaw ?? "4.0/5",
    hasPDF: overrides.hasPDF ?? false,
    reportPath: overrides.reportPath ?? null,
    reportNumber: overrides.reportNumber ?? null,
    notes: overrides.notes ?? "",
    jobURL: overrides.jobURL ?? null,
  };
}

const SMALL_FIXTURE: CareerApplication[] = [
  makeApp({ number: 1, status: "Applied",    score: 4.2, hasPDF: true,  date: "2026-01-10" }),
  makeApp({ number: 2, status: "Responded",  score: 3.8, hasPDF: false, date: "2026-01-15" }),
  makeApp({ number: 3, status: "Interview",  score: 4.5, hasPDF: true,  date: "2026-01-20" }),
  makeApp({ number: 4, status: "SKIP",       score: null, hasPDF: false, date: "2026-01-22" }),
  makeApp({ number: 5, status: "Rejected",   score: 2.5, hasPDF: false, date: "2026-01-25" }),
  makeApp({ number: 6, status: "Evaluated",  score: 4.8, hasPDF: true,  date: "2026-02-01" }),
];

// -------------------------------------------------------------------------
// scoreBucketIndex
// -------------------------------------------------------------------------
describe("scoreBucketIndex", () => {
  it("returns -1 for null", () => {
    expect(scoreBucketIndex(null)).toBe(-1);
  });

  it("returns -1 for undefined", () => {
    expect(scoreBucketIndex(undefined)).toBe(-1);
  });

  it("returns -1 for 0 (score must be > 0)", () => {
    expect(scoreBucketIndex(0)).toBe(-1);
  });

  it("returns -1 for negative score", () => {
    expect(scoreBucketIndex(-1)).toBe(-1);
  });

  it("maps 4.8 to the 4.5-5.0 bucket (index 0)", () => {
    expect(scoreBucketIndex(4.8)).toBe(0);
    expect(SCORE_BUCKET_LABELS[0]).toBe("4.5-5.0");
  });

  it("maps 4.2 to the 4.0-4.4 bucket (index 1)", () => {
    expect(scoreBucketIndex(4.2)).toBe(1);
    expect(SCORE_BUCKET_LABELS[1]).toBe("4.0-4.4");
  });

  it("maps 3.7 to the 3.5-3.9 bucket (index 2)", () => {
    expect(scoreBucketIndex(3.7)).toBe(2);
  });

  it("maps 3.1 to the 3.0-3.4 bucket (index 3)", () => {
    expect(scoreBucketIndex(3.1)).toBe(3);
  });

  it("maps 2.5 to the <3.0 bucket (index 4)", () => {
    expect(scoreBucketIndex(2.5)).toBe(4);
  });
});

// -------------------------------------------------------------------------
// computePipelineMetrics
// -------------------------------------------------------------------------
describe("computePipelineMetrics", () => {
  it("returns zeroed metrics for empty array", () => {
    const m = computePipelineMetrics([]);
    expect(m.total).toBe(0);
    expect(m.avgScore).toBe(0);
    expect(m.topScore).toBe(0);
    expect(m.withPDF).toBe(0);
    expect(m.actionable).toBe(0);
    expect(m.byStatus).toEqual({});
  });

  it("counts total correctly", () => {
    expect(computePipelineMetrics(SMALL_FIXTURE).total).toBe(6);
  });

  it("computes average score from scored apps only (ignores null scores)", () => {
    const m = computePipelineMetrics(SMALL_FIXTURE);
    // Scores: 4.2, 3.8, 4.5, 2.5, 4.8 (null is excluded)
    const expected = (4.2 + 3.8 + 4.5 + 2.5 + 4.8) / 5;
    expect(m.avgScore).toBeCloseTo(expected, 5);
  });

  it("finds top score", () => {
    expect(computePipelineMetrics(SMALL_FIXTURE).topScore).toBe(4.8);
  });

  it("counts PDFs correctly", () => {
    expect(computePipelineMetrics(SMALL_FIXTURE).withPDF).toBe(3);
  });

  it("counts actionable (Evaluated, Applied, Responded, Interview, Offer)", () => {
    // Applied, Responded, Interview, Evaluated = 4 actionable
    expect(computePipelineMetrics(SMALL_FIXTURE).actionable).toBe(4);
  });

  it("builds byStatus correctly", () => {
    const m = computePipelineMetrics(SMALL_FIXTURE);
    expect(m.byStatus["Applied"]).toBe(1);
    expect(m.byStatus["Responded"]).toBe(1);
    expect(m.byStatus["Interview"]).toBe(1);
    expect(m.byStatus["SKIP"]).toBe(1);
    expect(m.byStatus["Rejected"]).toBe(1);
    expect(m.byStatus["Evaluated"]).toBe(1);
  });

  it("avgScore is 0 (not NaN) when no scored apps", () => {
    const apps = [makeApp({ number: 1, score: null })];
    const m = computePipelineMetrics(apps);
    expect(m.avgScore).toBe(0);
    expect(Number.isNaN(m.avgScore)).toBe(false);
  });
});

// -------------------------------------------------------------------------
// computeProgressMetrics
// -------------------------------------------------------------------------
describe("computeProgressMetrics", () => {
  it("returns valid structure for empty array — no NaN or Infinity anywhere", () => {
    const m = computeProgressMetrics([]);
    // Rates must be 0, not NaN or Infinity
    expect(m.responseRate).toBe(0);
    expect(m.interviewRate).toBe(0);
    expect(m.offerRate).toBe(0);
    expect(Number.isNaN(m.responseRate)).toBe(false);
    expect(Number.isNaN(m.interviewRate)).toBe(false);
    expect(Number.isNaN(m.offerRate)).toBe(false);
    expect(Number.isFinite(m.responseRate)).toBe(true);
    expect(Number.isFinite(m.interviewRate)).toBe(true);
    expect(Number.isFinite(m.offerRate)).toBe(true);
    // Scores default to 0
    expect(m.avgScore).toBe(0);
    expect(m.topScore).toBe(0);
    expect(m.totalOffers).toBe(0);
    expect(m.activeApps).toBe(0);
    // Funnel and buckets are well-formed arrays
    expect(m.funnelStages).toHaveLength(5);
    expect(m.scoreBuckets).toHaveLength(5);
    expect(m.weeklyActivity).toHaveLength(0);
  });

  it("computes responseRate: responded/applied * 100", () => {
    // 1 Responded, 1 Applied
    const m = computeProgressMetrics(SMALL_FIXTURE);
    expect(m.responseRate).toBeCloseTo(100, 5); // 1/1 * 100
  });

  it("responseRate is 0 (not NaN) when applied=0", () => {
    const apps = [makeApp({ number: 1, status: "Evaluated", score: 4.0 })];
    const m = computeProgressMetrics(apps);
    expect(m.responseRate).toBe(0);
    expect(Number.isNaN(m.responseRate)).toBe(false);
  });

  it("computes interviewRate: interview/applied * 100", () => {
    const m = computeProgressMetrics(SMALL_FIXTURE);
    expect(m.interviewRate).toBeCloseTo(100, 5); // 1 interview / 1 applied
  });

  it("computes funnelStages with correct counts", () => {
    const m = computeProgressMetrics(SMALL_FIXTURE);
    const applied = m.funnelStages.find((s) => s.label === "Applied");
    expect(applied!.count).toBe(1);
    const interview = m.funnelStages.find((s) => s.label === "Interview");
    expect(interview!.count).toBe(1);
  });

  it("funnelStages pct sums ≤ 100 (each stage is pct of total, not of previous)", () => {
    const m = computeProgressMetrics(SMALL_FIXTURE);
    for (const s of m.funnelStages) {
      expect(s.pct).toBeGreaterThanOrEqual(0);
      expect(s.pct).toBeLessThanOrEqual(100);
    }
  });

  it("assigns scores to correct buckets", () => {
    const m = computeProgressMetrics(SMALL_FIXTURE);
    // 4.8 → bucket 0 (4.5-5.0), 4.5 → bucket 0, 4.2 → bucket 1 (4.0-4.4)
    // 3.8 → bucket 2 (3.5-3.9), 2.5 → bucket 4 (<3.0), null → skipped
    const bucket0 = m.scoreBuckets.find((b) => b.label === "4.5-5.0");
    expect(bucket0!.count).toBe(2); // 4.8, 4.5
    const bucket1 = m.scoreBuckets.find((b) => b.label === "4.0-4.4");
    expect(bucket1!.count).toBe(1); // 4.2
    const bucket4 = m.scoreBuckets.find((b) => b.label === "<3.0");
    expect(bucket4!.count).toBe(1); // 2.5
  });

  it("weeklyActivity is sorted chronologically", () => {
    const m = computeProgressMetrics(SMALL_FIXTURE);
    const weeks = m.weeklyActivity.map((w) => w.week);
    expect(weeks).toEqual([...weeks].sort());
  });

  it("activeApps excludes SKIP, Rejected, Discarded", () => {
    const m = computeProgressMetrics(SMALL_FIXTURE);
    // SKIP(1) + Rejected(1) = 2 inactive → 6 - 2 = 4 active
    expect(m.activeApps).toBe(4);
  });

  it("topScore is 0 (not NaN) for all-null scores", () => {
    const apps = [makeApp({ number: 1, score: null, status: "Evaluated" })];
    const m = computeProgressMetrics(apps);
    expect(m.topScore).toBe(0);
    expect(Number.isNaN(m.topScore)).toBe(false);
  });

  it("avgScore is 0 (not NaN) for all-null scores", () => {
    const apps = [makeApp({ number: 1, score: null, status: "Evaluated" })];
    const m = computeProgressMetrics(apps);
    expect(m.avgScore).toBe(0);
    expect(Number.isNaN(m.avgScore)).toBe(false);
  });

  // Explicit empty-repo guard: no NaN/Infinity anywhere in the metrics object
  it("empty-repo guard: all numeric fields are finite numbers", () => {
    const m = computeProgressMetrics([]);
    const numericFields: (keyof typeof m)[] = [
      "responseRate", "interviewRate", "offerRate",
      "avgScore", "topScore", "totalOffers", "activeApps",
    ];
    for (const field of numericFields) {
      const val = m[field] as number;
      expect(Number.isNaN(val)).toBe(false);
      expect(Number.isFinite(val)).toBe(true);
    }
    for (const stage of m.funnelStages) {
      expect(Number.isNaN(stage.pct)).toBe(false);
      expect(Number.isFinite(stage.pct)).toBe(true);
    }
  });
});

// -------------------------------------------------------------------------
// isoWeek (exported for testing)
// -------------------------------------------------------------------------
describe("isoWeek", () => {
  it("returns null for invalid date string", () => {
    expect(isoWeek("not-a-date")).toBeNull();
    expect(isoWeek("")).toBeNull();
  });

  it("returns a week string in YYYY-Www format", () => {
    const w = isoWeek("2026-01-15");
    expect(w).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("returns consistent results for the same week", () => {
    // 2026-01-12 (Monday) and 2026-01-15 (Thursday) are in the same ISO week
    expect(isoWeek("2026-01-12")).toBe(isoWeek("2026-01-15"));
  });
});
