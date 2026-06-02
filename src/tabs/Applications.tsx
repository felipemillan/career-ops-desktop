/**
 * Applications.tsx — Live sortable grid of job applications.
 * Uses useApplications() from store.ts (which calls readApplications() via ipc.ts).
 * Does NOT import invoke or node:fs directly.
 *
 * Phase 2: adds Table / Kanban view toggle.
 */
import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import type { CareerApplication } from "../lib/types";
import { useApplications } from "../lib/store";
import { DataTable } from "../components/DataTable";
import { RepoPicker } from "../components/RepoPicker";
import { ApplicationsKanban } from "../components/kanban/ApplicationsKanban";

// ---------------------------------------------------------------------------
// View toggle
// ---------------------------------------------------------------------------

type ViewMode = "table" | "kanban";

function ViewToggle({
  active,
  onChange,
}: {
  active: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs font-medium"
    >
      {(["table", "kanban"] as ViewMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          aria-pressed={active === mode}
          className={[
            "px-3 py-1.5 capitalize transition-colors",
            active === mode
              ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
              : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800",
          ].join(" ")}
        >
          {mode === "table" ? "⊞ Table" : "⧉ Kanban"}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const columns: ColumnDef<CareerApplication, unknown>[] = [
  {
    accessorKey: "number",
    header: "#",
    cell: (info) => (
      <span className="font-mono text-gray-500 dark:text-gray-400">
        {String(info.getValue<number>()).padStart(3, "0")}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "date",
    header: "Date",
    enableSorting: true,
  },
  {
    accessorKey: "company",
    header: "Company",
    cell: (info) => (
      <span className="font-medium text-gray-900 dark:text-white">
        {info.getValue<string>()}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: (info) => (
      <span className="max-w-xs truncate block" title={info.getValue<string>()}>
        {info.getValue<string>()}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "score",
    header: "Score",
    cell: (info) => {
      const v = info.getValue<number | null>();
      return v !== null ? (
        <span
          className={[
            "inline-block px-1.5 py-0.5 rounded text-xs font-semibold",
            v >= 4
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : v >= 3
                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
          ].join(" ")}
        >
          {v.toFixed(1)}
        </span>
      ) : (
        <span className="text-gray-400 dark:text-gray-500">—</span>
      );
    },
    enableSorting: true,
    sortUndefined: "last",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (info) => {
      const s = info.getValue<string>();
      const colorMap: Record<string, string> = {
        Interview: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
        Offer: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
        Applied: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
        Evaluated: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
        Rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
        Discarded: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
        Responded: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
        SKIP: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500",
      };
      return (
        <span
          className={[
            "inline-block px-1.5 py-0.5 rounded text-xs font-medium",
            colorMap[s] ?? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
          ].join(" ")}
        >
          {s}
        </span>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "hasPDF",
    header: "PDF",
    cell: (info) =>
      info.getValue<boolean>() ? (
        <span title="PDF available">✅</span>
      ) : (
        <span title="No PDF" className="text-gray-300 dark:text-gray-600">
          ❌
        </span>
      ),
    enableSorting: true,
  },
  {
    accessorKey: "notes",
    header: "Notes",
    cell: (info) => {
      const n = info.getValue<string>();
      return n ? (
        <span
          className="max-w-xs truncate block text-gray-500 dark:text-gray-400 text-xs"
          title={n}
        >
          {n}
        </span>
      ) : null;
    },
    enableSorting: false,
  },
];

// ---------------------------------------------------------------------------
// Applications tab
// ---------------------------------------------------------------------------

export function Applications() {
  const { apps, loading, error } = useApplications();
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // Parse the error code from the CommandError message / thrown value.
  // The store stores err.message as a string; CommandError objects are thrown
  // from ipc.ts dispatch as { code, message } — when stringified by
  // `err instanceof Error ? err.message : String(err)` you get the message.
  // We also check if the raw string contains 'repo_not_configured'.
  const isRepoNotConfigured =
    error !== null &&
    (error.includes("repo_not_configured") || error === "repo_not_configured");

  // Loading skeleton
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
          <span className="text-sm">Loading applications…</span>
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
            Failed to load applications
          </p>
          <p className="text-gray-500 dark:text-gray-400 text-xs break-all">{error}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (!loading && apps.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <span className="text-4xl">📋</span>
          <h3 className="text-gray-700 dark:text-gray-200 font-semibold">No applications yet</h3>
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            Evaluate your first job offer to get started.
          </p>
        </div>
      </div>
    );
  }

  // Loaded — show table or kanban
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {apps.length} application{apps.length !== 1 ? "s" : ""}
        </p>
        <ViewToggle active={viewMode} onChange={setViewMode} />
      </div>

      {viewMode === "table" ? (
        <DataTable
          columns={columns}
          data={apps}
          defaultSorting={[{ id: "number", desc: true }]}
        />
      ) : (
        <ApplicationsKanban apps={apps} />
      )}
    </div>
  );
}
