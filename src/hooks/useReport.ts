/**
 * useReport — fetches and parses a single report by id via readReport(id) from ipc.ts.
 * Returns { report, loading, error }.
 * No direct invoke/node:fs.
 */
import { useState, useEffect } from "react";
import { readReport } from "../lib/ipc";
import { parseReportContent } from "../lib/parsers/report";
import type { ReportContent } from "../lib/types";

export type UseReportResult = {
  report: ReportContent | null;
  loading: boolean;
  error: string | null;
};

export function useReport(id: string | null): UseReportResult {
  const [report, setReport] = useState<ReportContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setReport(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);

    readReport(id)
      .then((response) => {
        if (cancelled) return;
        const parsed = parseReportContent(id, response.content);
        if (parsed) {
          setReport(parsed);
        } else {
          setError(`Could not parse report: ${id}`);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return { report, loading, error };
}
