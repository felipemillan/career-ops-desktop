/**
 * AnalyticsTab.tsx — Phase 2 analytics dashboard.
 *
 * Reads from useApplications() (store.ts). Computes metrics via
 * computePipelineMetrics + computeProgressMetrics from compute-metrics.ts.
 *
 * All charts are pure CSS/SVG — no recharts (React 19 peer incompatibility).
 */
import { useApplications } from "../lib/store";
import { RepoPicker } from "../components/RepoPicker";
import {
  computePipelineMetrics,
  computeProgressMetrics,
} from "../lib/parsers/compute-metrics";
import { KpiStrip } from "../components/analytics/KpiStrip";
import { PipelineFunnel } from "../components/analytics/PipelineFunnel";
import { ScoreDistribution } from "../components/analytics/ScoreDistribution";
import { WeeklyActivity } from "../components/analytics/WeeklyActivity";
import { StatusTimeline } from "../components/analytics/StatusTimeline";

export function AnalyticsTab() {
  const { apps, loading, error } = useApplications();

  // Parse repo_not_configured error
  const isRepoNotConfigured =
    error !== null &&
    (error.includes("repo_not_configured") || error === "repo_not_configured");

  // Loading state
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

  // Compute metrics from the store's apps (zero-division guarded)
  const pipeline = computePipelineMetrics(apps);
  const progress = computeProgressMetrics(apps);

  return (
    <div className="flex flex-col gap-6">
      {/* KPI strip */}
      <KpiStrip pipeline={pipeline} progress={progress} />

      {/* Funnel + Score distribution side by side on wider screens */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PipelineFunnel stages={progress.funnelStages} />
        <ScoreDistribution buckets={progress.scoreBuckets} />
      </div>

      {/* Weekly activity — full width */}
      <WeeklyActivity data={progress.weeklyActivity} />

      {/* Status timeline — full width */}
      <StatusTimeline apps={apps} />
    </div>
  );
}
