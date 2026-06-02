/**
 * ConversionRates.tsx — Funnel stage-to-stage conversion rates as percentage bars.
 * Pure CSS/Tailwind. Zero-division safe (rate is 0 when fromCount is 0).
 */
import type { ConversionRate } from "../../lib/parsers/analytics-aggregates";

interface ConversionRatesProps {
  rates: ConversionRate[];
}

const ARROW_COLOR: Record<string, string> = {
  "Evaluated→Applied":   "#3b82f6",
  "Applied→Responded":   "#14b8a6",
  "Responded→Interview": "#a855f7",
  "Interview→Offer":     "#eab308",
};

function rateColor(rate: number): string {
  if (rate >= 50) return "#10b981";
  if (rate >= 20) return "#f59e0b";
  if (rate > 0)   return "#f97316";
  return "#e5e7eb"; // gray — zero
}

export function ConversionRates({ rates }: ConversionRatesProps) {
  if (rates.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
          Conversion Rates
        </h3>
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">
          No pipeline data yet.
        </p>
      </div>
    );
  }

  const hasAnyData = rates.some((r) => r.fromCount > 0);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
        Conversion Rates
      </h3>

      {!hasAnyData ? (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-4">
          Apply to some offers to see conversion rates.
        </p>
      ) : (
        <div className="space-y-3">
          {rates.map((r) => {
            const key = `${r.from}→${r.to}`;
            const color = ARROW_COLOR[key] ?? "#6366f1";
            const fillColor = rateColor(r.rate);
            const barW = Math.min(Math.max(Math.round(r.rate), r.rate > 0 ? 1 : 0), 100);

            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                    <span
                      className="inline-block size-2 rounded-full shrink-0"
                      style={{ background: color }}
                    />
                    <span className="font-medium">{r.from}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-medium">{r.to}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="text-gray-400 dark:text-gray-500">
                      {r.toCount}/{r.fromCount}
                    </span>
                    <span
                      className="font-bold w-10 text-right"
                      style={{ color: fillColor === "#e5e7eb" ? undefined : fillColor }}
                    >
                      {r.fromCount === 0 ? "—" : `${r.rate.toFixed(0)}%`}
                    </span>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{
                      width: `${barW}%`,
                      background: r.fromCount === 0 ? "#e5e7eb" : fillColor,
                      opacity: r.fromCount === 0 ? 0.3 : 1,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-3">
        Rate = next-stage count ÷ current-stage count
      </p>
    </div>
  );
}
