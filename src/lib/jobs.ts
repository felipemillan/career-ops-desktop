/**
 * jobs.ts — Per-job output store + streaming event subscriptions.
 *
 * Subscribes once to Tauri events job://stdout, job://stderr, job://exit.
 * Exposes a React hook (useJobs) and a startTracking() imperative call
 * for ActionBar to register a newly-started job.
 *
 * Constraints:
 *  - NO invoke calls — only listen() from @tauri-apps/api/event.
 *  - Listeners are set up once (module-level), never duplicated.
 *  - Pure reducer logic is exported for unit testing.
 */

import { listen } from '@tauri-apps/api/event';
import { useState, useEffect } from 'react';
import { track } from './analytics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobStatus =
  | { kind: 'running' }
  | { kind: 'exited'; code: number };

export type JobLine = {
  stream: 'stdout' | 'stderr';
  text: string;
};

export type JobEntry = {
  jobId: string;
  label: string;
  lines: JobLine[];
  status: JobStatus;
  startedAt: number;
};

export type JobsState = {
  jobs: Record<string, JobEntry>;
  /** Ordered list of jobIds — most recent first */
  order: string[];
};

// ---------------------------------------------------------------------------
// Tauri event payloads
// ---------------------------------------------------------------------------

type StdPayload = { job_id: string; line: string };
type ExitPayload = { job_id: string; code: number };

// ---------------------------------------------------------------------------
// Reducer helpers (pure, exported for testing)
// ---------------------------------------------------------------------------

export function applyLine(
  state: JobsState,
  jobId: string,
  stream: 'stdout' | 'stderr',
  text: string,
): JobsState {
  const entry = state.jobs[jobId];
  if (!entry) return state;
  return {
    ...state,
    jobs: {
      ...state.jobs,
      [jobId]: { ...entry, lines: [...entry.lines, { stream, text }] },
    },
  };
}

export function applyExit(state: JobsState, jobId: string, code: number): JobsState {
  const entry = state.jobs[jobId];
  if (!entry) return state;
  return {
    ...state,
    jobs: {
      ...state.jobs,
      [jobId]: { ...entry, status: { kind: 'exited', code } },
    },
  };
}

export function applyStart(state: JobsState, jobId: string, label: string): JobsState {
  if (state.jobs[jobId]) {
    // Already tracked (shouldn't happen, but be safe)
    return state;
  }
  return {
    jobs: {
      ...state.jobs,
      [jobId]: {
        jobId,
        label,
        lines: [],
        status: { kind: 'running' },
        startedAt: Date.now(),
      },
    },
    order: [jobId, ...state.order],
  };
}

// ---------------------------------------------------------------------------
// Module-level store (plain TS, no React)
// ---------------------------------------------------------------------------

type Subscriber = (state: JobsState) => void;

let _state: JobsState = { jobs: {}, order: [] };
const _subscribers = new Set<Subscriber>();
let _listenersSetUp = false;

function getState(): JobsState {
  return _state;
}

function setState(next: JobsState): void {
  _state = next;
  for (const sub of _subscribers) {
    sub(next);
  }
}

function subscribeTo(fn: Subscriber): () => void {
  _subscribers.add(fn);
  return () => {
    _subscribers.delete(fn);
  };
}

/**
 * Register a newly started job for tracking.
 * Call this right after receiving { kind: 'job_started', job_id } from an ipc wrapper.
 */
export function startTracking(jobId: string, label: string): void {
  setState(applyStart(getState(), jobId, label));
}

/**
 * Set up global Tauri event listeners. Idempotent — safe to call multiple times.
 * Called automatically by useJobs() on first mount.
 */
export function setupListeners(): void {
  if (_listenersSetUp) return;
  _listenersSetUp = true;

  // job://stdout
  listen<StdPayload>('job://stdout', (event) => {
    setState(applyLine(getState(), event.payload.job_id, 'stdout', event.payload.line));
  }).catch(() => {
    // Tauri not available in test/SSR environment — ignore.
  });

  // job://stderr
  listen<StdPayload>('job://stderr', (event) => {
    setState(applyLine(getState(), event.payload.job_id, 'stderr', event.payload.line));
  }).catch(() => {
    // Tauri not available in test/SSR environment — ignore.
  });

  // job://exit
  listen<ExitPayload>('job://exit', (event) => {
    const { job_id, code } = event.payload;
    const prevState = getState();
    setState(applyExit(prevState, job_id, code));
    // Track job completion — label is safe (action name), code is numeric, no output lines
    const entry = prevState.jobs[job_id];
    if (entry) {
      track('job_finished', { label: entry.label, code, success: code === 0 });
    }
  }).catch(() => {
    // Tauri not available in test/SSR environment — ignore.
  });
}

/**
 * Reset store (used in tests).
 */
export function resetJobsStore(): void {
  _state = { jobs: {}, order: [] };
  _subscribers.clear();
  _listenersSetUp = false;
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function useJobs(): JobsState {
  const [snap, setSnap] = useState<JobsState>(getState());

  useEffect(() => {
    setupListeners();
    setSnap(getState());
    const unsub = subscribeTo((s) => setSnap(s));
    return unsub;
  }, []);

  return snap;
}
