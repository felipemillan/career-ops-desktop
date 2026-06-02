/**
 * ReportViewer — slide-in panel (sheet) for viewing a full report.
 * Shows: header with score + legitimacy, TLDR extract, markdown body,
 * score breakdown, and Apply URL (clickable via @tauri-apps/plugin-opener).
 * Esc closes. No 'use client', no Next.js imports.
 */
import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useReport } from "../../hooks/useReport";
import { Markdown } from "../markdown/Markdown";
import { LegitimacyBadge } from "./LegitimacyBadge";
import { ScoreBreakdownChart } from "./ScoreBreakdownChart";

// ---------------------------------------------------------------------------
// Helpers (inlined — no Next.js)
// ---------------------------------------------------------------------------

function formatCompany(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function parseOverallScore(markdown: string): number | null {
  if (!markdown) return null;
  const headerSlice = markdown.slice(0, 800);
  const patterns = [
    /\*\*Score:\*\*\s*([0-5](?:\.\d+)?|\d+(?:\.\d+)?)\s*\/\s*5/i,
    /^\*\*Score[:\s]+([0-5](?:\.\d+)?|\d+(?:\.\d+)?)\s*\/\s*5\*\*/m,
  ];
  for (const p of patterns) {
    const m = headerSlice.match(p);
    if (m) {
      const v = parseFloat(m[1]);
      if (!Number.isNaN(v)) return Math.min(5, Math.max(0, v));
    }
  }
  const overall = markdown.match(
    /^#{1,3}\s*(?:Global|Overall)\s*Score[:\s]+([0-5](?:\.\d+)?|\d+(?:\.\d+)?)\s*\/\s*5/im
  );
  if (overall) {
    const v = parseFloat(overall[1]);
    if (!Number.isNaN(v)) return Math.min(5, Math.max(0, v));
  }
  return null;
}

function parseTldr(markdown: string): string | null {
  if (!markdown) return null;

  function clean(raw: string): string {
    return raw
      .replace(/\s+/g, " ")
      .replace(/^[\-—:]\s*/, "")
      .replace(/^\*+|\*+$/g, "")
      .trim();
  }

  // 1. **TLDR;** or **TLDR:** inline
  const inlineMatch = markdown.match(
    /\*\*TL[;:]?DR[;:]?\*\*[ \t]*[:\-—]?\s*([^\n]+(?:\n(?!\s*\n)[^\n]+)*)/i
  );
  if (inlineMatch) {
    const c = clean(inlineMatch[1]);
    if (c) return c;
  }

  // 2. ## TLDR heading section
  const headingMatch = markdown.match(
    /^#{1,6}\s+TL[;:]?DR[;:]?\s*$\n+([\s\S]*?)(?=^#{1,6}\s|\n---|\Z)/im
  );
  if (headingMatch) {
    const c = clean(headingMatch[1]);
    if (c) return c;
  }

  // 3. | **TL;DR** | ... | table row
  const rowMatch = markdown.match(
    /\|\s*\*\*TL[;:]?DR[;:]?\*\*\s*\|\s*([^|]+?)\s*\|/i
  );
  if (rowMatch) {
    const c = clean(rowMatch[1]);
    if (c) return c;
  }

  return null;
}

function scoreColor(score: number): string {
  if (score >= 4.5) return "#22c55e";
  if (score >= 4.0) return "#4ade80";
  if (score >= 3.5) return "#84cc16";
  if (score >= 3.0) return "#eab308";
  if (score >= 2.0) return "#f97316";
  return "#ef4444";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ReportViewerProps = {
  /** Report id to load. null = panel is closed. */
  reportId: string | null;
  onClose: () => void;
};

export function ReportViewer({ reportId, onClose }: ReportViewerProps) {
  const { report, loading, error } = useReport(reportId);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc to close
  useEffect(() => {
    if (!reportId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reportId, onClose]);

  // Trap focus scroll on open
  useEffect(() => {
    if (reportId && panelRef.current) {
      panelRef.current.scrollTop = 0;
    }
  }, [reportId]);

  if (!reportId) return null;

  const overallScore = report ? parseOverallScore(report.markdown) : null;
  const tldr = report ? parseTldr(report.markdown) : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-in panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Report viewer"
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-2xl overflow-y-auto bg-white dark:bg-gray-950 shadow-2xl border-l border-gray-200 dark:border-gray-800 flex flex-col"
        style={{ animation: "slideInRight 0.2s ease-out" }}
      >
        {/* Panel header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {report && (
              <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                {formatCompany(report.company)}
              </span>
            )}
            {report && (
              <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                #{report.number} · {report.date}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label="Close"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Panel body */}
        <div className="flex-1 px-5 py-5 flex flex-col gap-5">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20 text-gray-400">
              <svg className="animate-spin size-7 mr-3" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-sm">Loading report…</span>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-4 py-3">
              <p className="text-sm text-red-600 dark:text-red-400 font-medium">Failed to load report</p>
              <p className="text-xs text-red-500 dark:text-red-500 mt-1 break-all">{error}</p>
            </div>
          )}

          {!loading && !error && report && (
            <>
              {/* Score + Legitimacy header row */}
              {(overallScore != null || report.legitimacy) && (
                <div className="flex flex-wrap items-center gap-2">
                  {overallScore != null && (
                    <span
                      className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold tabular-nums"
                      style={{
                        background: `${scoreColor(overallScore)}22`,
                        color: scoreColor(overallScore),
                        border: `1px solid ${scoreColor(overallScore)}44`,
                      }}
                    >
                      {overallScore.toFixed(1)}/5
                    </span>
                  )}
                  {report.legitimacy && (
                    <LegitimacyBadge value={report.legitimacy} />
                  )}
                </div>
              )}

              {/* TLDR */}
              {tldr && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <svg className="size-3.5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="text-[10px] font-bold tracking-widest text-emerald-700 dark:text-emerald-400 uppercase">
                      Summary
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{tldr}</p>
                </div>
              )}

              {/* Apply URL */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 flex items-center gap-3">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 shrink-0">
                  Apply URL
                </span>
                {report.url ? (
                  <button
                    type="button"
                    onClick={() => openUrl(report.url!)}
                    className="text-xs text-emerald-600 dark:text-emerald-400 underline underline-offset-2 hover:text-emerald-700 dark:hover:text-emerald-300 truncate text-left transition-colors"
                    title={report.url}
                  >
                    {report.url}
                  </button>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                    No URL recorded
                  </span>
                )}
              </div>

              {/* Score breakdown */}
              <ScoreBreakdownChart markdown={report.markdown} />

              {/* Full markdown body */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 px-5 py-5">
                <Markdown>{report.markdown}</Markdown>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Inline animation keyframes */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}
