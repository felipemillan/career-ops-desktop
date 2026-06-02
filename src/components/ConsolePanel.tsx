/**
 * ConsolePanel.tsx — Collapsible bottom drawer showing streamed job output.
 *
 * - Tabs for active + recent jobs (most recent first).
 * - Selected job shows stdout (white) and stderr (red) lines.
 * - Auto-scrolls to the latest line.
 * - Cancel button calls ipc.cancelJob().
 * - Clear button removes a finished job from the list.
 * - Collapse/expand toggle.
 */

import { useEffect, useRef, useState } from 'react';
import { cancelJob } from '../lib/ipc';
import { useJobs, type JobEntry, type JobStatus } from '../lib/jobs';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: JobStatus }): React.ReactElement {
  if (status.kind === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600 dark:text-green-400">
        <span className="animate-pulse h-1.5 w-1.5 rounded-full bg-green-500" />
        running
      </span>
    );
  }
  const ok = status.code === 0;
  return (
    <span
      className={[
        'inline-flex items-center gap-1 text-[10px] font-medium',
        ok
          ? 'text-gray-400 dark:text-gray-500'
          : 'text-red-500 dark:text-red-400',
      ].join(' ')}
    >
      <span
        className={[
          'h-1.5 w-1.5 rounded-full',
          ok ? 'bg-gray-400' : 'bg-red-500',
        ].join(' ')}
      />
      exited {status.code}
    </span>
  );
}

interface LineListProps {
  entry: JobEntry;
}

function LineList({ entry }: LineListProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll whenever lines grow
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [entry.lines.length]);

  return (
    <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed p-2 bg-gray-950 text-gray-100">
      {entry.lines.length === 0 && entry.status.kind === 'running' && (
        <span className="text-gray-500 italic">Waiting for output…</span>
      )}
      {entry.lines.map((line, i) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className={
            line.stream === 'stderr'
              ? 'text-red-400'
              : 'text-gray-100'
          }
        >
          {line.text}
        </div>
      ))}
      {entry.status.kind === 'exited' && (
        <div
          className={[
            'mt-1 pt-1 border-t border-gray-700 text-[10px]',
            entry.status.code === 0 ? 'text-gray-500' : 'text-red-500',
          ].join(' ')}
        >
          Process exited with code {entry.status.code}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConsolePanelProps
// ---------------------------------------------------------------------------

export interface ConsolePanelProps {
  /** The job to focus automatically (e.g. just-started job_id). */
  focusJobId: string | null;
  /** Called when the user dismisses/clears the last job and drawer should close. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// ConsolePanel
// ---------------------------------------------------------------------------

export function ConsolePanel({ focusJobId, onClose }: ConsolePanelProps): React.ReactElement {
  const { jobs, order } = useJobs();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({});

  // When a new job starts, auto-select it and expand the drawer
  useEffect(() => {
    if (focusJobId) {
      setSelectedId(focusJobId);
      setCollapsed(false);
    }
  }, [focusJobId]);

  // Visible jobs (in order, minus dismissed)
  const visible = order.filter((id) => !dismissed.has(id));

  // Resolve selected entry
  const effectiveId = selectedId && !dismissed.has(selectedId) ? selectedId : (visible[0] ?? null);
  const selected: JobEntry | null = effectiveId ? (jobs[effectiveId] ?? null) : null;

  async function handleCancel(jobId: string): Promise<void> {
    setCancelling((c) => ({ ...c, [jobId]: true }));
    try {
      await cancelJob(jobId);
    } catch (err) {
      console.error('[ConsolePanel] cancelJob failed:', err);
    } finally {
      setCancelling((c) => ({ ...c, [jobId]: false }));
    }
  }

  function handleDismiss(jobId: string): void {
    setDismissed((d) => {
      const next = new Set(d).add(jobId);
      return next;
    });
    if (effectiveId === jobId) {
      const remaining = visible.filter((id) => id !== jobId);
      setSelectedId(remaining[0] ?? null);
      if (remaining.length === 0) {
        onClose();
      }
    }
  }

  if (visible.length === 0) {
    return <div />;
  }

  return (
    <div
      className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-gray-950 flex flex-col"
      style={{ height: collapsed ? '32px' : '220px', transition: 'height 0.15s ease' }}
    >
      {/* --- Header bar --- */}
      <div className="flex items-center gap-1 px-2 py-1 bg-gray-900 border-b border-gray-800 flex-shrink-0 h-8 overflow-x-auto">
        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0 mr-1 cursor-pointer"
          title={collapsed ? 'Expand console' : 'Collapse console'}
        >
          <svg
            className={`h-3.5 w-3.5 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>

        {/* Job tabs */}
        {visible.map((id) => {
          const entry = jobs[id];
          if (!entry) return null;
          const isActive = id === effectiveId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSelectedId(id)}
              className={[
                'flex-shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer',
                isActive
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800',
              ].join(' ')}
            >
              {entry.status.kind === 'running' && (
                <span className="animate-pulse h-1.5 w-1.5 rounded-full bg-green-400 flex-shrink-0" />
              )}
              {entry.status.kind === 'exited' && entry.status.code !== 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" />
              )}
              <span className="max-w-[120px] truncate">{entry.label}</span>
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Status + actions for selected job */}
        {selected && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={selected.status} />
            {selected.status.kind === 'running' && (
              <button
                type="button"
                disabled={!!cancelling[selected.jobId]}
                onClick={() => void handleCancel(selected.jobId)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-red-700 text-red-400 hover:bg-red-900 disabled:opacity-50 cursor-pointer"
              >
                {cancelling[selected.jobId] ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
            {selected.status.kind === 'exited' && (
              <button
                type="button"
                onClick={() => handleDismiss(selected.jobId)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-400 hover:bg-gray-800 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* --- Output area --- */}
      {!collapsed && selected && <LineList entry={selected} />}
      {!collapsed && !selected && (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
          No job selected
        </div>
      )}
    </div>
  );
}
