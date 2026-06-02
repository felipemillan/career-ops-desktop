/**
 * analytics-aggregates.test.ts — Unit tests for Phase 3.5 analytics helpers.
 */
import { describe, it, expect } from "vitest";
import type { CareerApplication } from "../types";
import {
  filterApps,
  computeScoreTrend,
  topCompanies,
  topRoles,
  normalizeRoleLabel,
  computePdfCoverage,
  computeConversionRates,
  uniqueStatuses,
  presetCutoff,
} from "./analytics-aggregates";

// ---------------------------------------------------------------------------
// Test fixture factory
// ---------------------------------------------------------------------------

function makeApp(overrides: Partial<CareerApplication> & { number: number }): CareerApplication {
  return {
    number: overrides.number,
    date: overrides.date ?? "2026-01-15",
    company: overrides.company ?? "Acme",
    role: overrides.role ?? "Engineer",
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

const FIXTURE: CareerApplication[] = [
  makeApp({ number: 1, company: "Acme",   role: "Senior Product Manager", status: "Evaluated", score: 4.5, hasPDF: true,  date: "2026-01-05" }),
  makeApp({ number: 2, company: "Beta",   role: "Product Manager",        status: "Applied",   score: 4.2, hasPDF: true,  date: "2026-01-12" }),
  makeApp({ number: 3, company: "Acme",   role: "Lead Product Manager",   status: "Responded", score: 3.9, hasPDF: false, date: "2026-01-20" }),
  makeApp({ number: 4, company: "Gamma",  role: "Software Engineer",      status: "Interview", score: 4.8, hasPDF: true,  date: "2026-02-01" }),
  makeApp({ number: 5, company: "Delta",  role: "Junior Software Engineer",status: "Offer",    score: 4.9, hasPDF: false, date: "2026-02-10" }),
  makeApp({ number: 6, company: "Gamma",  role: "Software Engineer",      status: "Rejected",  score: 2.8, hasPDF: false, date: "2026-02-15" }),
  makeApp({ number: 7, company: "Epsilon",role: "Data Analyst",           status: "SKIP",      score: null,hasPDF: false, date: "2026-02-20" }),
  makeApp({ number: 8, company: "Acme",   role: "Product Manager",        status: "Evaluated", score: 4.1, hasPDF: true,  date: "2026-03-01" }),
];

// ---------------------------------------------------------------------------
// presetCutoff
// ---------------------------------------------------------------------------

describe("presetCutoff", () => {
  const now = new Date("2026-03-01T00:00:00Z");

  it("returns 30 days before now for '30d'", () => {
    const cutoff = presetCutoff({ preset: "30d" }, now);
    expect(cutoff).not.toBeNull();
    expect(cutoff!.toISOString().slice(0, 10)).toBe("2026-01-30");
  });

  it("returns 90 days before now for '90d'", () => {
    const cutoff = presetCutoff({ preset: "90d" }, now);
    expect(cutoff).not.toBeNull();
    expect(cutoff!.toISOString().slice(0, 10)).toBe("2025-12-01");
  });

  it("returns null for 'all'", () => {
    expect(presetCutoff({ preset: "all" }, now)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterApps
// ---------------------------------------------------------------------------

describe("filterApps", () => {
  it("returns all apps when statuses is empty and range is 'all'", () => {
    const result = filterApps(FIXTURE, new Set(), { preset: "all" });
    expect(result).toHaveLength(FIXTURE.length);
  });

  it("filters by status", () => {
    const result = filterApps(FIXTURE, new Set(["Applied", "Interview"]), { preset: "all" });
    expect(result.every((a) => ["Applied", "Interview"].includes(a.status))).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("filters by date range '30d' relative to supplied now", () => {
    const now = new Date("2026-03-10T00:00:00Z");
    const result = filterApps(FIXTURE, new Set(), { preset: "30d" }, now);
    // Only apps from 2026-02-08 onwards (30 days before 2026-03-10)
    expect(result.every((a) => new Date(a.date) >= new Date("2026-02-08"))).toBe(true);
  });

  it("filters by custom from/to date", () => {
    const result = filterApps(FIXTURE, new Set(), {
      preset: "all",
      from: "2026-01-15",
      to: "2026-02-01",
    });
    expect(result.every((a) => {
      const d = new Date(a.date);
      return d >= new Date("2026-01-15") && d <= new Date("2026-02-01");
    })).toBe(true);
    // Apps 3 (01-20) and 4 (02-01) are in range
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty array when no apps match", () => {
    const result = filterApps(FIXTURE, new Set(["Offer"]), {
      preset: "all",
      from: "2026-01-01",
      to: "2026-01-10",
    });
    expect(result).toHaveLength(0);
  });

  it("does not crash for empty apps array", () => {
    expect(() => filterApps([], new Set(["Applied"]), { preset: "30d" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// computeScoreTrend
// ---------------------------------------------------------------------------

describe("computeScoreTrend", () => {
  it("returns empty array for empty input", () => {
    expect(computeScoreTrend([])).toHaveLength(0);
  });

  it("skips apps with null score", () => {
    const apps = [
      makeApp({ number: 1, score: null, date: "2026-01-10" }),
      makeApp({ number: 2, score: 4.0, date: "2026-01-10" }),
    ];
    const result = computeScoreTrend(apps, "week");
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(1);
  });

  it("computes correct average per week (zero-division safe)", () => {
    const apps = [
      makeApp({ number: 1, score: 4.0, date: "2026-01-12" }), // W02
      makeApp({ number: 2, score: 5.0, date: "2026-01-12" }), // W02
      makeApp({ number: 3, score: 3.0, date: "2026-01-19" }), // W04
    ];
    const result = computeScoreTrend(apps, "week");
    expect(result).toHaveLength(2);
    const first = result.find((r) => r.count === 2);
    expect(first?.avgScore).toBeCloseTo(4.5, 5);
    const second = result.find((r) => r.count === 1);
    expect(second?.avgScore).toBeCloseTo(3.0, 5);
    expect(Number.isNaN(first?.avgScore)).toBe(false);
    expect(Number.isNaN(second?.avgScore)).toBe(false);
  });

  it("computes correct average per month", () => {
    const apps = [
      makeApp({ number: 1, score: 4.0, date: "2026-01-05" }),
      makeApp({ number: 2, score: 5.0, date: "2026-01-20" }),
      makeApp({ number: 3, score: 3.0, date: "2026-02-10" }),
    ];
    const result = computeScoreTrend(apps, "month");
    expect(result).toHaveLength(2);
    const jan = result.find((r) => r.period === "2026-01");
    expect(jan?.avgScore).toBeCloseTo(4.5, 5);
    const feb = result.find((r) => r.period === "2026-02");
    expect(feb?.avgScore).toBeCloseTo(3.0, 5);
  });

  it("is sorted ascending by period", () => {
    const result = computeScoreTrend(FIXTURE, "week");
    const periods = result.map((r) => r.period);
    expect(periods).toEqual([...periods].sort());
  });

  it("avgScore is never NaN", () => {
    const result = computeScoreTrend(FIXTURE, "week");
    expect(result.every((r) => !Number.isNaN(r.avgScore))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// topCompanies
// ---------------------------------------------------------------------------

describe("topCompanies", () => {
  it("returns empty array for empty input", () => {
    expect(topCompanies([])).toHaveLength(0);
  });

  it("pct is 0 (not NaN) for empty input", () => {
    expect(topCompanies([])).toHaveLength(0); // no entries to check
    // Also guard single-app case
    const result = topCompanies([makeApp({ number: 1, company: "X" })]);
    expect(result[0].pct).toBeCloseTo(100, 5);
    expect(Number.isNaN(result[0].pct)).toBe(false);
  });

  it("returns companies sorted by count desc", () => {
    const result = topCompanies(FIXTURE);
    // Acme appears 3 times, Gamma 2 times
    expect(result[0].label).toBe("Acme");
    expect(result[0].count).toBe(3);
    expect(result[1].label).toBe("Gamma");
    expect(result[1].count).toBe(2);
  });

  it("respects top N limit", () => {
    const result = topCompanies(FIXTURE, 2);
    expect(result).toHaveLength(2);
  });

  it("pct values are finite and between 0 and 100", () => {
    const result = topCompanies(FIXTURE);
    for (const r of result) {
      expect(Number.isFinite(r.pct)).toBe(true);
      expect(r.pct).toBeGreaterThanOrEqual(0);
      expect(r.pct).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeRoleLabel / topRoles
// ---------------------------------------------------------------------------

describe("normalizeRoleLabel", () => {
  it("strips seniority prefixes", () => {
    expect(normalizeRoleLabel("Senior Product Manager")).toBe("Product Manager");
    expect(normalizeRoleLabel("Sr. Software Engineer")).toBe("Software Engineer");
    expect(normalizeRoleLabel("Lead Data Scientist")).toBe("Data Scientist");
    expect(normalizeRoleLabel("Junior Developer")).toBe("Developer");
    expect(normalizeRoleLabel("Staff Engineer")).toBe("Engineer");
  });

  it("strips common suffixes", () => {
    expect(normalizeRoleLabel("Software Engineer (Remote)")).toBe("Software Engineer");
    expect(normalizeRoleLabel("Product Manager I")).toBe("Product Manager");
    expect(normalizeRoleLabel("Engineer II")).toBe("Engineer");
  });

  it("does not strip non-prefix words", () => {
    expect(normalizeRoleLabel("Product Manager")).toBe("Product Manager");
    expect(normalizeRoleLabel("Data Analyst")).toBe("Data Analyst");
  });

  it("handles empty string gracefully", () => {
    const result = normalizeRoleLabel("");
    expect(typeof result).toBe("string");
  });
});

describe("topRoles", () => {
  it("groups normalized roles together", () => {
    const result = topRoles(FIXTURE);
    // FIXTURE: "Senior Product Manager" (#1), "Product Manager" (#2, #8), "Lead Product Manager" (#3)
    // → all normalize to "Product Manager" → count = 4
    const pm = result.find((r) => r.label === "Product Manager");
    expect(pm?.count).toBe(4);
    // "Software Engineer" (#4, #6) and "Junior Software Engineer" (#5) all normalize to "Software Engineer"
    const se = result.find((r) => r.label === "Software Engineer");
    expect(se?.count).toBe(3);
  });

  it("returns empty array for empty input", () => {
    expect(topRoles([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computePdfCoverage
// ---------------------------------------------------------------------------

describe("computePdfCoverage", () => {
  it("returns 0 pct (not NaN) for empty input", () => {
    const result = computePdfCoverage([]);
    expect(result.pct).toBe(0);
    expect(Number.isNaN(result.pct)).toBe(false);
    expect(result.total).toBe(0);
    expect(result.withPDF).toBe(0);
  });

  it("counts withPDF correctly", () => {
    const result = computePdfCoverage(FIXTURE);
    // Apps 1,2,4,8 have PDF → 4 with PDF
    expect(result.withPDF).toBe(4);
    expect(result.total).toBe(8);
    expect(result.without).toBe(4);
    expect(result.pct).toBeCloseTo(50, 5);
  });

  it("pct is 100 when all apps have PDF", () => {
    const allPDF = FIXTURE.map((a) => ({ ...a, hasPDF: true }));
    const result = computePdfCoverage(allPDF);
    expect(result.pct).toBeCloseTo(100, 5);
    expect(Number.isNaN(result.pct)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeConversionRates
// ---------------------------------------------------------------------------

describe("computeConversionRates", () => {
  it("returns 4 stage transitions for the standard funnel", () => {
    const result = computeConversionRates(FIXTURE);
    expect(result).toHaveLength(4);
    expect(result[0].from).toBe("Evaluated");
    expect(result[0].to).toBe("Applied");
    expect(result[3].from).toBe("Interview");
    expect(result[3].to).toBe("Offer");
  });

  it("rate is 0 (not NaN) when fromCount is 0", () => {
    // No Applied in fixture except 1; but ensure we test the zero case
    const apps = [makeApp({ number: 1, status: "Evaluated", score: 4.0 })];
    const result = computeConversionRates(apps);
    const evalToApplied = result.find((r) => r.from === "Evaluated" && r.to === "Applied");
    expect(evalToApplied?.rate).toBe(0);
    expect(Number.isNaN(evalToApplied?.rate)).toBe(false);
  });

  it("rate is 0 for empty input — no NaN", () => {
    const result = computeConversionRates([]);
    for (const r of result) {
      expect(Number.isNaN(r.rate)).toBe(false);
      expect(Number.isFinite(r.rate)).toBe(true);
      expect(r.rate).toBe(0);
    }
  });

  it("computes rate correctly for fixture", () => {
    // FIXTURE has: Evaluated=2, Applied=1, Responded=1, Interview=1, Offer=1
    const result = computeConversionRates(FIXTURE);
    const evalToApplied = result.find((r) => r.from === "Evaluated" && r.to === "Applied");
    // 1 Applied / 2 Evaluated = 50%
    expect(evalToApplied?.rate).toBeCloseTo(50, 5);
    const appliedToResponded = result.find((r) => r.from === "Applied" && r.to === "Responded");
    // 1 Responded / 1 Applied = 100%
    expect(appliedToResponded?.rate).toBeCloseTo(100, 5);
  });

  it("rates are all finite numbers", () => {
    const result = computeConversionRates(FIXTURE);
    for (const r of result) {
      expect(Number.isFinite(r.rate)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// uniqueStatuses
// ---------------------------------------------------------------------------

describe("uniqueStatuses", () => {
  it("returns empty array for empty input", () => {
    expect(uniqueStatuses([])).toHaveLength(0);
  });

  it("returns statuses in canonical order", () => {
    const result = uniqueStatuses(FIXTURE);
    // Should include Evaluated, Applied, Responded, Interview, Offer, Rejected, SKIP
    expect(result.indexOf("Evaluated")).toBeLessThan(result.indexOf("Applied"));
    expect(result.indexOf("Applied")).toBeLessThan(result.indexOf("Responded"));
  });

  it("does not include statuses not present in apps", () => {
    const apps = [makeApp({ number: 1, status: "Applied" })];
    const result = uniqueStatuses(apps);
    expect(result).toEqual(["Applied"]);
  });
});
