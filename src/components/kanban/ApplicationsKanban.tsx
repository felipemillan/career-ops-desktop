/**
 * ApplicationsKanban.tsx — Persistent kanban of career applications.
 *
 * Drag a card to a different column → calls updateStatus via ipc.ts, emits
 * emitRefresh('applications') on success. Optimistic move + rollback on error.
 *
 * Columns = 8 canonical statuses from CLAUDE.md:
 *   Evaluated, Applied, Responded, Interview, Offer, Rejected, Discarded, SKIP
 */
import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
  pointerWithin,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CareerApplication } from "../../lib/types";
import { reportIdFromApp } from "../../lib/report-id";
import { updateStatus } from "../../lib/ipc";
import type { CanonicalStatus } from "../../lib/ipc";
import { emitRefresh, fetchApplications } from "../../lib/store";
import { track } from "../../lib/analytics";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CANONICAL_STATUSES = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Rejected",
  "Discarded",
  "SKIP",
] as const;

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Evaluated: { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-700 dark:text-gray-200", dot: "#6b7280" },
  Applied: { bg: "bg-indigo-50 dark:bg-indigo-950", text: "text-indigo-700 dark:text-indigo-300", dot: "#6366f1" },
  Responded: { bg: "bg-teal-50 dark:bg-teal-950", text: "text-teal-700 dark:text-teal-300", dot: "#14b8a6" },
  Interview: { bg: "bg-purple-50 dark:bg-purple-950", text: "text-purple-700 dark:text-purple-300", dot: "#a855f7" },
  Offer: { bg: "bg-yellow-50 dark:bg-yellow-950", text: "text-yellow-700 dark:text-yellow-700", dot: "#eab308" },
  Rejected: { bg: "bg-red-50 dark:bg-red-950", text: "text-red-700 dark:text-red-300", dot: "#ef4444" },
  Discarded: { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-400 dark:text-gray-500", dot: "#9ca3af" },
  SKIP: { bg: "bg-gray-50 dark:bg-gray-900", text: "text-gray-400 dark:text-gray-500", dot: "#d1d5db" },
};

function scoreColor(score: number | null): string {
  if (score === null) return "text-gray-400 dark:text-gray-500";
  if (score >= 4) return "text-green-600 dark:text-green-400";
  if (score >= 3) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

// ---------------------------------------------------------------------------
// Pure helper — exported so it can be unit-tested without React
// ---------------------------------------------------------------------------

/**
 * Returns true if a drag from `currentStatus` onto a column identified by
 * `targetColumnId` should trigger a backend write.
 *
 * No-op conditions:
 *   - dropped back in the same column
 *   - targetColumnId is not one of the 8 canonical statuses (dropped in limbo)
 */
export function shouldWriteStatus(
  currentStatus: string,
  targetColumnId: string,
): boolean {
  if (targetColumnId === currentStatus) return false;
  return (CANONICAL_STATUSES as readonly string[]).includes(targetColumnId);
}

// ---------------------------------------------------------------------------
// Grouping helper
// ---------------------------------------------------------------------------

function groupByStatus(
  apps: CareerApplication[],
  overrides: Map<number, CanonicalStatus>,
): Record<string, CareerApplication[]> {
  const cols: Record<string, CareerApplication[]> = {};
  for (const s of CANONICAL_STATUSES) cols[s] = [];

  for (const app of apps) {
    const effectiveStatus = overrides.get(app.number) ?? app.status;
    const key = (CANONICAL_STATUSES as readonly string[]).includes(effectiveStatus)
      ? effectiveStatus
      : "Evaluated";
    cols[key].push(app);
  }

  // Sort each column: score desc (null = worst), then date desc
  for (const key of Object.keys(cols)) {
    cols[key].sort((a, b) => {
      const sa = a.score ?? -1;
      const sb = b.score ?? -1;
      if (sb !== sa) return sb - sa;
      return (b.date ?? "").localeCompare(a.date ?? "");
    });
  }

  return cols;
}

/**
 * Derive which column a card currently lives in, respecting local overrides.
 */
function effectiveStatus(
  app: CareerApplication,
  overrides: Map<number, CanonicalStatus>,
): string {
  return overrides.get(app.number) ?? app.status;
}

/**
 * Given the drag event's `over.id`, figure out the target column status.
 * `over.id` may be a column id (a status string) or a card id (app.number string).
 * We resolve card ids by looking up their column in the provided columns map.
 */
function resolveTargetColumn(
  overId: string,
  columns: Record<string, CareerApplication[]>,
): string | null {
  // Direct column id?
  if ((CANONICAL_STATUSES as readonly string[]).includes(overId)) return overId;

  // Card id — find which column it belongs to
  for (const [status, cards] of Object.entries(columns)) {
    if (cards.some((c) => String(c.number) === overId)) return status;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

interface AppCardProps {
  app: CareerApplication;
  onOpenReport?: (id: string) => void;
}

function AppCard({ app, onOpenReport }: AppCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: String(app.number) });

  const style = {
    transform: CSS.Translate.toString(transform),
    // Hide the original while its overlay is dragging (avoids a duplicate).
    opacity: isDragging ? 0.3 : 1,
  };

  const reportId = reportIdFromApp(app);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "rounded-lg border border-gray-200 dark:border-gray-700",
        "bg-white dark:bg-gray-900 p-3 shadow-xs",
        "cursor-grab active:cursor-grabbing select-none",
        "hover:border-gray-300 dark:hover:border-gray-600 transition-colors",
      ].join(" ")}
      title="Drag to a different column to change status — writes a .bak backup automatically"
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 line-clamp-1">
          {app.company}
        </span>
        {app.score !== null && (
          <span
            className={[
              "shrink-0 text-xs font-semibold tabular-nums",
              scoreColor(app.score),
            ].join(" ")}
          >
            {app.score.toFixed(1)}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-1.5">
        {app.role}
      </p>
      <div className="flex items-center justify-between text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
        <span>#{String(app.number).padStart(3, "0")}</span>
        <span>{app.date}</span>
        {reportId && onOpenReport && (
          <button
            type="button"
            title="View report"
            aria-label={`View report for ${app.company}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenReport(reportId);
            }}
            // Prevent dnd-kit from treating this as a drag start
            onPointerDown={(e) => e.stopPropagation()}
            className="ml-1 rounded px-1 py-0.5 text-[11px] text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-300 transition-colors cursor-pointer"
          >
            📄
          </button>
        )}
      </div>
    </div>
  );
}

/** Overlay card rendered while dragging (no sortable hooks). */
function OverlayCard({ app }: { app: CareerApplication }) {
  return (
    <div
      className={[
        "rounded-lg border border-gray-300 dark:border-gray-600",
        "bg-white dark:bg-gray-900 p-3 shadow-lg",
        "rotate-2 scale-105 cursor-grabbing select-none opacity-95",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 line-clamp-1">
          {app.company}
        </span>
        {app.score !== null && (
          <span className={["shrink-0 text-xs font-semibold tabular-nums", scoreColor(app.score)].join(" ")}>
            {app.score.toFixed(1)}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-1.5">{app.role}</p>
      <div className="flex items-center justify-between text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
        <span>#{String(app.number).padStart(3, "0")}</span>
        <span>{app.date}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column component
// ---------------------------------------------------------------------------

interface KanbanColumnProps {
  status: string;
  apps: CareerApplication[];
  onOpenReport?: (id: string) => void;
}

function KanbanColumn({ status, apps, onOpenReport }: KanbanColumnProps) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS["Evaluated"];

  // The whole column is a drop target — its id IS the status, so dropping
  // anywhere on the column (incl. empty space) resolves over.id = status.
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={[
        "flex flex-col shrink-0 w-60 rounded-xl border p-3 transition-colors",
        isOver
          ? "border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-950/40"
          : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950",
      ].join(" ")}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="size-2 rounded-full shrink-0"
          style={{ background: colors.dot }}
          aria-hidden
        />
        <span className={["text-xs font-semibold", colors.text].join(" ")}>
          {status}
        </span>
        <span className="ml-auto text-[10px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
          {apps.length}
        </span>
      </div>

      {/* Cards — column is the only drop target (useDroppable above) */}
      <div className="flex flex-col gap-2 min-h-[80px]">
        {apps.length === 0 ? (
          <div className="rounded border border-dashed border-gray-200 dark:border-gray-700 py-4 text-center text-[11px] text-gray-400 dark:text-gray-600">
            Empty
          </div>
        ) : (
          apps.map((app) => (
            <AppCard key={app.number} app={app} onOpenReport={onOpenReport} />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast — inline non-blocking error notice
// ---------------------------------------------------------------------------

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

function ErrorToast({ message, onDismiss }: ToastProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300"
    >
      <span aria-hidden>⚠️</span>
      <span className="flex-1">
        <strong>Status update failed</strong> — {message}
      </span>
      <button
        type="button"
        aria-label="Dismiss error"
        onClick={onDismiss}
        className="shrink-0 ml-1 text-red-500 hover:text-red-700 dark:hover:text-red-200 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

interface ApplicationsKanbanProps {
  apps: CareerApplication[];
  onOpenReport?: (id: string) => void;
}

export function ApplicationsKanban({ apps, onOpenReport }: ApplicationsKanbanProps) {
  // Optimistic overrides: map from app.number → new status (pending backend confirmation)
  const [overrides, setOverrides] = useState<Map<number, CanonicalStatus>>(new Map());

  // Non-blocking error message shown below the board header
  const [dragError, setDragError] = useState<string | null>(null);

  // Track which card is being dragged (for overlay)
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Build columns from props + overrides
  const columns = groupByStatus(apps, overrides);

  const activeApp = activeId
    ? apps.find((a) => String(a.number) === activeId) ?? null
    : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);

      const { active, over } = event;
      if (!over) return;

      const cardId = String(active.id);
      const overId = String(over.id);

      // Find the app being dragged
      const app = apps.find((a) => String(a.number) === cardId);
      if (!app) return;

      const currentSt = effectiveStatus(app, overrides);
      const targetSt = resolveTargetColumn(overId, columns);

      if (!targetSt) return;
      if (!shouldWriteStatus(currentSt, targetSt)) return;

      const targetStatus = targetSt as CanonicalStatus;
      const appNumber = app.number;

      // --- Optimistic update ---
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(appNumber, targetStatus);
        return next;
      });
      setDragError(null);

      // --- Backend write ---
      updateStatus(appNumber, targetStatus)
        .then(() => {
          // Track status change — status strings only, no company/number/score
          track('status_changed', { from: currentSt, to: targetStatus });
          // Success — emit refresh so the store re-reads applications.md.
          // fetchApplications will push fresh data → useApplications() re-renders
          // → parent passes new `apps` prop → overrides for this app become redundant
          // but we clear them anyway for cleanliness.
          emitRefresh("applications");
          fetchApplications()
            .then(() => {
              // Once fresh data is in the store, remove the override
              setOverrides((prev) => {
                const next = new Map(prev);
                next.delete(appNumber);
                return next;
              });
            })
            .catch(() => {
              // fetchApplications error is handled by the store; override stays
              // until next successful refresh. That's acceptable.
            });
        })
        .catch((err: unknown) => {
          // --- Rollback ---
          setOverrides((prev) => {
            const next = new Map(prev);
            next.delete(appNumber);
            return next;
          });

          // Surface a non-blocking error
          let message = "Unknown error";
          if (
            err !== null &&
            typeof err === "object" &&
            "message" in err &&
            typeof (err as { message: unknown }).message === "string"
          ) {
            message = (err as { message: string }).message;
          } else if (err instanceof Error) {
            message = err.message;
          }
          setDragError(message);
        });
    },
    [apps, overrides, columns],
  );

  if (apps.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm text-gray-400 dark:text-gray-500">
          No applications yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Non-blocking write error */}
      {dragError !== null && (
        <ErrorToast message={dragError} onDismiss={() => setDragError(null)} />
      )}

      {/* Kanban board — horizontally scrollable */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {CANONICAL_STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                apps={columns[status] ?? []}
                onOpenReport={onOpenReport}
              />
            ))}
          </div>
        </div>

        {/* Drag overlay — shows a detached card while dragging */}
        <DragOverlay>
          {activeApp ? <OverlayCard app={activeApp} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
