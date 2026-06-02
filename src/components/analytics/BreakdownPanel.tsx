/**
 * BreakdownPanel.tsx — Top companies, top roles bar list, and PDF coverage stat.
 * Pure CSS/Tailwind horizontal-bar style (mirrors ScoreDistribution).
 */
import type { RankEntry, PdfCoverage } from "../../lib/parsers/analytics-aggregates";

interface BreakdownPanelProps {
  companies: RankEntry[];
  roles: RankEntry[];
  pdf: PdfCoverage;
}

const BAR_COLOR_COMPANY = "#6366f1"; // indigo
const BAR_COLOR_ROLE    = "#14b8a6"; // teal

function RankList({
  entries,
  color,
  emptyText,
}: {
  entries: RankEntry[];
  color: string;
  emptyText: string;
}) {
  const max = Math.max(...entries.map((e) => e.count), 1);

  if (entries.length === 0) {
    return (
      <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-4">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.slice(0, 8).map((e) => {
        const barW = Math.max(Math.round((e.count / max) * 100), e.count > 0 ? 2 : 0);
        return (
          <div key={e.label} className="flex items-center gap-2">
            <span
              className="min-w-0 shrink truncate text-[12px] text-gray-500 dark:text-gray-400 text-right"
              style={{ width: 120 }}
              title={e.label}
            >
              {e.label}
            </span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
              <div
                className="h-full rounded transition-[width] duration-500 ease-out"
                style={{ width: `${barW}%`, background: color }}
              />
            </div>
            <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">
              {e.count}
            </span>
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
              {e.pct.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PdfCoverageBar({ pdf }: { pdf: PdfCoverage }) {
  const pct = Math.min(Math.max(pdf.pct, 0), 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>PDF Coverage</span>
        <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
          {pdf.withPDF}/{pdf.total} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444",
          }}
        />
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500">
        {pdf.withPDF} applications with a generated CV PDF
      </p>
    </div>
  );
}

export function BreakdownPanel({ companies, roles, pdf }: BreakdownPanelProps) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
        Breakdown
      </h3>

      {/* PDF coverage */}
      <PdfCoverageBar pdf={pdf} />

      {/* Two-column grid for companies + roles on wider screens */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Top Companies
          </h4>
          <RankList
            entries={companies}
            color={BAR_COLOR_COMPANY}
            emptyText="No company data."
          />
        </div>
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Top Roles
          </h4>
          <RankList
            entries={roles}
            color={BAR_COLOR_ROLE}
            emptyText="No role data."
          />
        </div>
      </div>
    </div>
  );
}
