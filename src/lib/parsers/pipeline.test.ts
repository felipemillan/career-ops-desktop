import { describe, it, expect } from "vitest";
import { parsePipeline, countPending } from "./pipeline";

// Fixtures reused from the fork's parse-pipeline-pending.test.ts
const FIXTURE_MIXED = "## Pendientes\n- [ ] https://a.com\n- [x] https://b.com\n- [ ] https://c.com\n";
const FIXTURE_ENGLISH = "## Pending\n- [ ] https://a.com\n";
const FIXTURE_EMPTY = "";

describe("countPending", () => {
  it("returns 0 for empty string", () => {
    expect(countPending(FIXTURE_EMPTY)).toBe(0);
  });

  it("counts only unchecked items across sections", () => {
    expect(countPending(FIXTURE_MIXED)).toBe(2);
  });

  it("works with an English Pending header", () => {
    expect(countPending(FIXTURE_ENGLISH)).toBe(1);
  });

  it("returns 0 when all items are checked", () => {
    const content = "## Pendientes\n- [x] https://a.com\n- [x] https://b.com\n";
    expect(countPending(content)).toBe(0);
  });

  it("handles content with no list items at all", () => {
    expect(countPending("# Pipeline\n\nSome text\n")).toBe(0);
  });
});

describe("parsePipeline", () => {
  it("returns empty array for empty string", () => {
    expect(parsePipeline(FIXTURE_EMPTY)).toEqual([]);
  });

  it("marks unchecked items as checked=false", () => {
    const result = parsePipeline(FIXTURE_MIXED);
    const unchecked = result.filter((i) => !i.checked);
    expect(unchecked).toHaveLength(2);
  });

  it("marks checked items as checked=true", () => {
    const result = parsePipeline(FIXTURE_MIXED);
    const checked = result.filter((i) => i.checked);
    expect(checked).toHaveLength(1);
  });

  it("returns total items (checked + unchecked)", () => {
    const result = parsePipeline(FIXTURE_MIXED);
    expect(result).toHaveLength(3);
  });

  it("includes the trimmed line text", () => {
    const result = parsePipeline(FIXTURE_ENGLISH);
    expect(result[0].line).toBe("- [ ] https://a.com");
  });

  it("ignores non-list lines (headers, blank lines)", () => {
    const content = "## Pending\n\n- [ ] https://a.com\nSome text\n- [x] https://b.com\n";
    const result = parsePipeline(content);
    expect(result).toHaveLength(2);
  });

  it("handles real pipeline format with inline notes", () => {
    const content =
      "## Pendientes\n" +
      "- [x] #10 | https://example.com | Acme | Head of Marketing | 4.2/5 | PDF ✅\n" +
      "- [ ] https://jobs.example.com/new-role\n";
    const result = parsePipeline(content);
    expect(result).toHaveLength(2);
    expect(result[0].checked).toBe(true);
    expect(result[1].checked).toBe(false);
  });
});
