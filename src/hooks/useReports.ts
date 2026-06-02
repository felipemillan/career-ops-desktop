/**
 * useReports — fetches the list of reports via listReports() from ipc.ts.
 * Returns { items, loading, error }.
 * Uses the ReportMeta type from ipc.ts (id, filename) plus the parsed
 * ReportSummary shape from types.ts (id, number, company, date, path).
 * No direct invoke/node:fs.
 */
import { useState, useEffect, useCallback } from "react";
import { listReports } from "../lib/ipc";
import { matchReportFilename } from "../lib/parsers/report";
import type { ReportMeta } from "../lib/types";

export type UseReportsResult = {
  items: ReportMeta[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useReports(): UseReportsResult {
  const [items, setItems] = useState<ReportMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listReports();
      // response.items is ReportMeta[] from ipc.ts: { id, filename }
      // We enrich each with parsed fields via matchReportFilename.
      const enriched: ReportMeta[] = response.items.flatMap((raw) => {
        const parsed = matchReportFilename(raw.filename);
        if (!parsed) return [];
        return [
          {
            id: parsed.id,
            number: parsed.number,
            company: parsed.company,
            date: parsed.date,
            path: parsed.path,
          },
        ];
      });
      // Sort descending by report number (newest first)
      enriched.sort((a, b) => b.number.localeCompare(a.number));
      setItems(enriched);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // repo_not_configured → treat as empty (not an error for the UI)
      if (msg.includes("repo_not_configured")) {
        setItems([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, error, refresh: load };
}
