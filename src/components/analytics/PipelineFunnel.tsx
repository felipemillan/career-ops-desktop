/**
 * PipelineFunnel.tsx — CSS proportional-bar funnel chart.
 * No recharts. Pure Tailwind + inline style for bar width.
 */
import type { FunnelStage } from "../../lib/types";

const STAGE_COLOR: Record<string, string> = {
  Evaluated: "#3b82f6",
  Applied: "#22c55e",
  Responded: "#14b8a6",
  Interview: "#a855f7",
  Offer: "#eab308",
};

interface PipelineFunnelProps {
  stages: FunnelStage[];
}

export function PipelineFunnel({ stages }: PipelineFunnelProps) {
  const max = stages[0]?.count || 1;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
        Pipeline Funnel
      </h3>
      {stages.length === 0 ? (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">
          No pipeline data yet.
        </p>
      ) : (
        <div className="space-y-2.5">
          {stages.map((stage, i) => {
            const prev = i === 0 ? null : stages[i - 1];
            const conv =
              prev && prev.count > 0
                ? Math.round((stage.count / prev.count) * 100)
                : null;
            const barW =
              max > 0
                ? Math.max(
                    Math.round((stage.count / max) * 100),
                    stage.count > 0 ? 2 : 0
                  )
                : 0;
            const color = STAGE_COLOR[stage.label] ?? "#6366f1";

            return (
              <div key={stage.label} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-right text-[13px] text-gray-500 dark:text-gray-400">
                  {stage.label}
                </span>
                <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-full rounded transition-[width] duration-500 ease-out"
                    style={{ width: `${barW}%`, background: color }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                  {stage.count}
                </span>
                <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                  {conv !== null ? `${conv}%` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
