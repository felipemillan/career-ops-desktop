/**
 * AnalyticsTab.tsx — Phase 3.5 full analytics dashboard.
 *
 * Reads from useApplications() (store.ts). Subscribes to refresh events
 * automatically via the hook — analytics recompute whenever data changes.
 *
 * All charts are pure CSS/SVG — no recharts (React 19 peer incompatibility).
 *
 * New in Phase 3.5:
 *  - Status filter chips (top of page, all charts recompute from filtered set)
 *  - Date-range selector (last 30d / 90d / all / custom from-to)
 *  - Score-vs-time trend (SVG area chart, weekly or monthly)
 *  - Breakdown panel (top companies, top roles, PDF coverage)
 *  - Conversion rates (per funnel stage, % guarded against divide-by-zero)
 *  - Live refresh via useApplications subscription
 */
import { useState, useMemo } from "react";
import { useApplications } from "../lib/store";
import { RepoPicker } from "../components/RepoPicker";
import {
  computePipelineMetrics,
  computeProgressMetrics,
} from "../lib/parsers/compute-metrics";
import {
  filterApps,
  computeScoreTrend,
  topCompanies,
  topRoles,
  computePdfCoverage,
  computeConversionRates,
  uniqueStatuses,
} from "../lib/parsers/analytics-aggregates";
import type { DateRange, ScorePeriod } from "../lib/parsers/analytics-aggregates";
import { KpiStrip } from "../components/analytics/KpiStrip";
import { PipelineFunnel } from "../components/analytics/PipelineFunnel";
import { ScoreDistribution } from "../components/analytics/ScoreDistribution";
import { WeeklyActivity } from "../components/analytics/WeeklyActivity";
import { StatusTimeline } from "../components/analytics/StatusTimeline";
import { FilterBar } from "../components/analytics/FilterBar";
import { ScoreTrend } from "../components/analytics/ScoreTrend";
import { BreakdownPanel } from "../components/analytics/BreakdownPanel";
import { ConversionRates } from "../components/analytics/ConversionRates";

export function AnalyticsTab() {
  const { apps, loading, error } = useApplications();

  // ---------------------------------------------------------------------------
  // Filter state — status chips
  // ---------------------------------------------------------------------------
  // Empty set = all active; non-empty = explicit subset
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Filter state — date range
  // ---------------------------------------------------------------------------
  const [dateRange, setDateRange] = useState<DateRange>({ preset: "all" });

  // ---------------------------------------------------------------------------
  // Score trend period toggle
  // ---------------------------------------------------------------------------
  const [scorePeriod, setScorePeriod] = useState<ScorePeriod>("week");

  // ---------------------------------------------------------------------------
  // Parse repo_not_configured error
  // ---------------------------------------------------------------------------
  const isRepoNotConfigured =
    error !== null &&
    (error.includes("repo_not_configured") || error === "repo_not_configured");

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading && apps.length === 0) {
    return (
      <div className="flex items-center justify-center py-24" role="status" aria-label="Loading">
        <div className="flex flex-col items-center gap-3 text-gray-400 dark:text-gray-500">
          <svg
            className="animate-spin h-8 w-8"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          <span className="text-sm">Loading analytics…</span>
        </div>
      </div>
    );
  }

  // Repo not configured
  if (isRepoNotConfigured) {
    return <RepoPicker />;
  }

  // Other errors
  if (error !== null && apps.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-2 text-center max-w-sm">
          <span className="text-3xl">⚠️</span>
          <p className="text-red-600 dark:text-red-400 text-sm font-medium">
            Failed to load analytics
          </p>
          <p className="text-gray-500 dark:text-gray-400 text-xs break-all">{error}</p>
        </div>
      </div>
    );
  }

  // Empty repo
  if (!loading && apps.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <span className="text-4xl">📊</span>
          <h3 className="text-gray-700 dark:text-gray-200 font-semibold">No data yet</h3>
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            Evaluate your first job offer to see analytics here.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Derived data — all computed inside render (not hooks) so AnalyticsInner
  // can use them; safe because we've returned early for all error/empty states.
  // ---------------------------------------------------------------------------
  return (
    <AnalyticsInner
      apps={apps}
      activeStatuses={activeStatuses}
      setActiveStatuses={setActiveStatuses}
      dateRange={dateRange}
      setDateRange={setDateRange}
      scorePeriod={scorePeriod}
      setScorePeriod={setScorePeriod}
    />
  );
}

// ---------------------------------------------------------------------------
// Inner component — allows hooks (useMemo) after all early-return guards above.
// ---------------------------------------------------------------------------

interface AnalyticsInnerProps {
  apps: import("../lib/types").CareerApplication[];
  activeStatuses: Set<string>;
  setActiveStatuses: React.Dispatch<React.SetStateAction<Set<string>>>;
  dateRange: DateRange;
  setDateRange: React.Dispatch<React.SetStateAction<DateRange>>;
  scorePeriod: ScorePeriod;
  setScorePeriod: React.Dispatch<React.SetStateAction<ScorePeriod>>;
}

function AnalyticsInner({
  apps,
  activeStatuses,
  setActiveStatuses,
  dateRange,
  setDateRange,
  scorePeriod,
  setScorePeriod,
}: AnalyticsInnerProps) {
  // Status chip helpers
  const allStatuses = useMemo(() => uniqueStatuses(apps), [apps]);

  // Filtered app set — feeds all charts below
  const filtered = useMemo(
    () => filterApps(apps, activeStatuses, dateRange),
    [apps, activeStatuses, dateRange]
  );

  // Core metrics (derived from filtered set)
  const pipeline = useMemo(() => computePipelineMetrics(filtered), [filtered]);
  const progress = useMemo(() => computeProgressMetrics(filtered), [filtered]);

  // Phase 3.5 additions
  const scoreTrend = useMemo(() => computeScoreTrend(filtered, scorePeriod), [filtered, scorePeriod]);
  const companies  = useMemo(() => topCompanies(filtered, 8), [filtered]);
  const roles      = useMemo(() => topRoles(filtered, 8), [filtered]);
  const pdf        = useMemo(() => computePdfCoverage(filtered), [filtered]);
  const conversion = useMemo(() => computeConversionRates(filtered), [filtered]);

  // Status chip handlers
  function handleStatusToggle(status: string) {
    setActiveStatuses((prev) => {
      // If currently "all active" (empty), start with all statuses minus the clicked one
      if (prev.size === 0) {
        const next = new Set(allStatuses);
        next.delete(status);
        return next;
      }
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
        // If nothing left, go back to "all active"
        if (next.size === 0) return new Set();
      } else {
        next.add(status);
        // If all are now active, normalize to empty set
        if (next.size === allStatuses.length) return new Set();
      }
      return next;
    });
  }

  const isFiltered = activeStatuses.size > 0 || dateRange.preset !== "all" || dateRange.from || dateRange.to;

  return (
    <div className="flex flex-col gap-6">
      {/* Filters — top of page; all charts recompute from filtered set */}
      <FilterBar
        allStatuses={allStatuses}
        activeStatuses={activeStatuses}
        onStatusToggle={handleStatusToggle}
        onSelectAll={() => setActiveStatuses(new Set())}
        onClearAll={() => {
          if (allStatuses.length > 0) {
            // "Clear all" means show no statuses, but that's confusing — instead
            // select all statuses explicitly so the user can de-select from there.
            setActiveStatuses(new Set(allStatuses));
          }
        }}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      {/* Filtered-to-empty state */}
      {filtered.length === 0 && isFiltered && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-2 text-center max-w-xs">
            <span className="text-3xl">🔍</span>
            <p className="text-gray-600 dark:text-gray-300 font-medium text-sm">
              No applications match the current filters
            </p>
            <button
              type="button"
              className="mt-1 text-xs text-indigo-500 hover:text-indigo-700 underline underline-offset-2"
              onClick={() => {
                setActiveStatuses(new Set());
                setDateRange({ preset: "all" });
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          {/* KPI strip */}
          <KpiStrip pipeline={pipeline} progress={progress} />

          {/* Score trend — full width */}
          <ScoreTrend
            data={scoreTrend}
            period={scorePeriod}
            onPeriodChange={setScorePeriod}
          />

          {/* Funnel + Score distribution side by side on wider screens */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PipelineFunnel stages={progress.funnelStages} />
            <ScoreDistribution buckets={progress.scoreBuckets} />
          </div>

          {/* Conversion rates + Breakdown side by side on wider screens */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ConversionRates rates={conversion} />
            <BreakdownPanel companies={companies} roles={roles} pdf={pdf} />
          </div>

          {/* Weekly activity — full width */}
          <WeeklyActivity data={progress.weeklyActivity} />

          {/* Status timeline — full width */}
          <StatusTimeline apps={filtered} />
        </>
      )}
    </div>
  );
}
