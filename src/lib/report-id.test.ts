import { describe, it, expect } from "vitest";
import { reportIdFromApp } from "./report-id";

describe("reportIdFromApp", () => {
  it("strips reports/ prefix and .md suffix", () => {
    expect(reportIdFromApp({ reportPath: "reports/001-anthropic-2026-05-15.md" }))
      .toBe("001-anthropic-2026-05-15");
  });

  it("returns null when reportPath is null", () => {
    expect(reportIdFromApp({ reportPath: null })).toBeNull();
  });

  it("handles paths without leading reports/ prefix gracefully", () => {
    // If somehow only the filename is stored, strip .md and return it as-is
    expect(reportIdFromApp({ reportPath: "020-gamma-llc-2026-01-20.md" }))
      .toBe("020-gamma-llc-2026-01-20");
  });

  it("preserves zero-padded number", () => {
    expect(reportIdFromApp({ reportPath: "reports/007-acme-corp-2026-03-01.md" }))
      .toBe("007-acme-corp-2026-03-01");
  });

  it("handles multi-segment company slugs", () => {
    expect(reportIdFromApp({ reportPath: "reports/042-big-tech-company-2025-12-31.md" }))
      .toBe("042-big-tech-company-2025-12-31");
  });
});
