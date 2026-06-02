/**
 * ScoreDistribution.tsx — CSS horizontal-bar score histogram.
 * No recharts. Pure Tailwind + inline style for bar widths.
 */
import type { ScoreBucket } from "../../lib/types";

const SCORE_COLOR: Record<string, string> = {
  "4.5-5.0": "#10b981",
  "4.0-4.4": "#14b8a6",
  "3.5-3.9": "#f59e0b",
  "3.0-3.4": "#f97316",
  "<3.0": "#ef4444",
};

interface ScoreDistributionProps {
  buckets: ScoreBucket[];
}

export function ScoreDistribution({ buckets }: ScoreDistributionProps) {
  const max = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
        Score Distribution
      </h3>
      {buckets.length === 0 ? (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">
          No scored applications yet.
        </p>
      ) : (
        <div className="space-y-2.5">
          {buckets.map((b) => {
            const barW =
              max > 0
                ? Math.max(
                    Math.round((b.count / max) * 100),
                    b.count > 0 ? 2 : 0
                  )
                : 0;
            const color = SCORE_COLOR[b.label] ?? "#6b7280";

            return (
              <div key={b.label} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-right text-[13px] tabular-nums text-gray-500 dark:text-gray-400">
                  {b.label}
                </span>
                <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-full rounded transition-[width] duration-500 ease-out"
                    style={{ width: `${barW}%`, background: color }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                  {b.count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
