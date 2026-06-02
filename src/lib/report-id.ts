/**
 * report-id.ts — Pure utility for deriving a ReportViewer id from a CareerApplication.
 * Kept in lib/ (no React imports) so it can be unit-tested in the node environment.
 */
import type { CareerApplication } from "./types";

/**
 * Derive a report viewer id from an application's reportPath.
 *
 * reportPath format: "reports/001-anthropic-2026-05-15.md"
 * →          id:     "001-anthropic-2026-05-15"
 *
 * Returns null when reportPath is null (no report exists → no button to show).
 */
export function reportIdFromApp(app: Pick<CareerApplication, "reportPath">): string | null {
  if (!app.reportPath) return null;
  return app.reportPath.replace(/^reports\//, "").replace(/\.md$/, "");
}
