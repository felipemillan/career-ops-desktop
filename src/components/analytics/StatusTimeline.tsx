/**
 * StatusTimeline.tsx — Pure SVG stacked-area chart of weekly status distribution.
 * No recharts. Computes ISO-week buckets inline (mirroring bucket-by-week.ts logic).
 */
import type { CareerApplication } from "../../lib/types";

// ---------------------------------------------------------------------------
// ISO-week bucketing (mirrored from bucket-by-week.ts, inline)
// ---------------------------------------------------------------------------

function parseValidDate(dateStr: string): Date | null {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday (UTC) of the ISO week containing d — gives a clean +7-day step. */
function mondayOfWeek(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (dayNum - 1));
  return date;
}

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

const TRACKED_STATUSES = ["Evaluated", "Applied", "Interview", "Offer", "Rejected"] as const;

const STATUS_COLOR: Record<string, string> = {
  Evaluated: "#3b82f6",
  Applied: "#22c55e",
  Interview: "#a855f7",
  Offer: "#eab308",
  Rejected: "#ef4444",
};

interface WeekRow {
  week: string;
  counts: Record<string, number>;
  total: number;
}

function buildTimeline(apps: CareerApplication[]): WeekRow[] {
  if (apps.length === 0) return [];

  const byWeek = new Map<string, Record<string, number>>();
  let min: Date | null = null;
  let max: Date | null = null;

  for (const app of apps) {
    const d = parseValidDate(app.date);
    if (!d) continue; // skip unparseable dates instead of crashing
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
    const k = isoWeekKey(d);
    const row = byWeek.get(k) ?? {};
    const status = (TRACKED_STATUSES as readonly string[]).includes(app.status)
      ? app.status
      : null;
    if (status) row[status] = (row[status] ?? 0) + 1;
    byWeek.set(k, row);
  }

  if (!min || !max) return [];

  // Walk week by week with real date arithmetic (Monday cursor → clean +7 step).
  const maxKey = isoWeekKey(max);
  const cursor = mondayOfWeek(min);
  const result: WeekRow[] = [];
  let iter = 0;
  while (iter++ < 400) {
    const k = isoWeekKey(cursor);
    const counts = byWeek.get(k) ?? {};
    const total = TRACKED_STATUSES.reduce((s, st) => s + (counts[st] ?? 0), 0);
    result.push({ week: k, counts, total });
    if (k >= maxKey) break;
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return result;
}

// ---------------------------------------------------------------------------
// SVG stacked-area chart
// ---------------------------------------------------------------------------

const W = 560;
const H = 160;
const PAD_L = 28;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;

interface StatusTimelineProps {
  apps: CareerApplication[];
}

export function StatusTimeline({ apps }: StatusTimelineProps) {
  const rows = buildTimeline(apps).slice(-16); // last 16 weeks max

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
          Status Timeline
        </h3>
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">
          Not enough timeline data yet.
        </p>
      </div>
    );
  }

  // Present statuses only (those with ≥1 count)
  const presentStatuses = TRACKED_STATUSES.filter((s) =>
    rows.some((r) => (r.counts[s] ?? 0) > 0)
  );

  if (presentStatuses.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
          Status Timeline
        </h3>
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">
          Not enough timeline data yet.
        </p>
      </div>
    );
  }

  const maxTotal = Math.max(...rows.map((r) => r.total), 1);
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const toX = (i: number) =>
    PAD_L + (i / Math.max(rows.length - 1, 1)) * innerW;
  const toY = (v: number) =>
    PAD_T + ((maxTotal - v) / maxTotal) * innerH;

  // Build stacked polygons — each status drawn as a band
  function stackedArea(status: string): string {
    // Cumulative stacking: sum statuses above the current one
    const aboveStatuses = presentStatuses.slice(
      0,
      presentStatuses.indexOf(status as typeof presentStatuses[number])
    );

    const topPoints = rows.map((r, i) => {
      const above = aboveStatuses.reduce((s, st) => s + (r.counts[st] ?? 0), 0);
      const current = r.counts[status] ?? 0;
      return { x: toX(i), y: toY(above + current) };
    });
    const bottomPoints = rows.map((r, i) => {
      const above = aboveStatuses.reduce((s, st) => s + (r.counts[st] ?? 0), 0);
      return { x: toX(i), y: toY(above) };
    });

    const topPath = topPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const bottomPath = [...bottomPoints].reverse().map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

    return `${topPath} ${bottomPath} Z`;
  }

  // X labels at a few evenly-spaced points
  const xLabelIdxs = new Set<number>([0, rows.length - 1]);
  if (rows.length > 4) {
    const step = Math.floor((rows.length - 1) / 3);
    for (let i = step; i < rows.length - 1; i += step) xLabelIdxs.add(i);
  }

  // Y ticks
  const yTick1 = Math.round(maxTotal / 2);
  const yTicks = [0, yTick1, maxTotal].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Status Timeline
        </h3>
        <div className="flex flex-wrap gap-2">
          {presentStatuses.map((s) => (
            <span key={s} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: STATUS_COLOR[s] }}
              />
              {s}
            </span>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 180 }}
        role="img"
        aria-label="Status timeline stacked area chart"
      >
        {/* Grid lines */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_L}
              y1={toY(tick)}
              x2={W - PAD_R}
              y2={toY(tick)}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text
              x={PAD_L - 4}
              y={toY(tick) + 4}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              opacity={0.4}
            >
              {tick}
            </text>
          </g>
        ))}

        {/* Stacked areas (rendered bottom to top) */}
        {[...presentStatuses].reverse().map((status) => (
          <path
            key={status}
            d={stackedArea(status)}
            fill={STATUS_COLOR[status]}
            fillOpacity={0.55}
            stroke={STATUS_COLOR[status]}
            strokeWidth={1}
            strokeOpacity={0.8}
          />
        ))}

        {/* X axis labels */}
        {rows.map((r, i) =>
          xLabelIdxs.has(i) ? (
            <text
              key={i}
              x={toX(i)}
              y={H - 4}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              opacity={0.45}
            >
              {r.week.replace(/^\d{4}-/, "")}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
