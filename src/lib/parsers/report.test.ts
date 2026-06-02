import { describe, it, expect } from "vitest";
import { matchReportFilename, parseReportContent } from "./report";

const VALID_FILENAME = "042-acme-corp-2026-01-15.md";
const VALID_ID = "042-acme-corp-2026-01-15";

const REPORT_WITH_URL_AND_LEGITIMACY = `# Acme Corp — Head of Marketing

**Score:** 4.2/5
**URL:** https://jobs.acme.com/head-of-marketing
**Legitimacy:** Tier 1 — Major employer

## Block A: Role Fit

Some content here.
`;

const REPORT_WITHOUT_OPTIONAL_FIELDS = `# Beta Inc — Senior PMM

**Score:** 3.5/5

## Block A: Role Fit

Content without URL or Legitimacy fields.
`;

describe("matchReportFilename", () => {
  it("returns null for non-report filenames", () => {
    expect(matchReportFilename("README.md")).toBeNull();
    expect(matchReportFilename("applications.md")).toBeNull();
    expect(matchReportFilename("not-a-report.txt")).toBeNull();
  });

  it("returns null for malformed report filenames", () => {
    expect(matchReportFilename("42-acme-2026-01-15.md")).toBeNull(); // only 2 digits
    expect(matchReportFilename("042-ACME-CORP-2026-01-15.md")).toBeNull(); // uppercase
  });

  it("parses a valid report filename", () => {
    const result = matchReportFilename(VALID_FILENAME);
    expect(result).not.toBeNull();
    expect(result!.number).toBe("042");
    expect(result!.company).toBe("acme-corp");
    expect(result!.date).toBe("2026-01-15");
    expect(result!.id).toBe(VALID_ID);
    expect(result!.path).toBe(VALID_FILENAME);
  });

  it("does not throw on empty string", () => {
    expect(() => matchReportFilename("")).not.toThrow();
    expect(matchReportFilename("")).toBeNull();
  });
});

describe("parseReportContent", () => {
  it("returns null for invalid id format", () => {
    expect(parseReportContent("not-valid", "content")).toBeNull();
    expect(parseReportContent("42-acme-2026-01-15", "content")).toBeNull(); // only 2 digits
  });

  it("does not throw on empty markdown", () => {
    expect(() => parseReportContent(VALID_ID, "")).not.toThrow();
  });

  it("parses id into number, company, date", () => {
    const result = parseReportContent(VALID_ID, REPORT_WITH_URL_AND_LEGITIMACY);
    expect(result).not.toBeNull();
    expect(result!.number).toBe("042");
    expect(result!.company).toBe("acme-corp");
    expect(result!.date).toBe("2026-01-15");
    expect(result!.id).toBe(VALID_ID);
  });

  it("extracts URL from report markdown", () => {
    const result = parseReportContent(VALID_ID, REPORT_WITH_URL_AND_LEGITIMACY);
    expect(result!.url).toBe("https://jobs.acme.com/head-of-marketing");
  });

  it("extracts Legitimacy from report markdown", () => {
    const result = parseReportContent(VALID_ID, REPORT_WITH_URL_AND_LEGITIMACY);
    expect(result!.legitimacy).toBe("Tier 1 — Major employer");
  });

  it("sets url to undefined when not present — does not throw", () => {
    const result = parseReportContent(VALID_ID, REPORT_WITHOUT_OPTIONAL_FIELDS);
    expect(result).not.toBeNull();
    expect(result!.url).toBeUndefined();
  });

  it("sets legitimacy to undefined when not present — does not throw", () => {
    const result = parseReportContent(VALID_ID, REPORT_WITHOUT_OPTIONAL_FIELDS);
    expect(result!.legitimacy).toBeUndefined();
  });

  it("includes the full markdown in the result", () => {
    const result = parseReportContent(VALID_ID, REPORT_WITH_URL_AND_LEGITIMACY);
    expect(result!.markdown).toBe(REPORT_WITH_URL_AND_LEGITIMACY);
  });

  it("sets path to id + .md", () => {
    const result = parseReportContent(VALID_ID, "content");
    expect(result!.path).toBe(`${VALID_ID}.md`);
  });
});
