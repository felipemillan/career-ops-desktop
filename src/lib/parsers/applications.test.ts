import { describe, it, expect } from "vitest";
import { parseApplications } from "./applications";

// Representative fixture derived from real applications.md format
const FIXTURE_CONTENT = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 10 | 2026-01-15 | Acme Corp | Head of Marketing | 4.2/5 | Applied | ✅ | [10](reports/010-acme-corp-2026-01-15.md) | Strong match |
| 5 | 2026-01-10 | Beta Inc | Senior PMM | N/A | SKIP | ❌ | N/A | Not a fit |
| 20 | 2026-01-20 | Gamma LLC | VP Growth | 3.8/5 | **Evaluated** | ❌ | [20](reports/020-gamma-llc-2026-01-20.md) | Good culture |
| 1 | 2025-12-01 | Delta Co | Growth Manager | 5.0/5 | Interview | ✅ | [1](reports/001-delta-co-2025-12-01.md) | Dream role |
`;

describe("parseApplications", () => {
  it("returns empty array for empty string", () => {
    expect(parseApplications("")).toEqual([]);
  });

  it("returns empty array for garbage input", () => {
    expect(parseApplications("not a table\nrandom text")).toEqual([]);
  });

  it("skips header row and separator row", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    // None should have 'Date' or '---' as number
    for (const app of result) {
      expect(app.number).not.toBeNaN();
      expect(app.number).toBeGreaterThan(0);
    }
  });

  it("parses score correctly: 4.2/5 → 4.2", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    const acme = result.find((a) => a.company === "Acme Corp");
    expect(acme).toBeDefined();
    expect(acme!.score).toBe(4.2);
    expect(acme!.scoreRaw).toBe("4.2/5");
  });

  it("parses score 5.0/5 → 5", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    const delta = result.find((a) => a.company === "Delta Co");
    expect(delta!.score).toBe(5.0);
  });

  it("parses N/A score → null", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    const beta = result.find((a) => a.company === "Beta Inc");
    expect(beta).toBeDefined();
    expect(beta!.score).toBeNull();
    expect(beta!.scoreRaw).toBe("N/A");
  });

  it("strips ** bold markers from status", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    const gamma = result.find((a) => a.company === "Gamma LLC");
    expect(gamma).toBeDefined();
    expect(gamma!.status).toBe("Evaluated");
    expect(gamma!.status).not.toContain("**");
  });

  it("parses ✅ → hasPDF true, ❌ → hasPDF false", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    const acme = result.find((a) => a.company === "Acme Corp");
    const beta = result.find((a) => a.company === "Beta Inc");
    expect(acme!.hasPDF).toBe(true);
    expect(beta!.hasPDF).toBe(false);
  });

  it("extracts report link number and path", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    const acme = result.find((a) => a.company === "Acme Corp");
    expect(acme!.reportNumber).toBe("10");
    expect(acme!.reportPath).toBe("reports/010-acme-corp-2026-01-15.md");
  });

  it("sets reportNumber and reportPath to null when no report link", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    const beta = result.find((a) => a.company === "Beta Inc");
    expect(beta!.reportNumber).toBeNull();
    expect(beta!.reportPath).toBeNull();
  });

  it("sorts results in descending order by number", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    const numbers = result.map((a) => a.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(numbers[0]).toBe(20);
    expect(numbers[numbers.length - 1]).toBe(1);
  });

  it("drops rows with fewer than 9 cells", () => {
    const content = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Co | Role | 4.0/5 | Applied |
| 2 | 2026-01-02 | Co2 | Role2 | 3.5/5 | Evaluated | ✅ | [2](reports/002-co2-2026-01-02.md) | Notes here |
`;
    const result = parseApplications(content);
    expect(result).toHaveLength(1);
    expect(result[0].company).toBe("Co2");
  });

  it("clamps score to 0-5 range — score above 5 is excluded", () => {
    const content = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Co | Role | 6.0/5 | Applied | ❌ | N/A | notes |
`;
    const result = parseApplications(content);
    expect(result[0].score).toBeNull();
  });

  it("sets jobURL to null (Rust layer provides it)", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    for (const app of result) {
      expect(app.jobURL).toBeNull();
    }
  });

  it("parses notes correctly", () => {
    const result = parseApplications(FIXTURE_CONTENT);
    const acme = result.find((a) => a.company === "Acme Corp");
    expect(acme!.notes).toBe("Strong match");
  });
});
