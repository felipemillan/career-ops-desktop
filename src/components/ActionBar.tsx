/**
 * ActionBar.tsx — Global slim toolbar for Lane-A zero-token scripts + evaluate.
 *
 * Calls ipc.ts wrappers only (never invoke directly).
 * On success, calls startTracking() from jobs.ts and signals the parent to
 * open the console drawer via onJobStarted().
 */

import { useState } from 'react';
import {
  runScan,
  runMerge,
  runDedup,
  runPatterns,
  runFollowup,
  runVerifyPipeline,
  evaluateUrl,
} from '../lib/ipc';
import { startTracking } from '../lib/jobs';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ActionBarProps {
  /** Called when a new job starts so the parent can open the console drawer */
  onJobStarted: (jobId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Spinner(): React.ReactElement {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 inline-block ml-1"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

interface ActionButtonProps {
  label: string;
  running: boolean;
  onClick: () => void;
  title?: string;
}

function ActionButton({ label, running, onClick, title }: ActionButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      disabled={running}
      onClick={onClick}
      title={title}
      className={[
        'inline-flex items-center px-2.5 py-1 rounded text-xs font-medium transition-colors',
        'border border-gray-300 dark:border-gray-600',
        running
          ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer',
      ].join(' ')}
    >
      {label}
      {running && <Spinner />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ActionBar
// ---------------------------------------------------------------------------

export function ActionBar({ onJobStarted }: ActionBarProps): React.ReactElement {
  // Track which buttons are running by their label key
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [dryRun, setDryRun] = useState(false);
  const [evalUrl, setEvalUrl] = useState('');
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);

  async function fireJob(
    key: string,
    label: string,
    fn: () => Promise<{ kind: 'job_started'; job_id: string }>,
  ): Promise<void> {
    if (running[key]) return;
    setRunning((r) => ({ ...r, [key]: true }));
    try {
      const res = await fn();
      startTracking(res.job_id, label);
      onJobStarted(res.job_id);
    } catch (err) {
      // Errors surface in the console / browser devtools; no alert spam
      console.error(`[ActionBar] ${label} failed:`, err);
    } finally {
      setRunning((r) => ({ ...r, [key]: false }));
    }
  }

  async function handleEvaluate(): Promise<void> {
    const url = evalUrl.trim();
    if (!url) return;
    setEvalError(null);
    setEvalRunning(true);
    try {
      const res = await evaluateUrl(url);
      startTracking(res.job_id, `Evaluate: ${url}`);
      onJobStarted(res.job_id);
      setEvalUrl('');
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : String(err));
    } finally {
      setEvalRunning(false);
    }
  }

  return (
    <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* --- Scan group --- */}
        <div className="flex items-center gap-1">
          <ActionButton
            label="Scan"
            running={!!running['scan']}
            onClick={() =>
              fireJob('scan', dryRun ? 'Scan (dry run)' : 'Scan', () =>
                runScan({ dryRun }),
              )
            }
            title="Run scan.mjs — hits Greenhouse/Ashby/Lever APIs, zero LLM cost"
          />
          <label className="flex items-center gap-0.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-3 w-3 rounded"
            />
            dry run
          </label>
        </div>

        <div className="w-px h-4 bg-gray-300 dark:bg-gray-700" aria-hidden="true" />

        {/* --- Merge / Dedup / Patterns / Follow-up / Verify --- */}
        <ActionButton
          label="Merge"
          running={!!running['merge']}
          onClick={() => fireJob('merge', 'Merge tracker', () => runMerge())}
          title="Run merge-tracker.mjs — merge batch TSV additions into applications.md"
        />
        <ActionButton
          label="Dedup"
          running={!!running['dedup']}
          onClick={() => fireJob('dedup', 'Dedup tracker', () => runDedup())}
          title="Run dedup-tracker.mjs — remove duplicate rows in applications.md"
        />
        <ActionButton
          label="Patterns"
          running={!!running['patterns']}
          onClick={() => fireJob('patterns', 'Analyze patterns', () => runPatterns())}
          title="Run analyze-patterns.mjs — JSON output with rejection pattern analysis"
        />
        <ActionButton
          label="Follow-up"
          running={!!running['followup']}
          onClick={() => fireJob('followup', 'Follow-up cadence', () => runFollowup())}
          title="Run followup-cadence.mjs — show overdue follow-ups"
        />
        <ActionButton
          label="Verify"
          running={!!running['verify']}
          onClick={() => fireJob('verify', 'Verify pipeline', () => runVerifyPipeline())}
          title="Run verify-pipeline.mjs — health check on pipeline integrity"
        />

        <div className="w-px h-4 bg-gray-300 dark:bg-gray-700" aria-hidden="true" />

        {/* --- Evaluate URL --- */}
        <div className="flex items-center gap-1 min-w-0">
          <div className="flex items-center gap-1 flex-1">
            <input
              type="url"
              value={evalUrl}
              onChange={(e) => { setEvalUrl(e.target.value); setEvalError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleEvaluate(); }}
              placeholder="Evaluate job URL…"
              disabled={evalRunning}
              className={[
                'text-xs px-2 py-1 rounded border',
                'bg-white dark:bg-gray-800',
                'text-gray-700 dark:text-gray-200',
                evalError
                  ? 'border-red-400 dark:border-red-500'
                  : 'border-gray-300 dark:border-gray-600',
                'focus:outline-none focus:ring-1 focus:ring-blue-400 w-52',
                evalRunning ? 'opacity-50' : '',
              ].join(' ')}
            />
            <button
              type="button"
              disabled={evalRunning || !evalUrl.trim()}
              onClick={() => void handleEvaluate()}
              className={[
                'inline-flex items-center px-2.5 py-1 rounded text-xs font-medium transition-colors',
                'border border-blue-500 dark:border-blue-400',
                evalRunning || !evalUrl.trim()
                  ? 'opacity-50 cursor-not-allowed bg-blue-300 dark:bg-blue-900 text-white'
                  : 'bg-blue-500 dark:bg-blue-600 text-white hover:bg-blue-600 dark:hover:bg-blue-500 cursor-pointer',
              ].join(' ')}
            >
              Evaluate
              {evalRunning && <Spinner />}
            </button>
          </div>
          {/* Hint */}
          <span
            className="text-[10px] text-amber-600 dark:text-amber-400 whitespace-nowrap"
            title="Uses LLM tokens. Offer verification uses Playwright (unconfirmed in batch mode)."
          >
            costs tokens
          </span>
          {evalError && (
            <span className="text-[10px] text-red-500 dark:text-red-400 truncate max-w-[160px]" title={evalError}>
              {evalError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
