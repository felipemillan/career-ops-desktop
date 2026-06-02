/**
 * ReportCard — card for a single report in the grid.
 * Clicking calls onSelect(id). Port of dashboard-web report-card.tsx, adapted
 * for plain Vite React (no Next.js Link, no 'use client').
 */
import { LegitimacyBadge } from "./LegitimacyBadge";

/** Title-case a company slug like "n8n-devrel" → "N8n Devrel". */
function formatCompany(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type ReportCardProps = {
  id: string;
  number: string;
  company: string;
  date: string;
  /** Optional — only present when we've parsed the full markdown. */
  legitimacy?: string | null;
  onSelect: (id: string) => void;
};

export function ReportCard({
  id,
  number,
  company,
  date,
  legitimacy,
  onSelect,
}: ReportCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className="group block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg"
    >
      <div className="h-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 transition-all hover:border-emerald-400/60 hover:shadow-md cursor-pointer flex flex-col gap-2">
        {/* Company name */}
        <div className="truncate text-sm font-bold leading-tight text-gray-900 dark:text-gray-100">
          {formatCompany(company)}
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-mono">#{number}</span>
          <span>·</span>
          <span>{date}</span>
        </div>

        {/* Legitimacy badge */}
        {legitimacy && (
          <div className="mt-auto pt-1">
            <LegitimacyBadge value={legitimacy} />
          </div>
        )}

        {/* CTA */}
        <div className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 group-hover:underline mt-auto">
          View report
          <svg
            className="size-3 transition-transform group-hover:translate-x-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </div>
    </button>
  );
}
