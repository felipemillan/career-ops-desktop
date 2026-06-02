/**
 * ApplicationsKanban.tsx — Read-only kanban of career applications.
 *
 * Uses @dnd-kit for drag interaction, but is intentionally READ-ONLY:
 * cards snap back to their original column on drop. No writes happen.
 * Status changes are deferred to Phase 5.
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
  type DragStartEvent,
  type DragEndEvent,
  closestCorners,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CareerApplication } from "../../lib/types";
import { reportIdFromApp } from "../../lib/report-id";

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
// Grouping helper
// ---------------------------------------------------------------------------

function groupByStatus(apps: CareerApplication[]): Record<string, CareerApplication[]> {
  const cols: Record<string, CareerApplication[]> = {};
  for (const s of CANONICAL_STATUSES) cols[s] = [];

  for (const app of apps) {
    const key = (CANONICAL_STATUSES as readonly string[]).includes(app.status)
      ? app.status
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

// ---------------------------------------------------------------------------
// Card component (sortable slot — drag is purely visual)
// ---------------------------------------------------------------------------

interface AppCardProps {
  app: CareerApplication;
  isDragging?: boolean;
  onOpenReport?: (id: string) => void;
}

function AppCard({ app, isDragging = false, onOpenReport }: AppCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: String(app.number),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
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
      title="Drag is visual only — status changes save in a later version"
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
  const ids = apps.map((a) => String(a.number));

  return (
    <div className="flex flex-col shrink-0 w-60 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 p-3">
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

      {/* Cards */}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
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
      </SortableContext>
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
  const columns = groupByStatus(apps);

  // Track which card is being dragged (for overlay)
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const activeApp = activeId
    ? apps.find((a) => String(a.number) === activeId) ?? null
    : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  // READ-ONLY: On drag end, simply clear the active ID.
  // The card returns to its original position because columns state is derived
  // from props (apps), not from drag state. No writes occur.
  const handleDragEnd = useCallback((_event: DragEndEvent) => {
    setActiveId(null);
  }, []);

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
      {/* Read-only notice */}
      <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        <span aria-hidden>👀</span>
        <span>
          <strong>Read-only view</strong> — dragging cards is visual only. Status changes will be saved in a future version (Phase 5).
        </span>
      </div>

      {/* Kanban board — horizontally scrollable */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
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
