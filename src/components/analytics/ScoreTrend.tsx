/**
 * ScoreTrend.tsx — Pure SVG area/line chart of average score per week or month.
 * No recharts. Mirrors the WeeklyActivity SVG style.
 */
import type { ScoreTrendPoint, ScorePeriod } from "../../lib/parsers/analytics-aggregates";

interface ScoreTrendProps {
  data: ScoreTrendPoint[];
  period: ScorePeriod;
  onPeriodChange: (p: ScorePeriod) => void;
}

const CHART_W = 480;
const CHART_H = 130;
const PAD_L = 32;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 26;

const STROKE_COLOR = "#f59e0b";
const FILL_COLOR = "#f59e0b";

export function ScoreTrend({ data, period, onPeriodChange }: ScoreTrendProps) {
  // Keep last 20 points for readability
  const recent = data.slice(-20);

  if (recent.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
          Score Trend
        </h3>
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">
          Not enough scored applications yet.
        </p>
      </div>
    );
  }

  const innerW = CHART_W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;

  // Y axis: score range 0–5, with small padding
  const MIN_SCORE = 0;
  const MAX_SCORE = 5;

  const toX = (i: number) =>
    PAD_L + (i / Math.max(recent.length - 1, 1)) * innerW;
  const toY = (v: number) =>
    PAD_T + ((MAX_SCORE - v) / (MAX_SCORE - MIN_SCORE)) * innerH;

  // Reference lines at 3.0, 4.0, 5.0
  const yTicks = [0, 2.5, 4.0, 5.0];

  // X labels — first, last, a few evenly spaced
  const xLabelIdxs = new Set<number>([0, recent.length - 1]);
  if (recent.length > 4) {
    const step = Math.floor((recent.length - 1) / 3);
    for (let i = step; i < recent.length - 1; i += step) xLabelIdxs.add(i);
  }

  // Area + line path
  const points = recent.map((r, i) => ({ x: toX(i), y: toY(r.avgScore), val: r.avgScore, period: r.period, count: r.count }));
  const firstX = points[0].x.toFixed(1);
  const lastX = points[points.length - 1].x.toFixed(1);
  const baseY = toY(MIN_SCORE).toFixed(1);

  const areaPath =
    `M${firstX},${baseY} ` +
    points.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${lastX},${baseY} Z`;

  const gradId = "score-trend-grad";

  // Short label for x axis
  function shortLabel(p: string): string {
    if (p.includes("-W")) return p.replace(/^\d{4}-/, ""); // W03
    return p.replace(/^\d{4}-/, ""); // 03 (month)
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Score Trend
        </h3>
        <div className="flex items-center gap-1">
          {(["week", "month"] as ScorePeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPeriodChange(p)}
              className={[
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                period === p
                  ? "bg-amber-500 text-white"
                  : "text-gray-400 dark:text-gray-500 hover:text-gray-600",
              ].join(" ")}
            >
              {p === "week" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        style={{ height: 160 }}
        role="img"
        aria-label="Average score trend over time"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={FILL_COLOR} stopOpacity={0.35} />
            <stop offset="95%" stopColor={FILL_COLOR} stopOpacity={0.03} />
          </linearGradient>
        </defs>

        {/* Y grid + labels */}
        {yTicks.map((tick) => {
          const y = toY(tick);
          const isHighlight = tick === 4.0;
          return (
            <g key={tick}>
              <line
                x1={PAD_L}
                y1={y}
                x2={CHART_W - PAD_R}
                y2={y}
                stroke={isHighlight ? "#f59e0b" : "currentColor"}
                strokeOpacity={isHighlight ? 0.25 : 0.07}
                strokeWidth={1}
                strokeDasharray={isHighlight ? "3 3" : "4 4"}
              />
              <text
                x={PAD_L - 4}
                y={y + 4}
                textAnchor="end"
                fontSize={9}
                fill="currentColor"
                opacity={0.45}
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradId})`} />

        {/* Stroke line */}
        <polyline
          points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke={STROKE_COLOR}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data dots */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={STROKE_COLOR}>
            <title>{`${p.period}: avg ${p.val.toFixed(2)} (${p.count} app${p.count !== 1 ? "s" : ""})`}</title>
          </circle>
        ))}

        {/* X axis labels */}
        {points.map((p, i) =>
          xLabelIdxs.has(i) ? (
            <text
              key={i}
              x={p.x}
              y={CHART_H - 4}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              opacity={0.45}
            >
              {shortLabel(p.period)}
            </text>
          ) : null
        )}
      </svg>

      {/* Annotation: score ≥ 4.0 target line */}
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 text-right">
        dashed line = apply threshold (4.0)
      </p>
    </div>
  );
}
