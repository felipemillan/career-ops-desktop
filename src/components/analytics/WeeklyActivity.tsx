/**
 * WeeklyActivity.tsx — pure SVG area chart for weekly evaluation counts.
 * No recharts. Uses inline SVG with a <polyline> path drawn from the data.
 * Responsive via viewBox; re-renders on data change.
 */
import type { WeekActivity } from "../../lib/types";

interface WeeklyActivityProps {
  data: WeekActivity[];
}

const CHART_H = 120; // SVG coordinate height (px-equivalent units)
const CHART_W = 400; // SVG coordinate width
const PAD_LEFT = 30; // left padding for Y axis labels
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 24; // bottom padding for X axis labels
const FILL_COLOR = "#6366f1";
const STROKE_COLOR = "#4f46e5";

function buildPath(
  points: { x: number; y: number }[],
  minY: number,
  maxY: number,
  chartH: number
): { area: string; line: string } {
  if (points.length === 0) return { area: "", line: "" };

  const toSvgY = (v: number) => {
    const range = maxY - minY || 1;
    return PAD_TOP + ((maxY - v) / range) * chartH;
  };

  const linePoints = points
    .map((p) => `${p.x.toFixed(1)},${toSvgY(p.y).toFixed(1)}`)
    .join(" ");

  const firstX = points[0].x.toFixed(1);
  const lastX = points[points.length - 1].x.toFixed(1);
  const baseY = (PAD_TOP + chartH).toFixed(1);

  const area =
    `M${firstX},${baseY} ` +
    points.map((p) => `L${p.x.toFixed(1)},${toSvgY(p.y).toFixed(1)}`).join(" ") +
    ` L${lastX},${baseY} Z`;

  return { area, line: `M${linePoints.replace(" ", " L")}` };
}

export function WeeklyActivity({ data }: WeeklyActivityProps) {
  // Keep last 12 weeks
  const recent = data.slice(-12);
  const total = recent.reduce((s, r) => s + r.count, 0);

  if (recent.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
          Weekly Activity
        </h3>
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">
          No activity recorded yet.
        </p>
      </div>
    );
  }

  const maxCount = Math.max(...recent.map((r) => r.count), 1);
  const chartInnerW = CHART_W - PAD_LEFT - PAD_RIGHT;
  const chartInnerH = CHART_H - PAD_TOP - PAD_BOTTOM;

  // Map data to SVG x coords (left to right)
  const points = recent.map((r, i) => ({
    x: PAD_LEFT + (i / Math.max(recent.length - 1, 1)) * chartInnerW,
    y: r.count,
    week: r.week,
  }));

  const { area, line } = buildPath(
    points.map((p) => ({ x: p.x, y: p.y })),
    0,
    maxCount,
    chartInnerH
  );

  // Y axis ticks (3 ticks: 0, half, max)
  const yTicks = [0, Math.round(maxCount / 2), maxCount].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );

  // X axis labels — show first, last, and ~3 evenly spaced
  const xLabelIndices = new Set<number>([0, recent.length - 1]);
  if (recent.length > 4) {
    const step = Math.floor((recent.length - 1) / 3);
    for (let i = step; i < recent.length - 1; i += step) xLabelIndices.add(i);
  }

  const gradId = "weekly-grad";
  const toSvgY = (v: number) => {
    const range = maxCount - 0 || 1;
    return PAD_TOP + ((maxCount - v) / range) * chartInnerH;
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Weekly Activity
        </h3>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {recent.length} weeks · {total} total
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        style={{ height: 160 }}
        aria-label="Weekly evaluation activity chart"
        role="img"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={FILL_COLOR} stopOpacity={0.45} />
            <stop offset="95%" stopColor={FILL_COLOR} stopOpacity={0.04} />
          </linearGradient>
        </defs>

        {/* Y axis grid lines + labels */}
        {yTicks.map((tick) => {
          const y = toSvgY(tick);
          return (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={CHART_W - PAD_RIGHT}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={PAD_LEFT - 4}
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
        {area && (
          <path d={area} fill={`url(#${gradId})`} />
        )}

        {/* Stroke line */}
        {line && (
          <polyline
            points={points
              .map((p) => `${p.x.toFixed(1)},${toSvgY(p.y).toFixed(1)}`)
              .join(" ")}
            fill="none"
            stroke={STROKE_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Data dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={toSvgY(p.y)}
            r={3}
            fill={STROKE_COLOR}
            aria-label={`${p.week}: ${p.y}`}
          >
            <title>{`${p.week}: ${p.y} evaluation${p.y !== 1 ? "s" : ""}`}</title>
          </circle>
        ))}

        {/* X axis labels */}
        {points.map((p, i) =>
          xLabelIndices.has(i) ? (
            <text
              key={i}
              x={p.x}
              y={CHART_H - 4}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              opacity={0.45}
            >
              {p.week.replace(/^\d{4}-/, "")}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
