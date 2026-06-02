/**
 * FilterBar.tsx — Status filter chips + date-range selector for the Analytics tab.
 * Pure CSS/Tailwind. No recharts, no external chart libs.
 *
 * - Status chips: toggle individual statuses; "All" shortcut re-enables everything.
 * - Date range: preset buttons (Last 30 days / Last 90 days / All time) +
 *   optional custom from/to date inputs (shown when "Custom" is selected).
 */
import type { DateRange, DateRangePreset } from "../../lib/parsers/analytics-aggregates";

// Status color dots (matches KPI / funnel palette)
const STATUS_COLOR: Record<string, string> = {
  Evaluated: "#3b82f6",
  Applied: "#22c55e",
  Responded: "#14b8a6",
  Interview: "#a855f7",
  Offer: "#eab308",
  Rejected: "#ef4444",
  Discarded: "#6b7280",
  SKIP: "#9ca3af",
};

interface FilterBarProps {
  /** All statuses present in the data */
  allStatuses: string[];
  /** Currently active statuses (empty = all active) */
  activeStatuses: Set<string>;
  onStatusToggle: (status: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;

  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
}

const PRESETS: { label: string; value: DateRangePreset }[] = [
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
  { label: "All time", value: "all" },
];

export function FilterBar({
  allStatuses,
  activeStatuses,
  onStatusToggle,
  onSelectAll,
  onClearAll,
  dateRange,
  onDateRangeChange,
}: FilterBarProps) {
  const allActive = activeStatuses.size === 0 || activeStatuses.size === allStatuses.length;
  const showCustom = dateRange.preset === "all" && (dateRange.from || dateRange.to);

  function handlePreset(preset: DateRangePreset) {
    // Keep custom bounds only when staying on "all"
    onDateRangeChange({ preset, from: undefined, to: undefined });
  }

  function handleCustomFrom(e: React.ChangeEvent<HTMLInputElement>) {
    onDateRangeChange({ preset: "all", from: e.target.value || undefined, to: dateRange.to });
  }

  function handleCustomTo(e: React.ChangeEvent<HTMLInputElement>) {
    onDateRangeChange({ preset: "all", from: dateRange.from, to: e.target.value || undefined });
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-4 shadow-xs flex flex-col gap-3">
      {/* Row 1: Status filter chips */}
      {allStatuses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">
            Status:
          </span>
          {/* "All" chip */}
          <button
            type="button"
            onClick={allActive ? onClearAll : onSelectAll}
            className={[
              "rounded-full px-3 py-0.5 text-xs font-medium border transition-colors",
              allActive
                ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100"
                : "bg-transparent text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-gray-500",
            ].join(" ")}
          >
            All
          </button>
          {/* Individual status chips */}
          {allStatuses.map((status) => {
            const isActive = activeStatuses.size === 0 || activeStatuses.has(status);
            const dot = STATUS_COLOR[status] ?? "#6b7280";
            return (
              <button
                key={status}
                type="button"
                onClick={() => onStatusToggle(status)}
                className={[
                  "flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium border transition-colors",
                  isActive
                    ? "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600"
                    : "bg-transparent text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 opacity-50",
                ].join(" ")}
                aria-pressed={isActive}
              >
                <span
                  className="inline-block size-2 rounded-full shrink-0"
                  style={{ background: dot }}
                />
                {status}
              </button>
            );
          })}
        </div>
      )}

      {/* Row 2: Date range presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">
          Period:
        </span>
        {PRESETS.map(({ label, value }) => {
          const isActive =
            dateRange.preset === value &&
            !(value === "all" && (dateRange.from || dateRange.to));
          return (
            <button
              key={value}
              type="button"
              onClick={() => handlePreset(value)}
              className={[
                "rounded-full px-3 py-0.5 text-xs font-medium border transition-colors",
                isActive
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-transparent text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-indigo-400",
              ].join(" ")}
            >
              {label}
            </button>
          );
        })}
        {/* Custom range button */}
        <button
          type="button"
          onClick={() =>
            onDateRangeChange({ preset: "all", from: dateRange.from ?? "", to: dateRange.to ?? "" })
          }
          className={[
            "rounded-full px-3 py-0.5 text-xs font-medium border transition-colors",
            showCustom
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-transparent text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-indigo-400",
          ].join(" ")}
        >
          Custom
        </button>
        {/* Custom date inputs — shown only when "Custom" is active */}
        {showCustom && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={dateRange.from ?? ""}
              onChange={handleCustomFrom}
              className="text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              aria-label="From date"
            />
            <span className="text-xs text-gray-400">–</span>
            <input
              type="date"
              value={dateRange.to ?? ""}
              onChange={handleCustomTo}
              className="text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              aria-label="To date"
            />
          </div>
        )}
      </div>
    </div>
  );
}
