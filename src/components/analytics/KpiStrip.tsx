/**
 * KpiStrip.tsx — 5-card KPI row for the Analytics tab.
 * Pure CSS only — no recharts/chart libs. Plain Vite React 19.
 */
import type { PipelineMetrics, ProgressMetrics } from "../../lib/types";

interface KpiStripProps {
  pipeline: PipelineMetrics;
  progress: ProgressMetrics;
}

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down" | "neutral";
}

function TrendArrow({ trend }: { trend: "up" | "down" | "neutral" }) {
  if (trend === "up")
    return <span className="text-green-500 dark:text-green-400 text-sm">↑</span>;
  if (trend === "down")
    return <span className="text-red-500 dark:text-red-400 text-sm">↓</span>;
  return <span className="text-gray-400 text-sm">→</span>;
}

function KpiCard({ label, value, hint, trend }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-4 shadow-xs">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
        {value}
      </span>
      {(hint || trend) && (
        <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
          {trend && <TrendArrow trend={trend} />}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}

export function KpiStrip({ pipeline, progress }: KpiStripProps) {
  // Apply-worthy = score 4.0+
  const applyWorthy = progress.scoreBuckets
    .filter((b) => b.label === "4.5-5.0" || b.label === "4.0-4.4")
    .reduce((sum, b) => sum + b.count, 0);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard
        label="Total Evaluated"
        value={String(pipeline.total)}
      />
      <KpiCard
        label="Avg Score"
        value={progress.avgScore > 0 ? progress.avgScore.toFixed(2) : "—"}
        hint={progress.topScore > 0 ? `top ${progress.topScore.toFixed(1)}` : undefined}
        trend="neutral"
      />
      <KpiCard
        label="Apply-worthy"
        value={String(applyWorthy)}
        hint="score ≥ 4.0"
        trend={applyWorthy > 0 ? "up" : "down"}
      />
      <KpiCard
        label="Response Rate"
        value={`${progress.responseRate.toFixed(0)}%`}
        hint={`${progress.interviewRate.toFixed(0)}% interview`}
        trend={progress.responseRate > 0 ? "up" : "down"}
      />
      <KpiCard
        label="Total Offers"
        value={String(progress.totalOffers)}
        trend={progress.totalOffers > 0 ? "up" : "neutral"}
      />
    </div>
  );
}
