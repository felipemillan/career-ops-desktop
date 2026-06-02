/**
 * jobs.test.ts — Unit tests for the pure reducer helpers in jobs.ts.
 * Does NOT require Tauri (no listen calls exercised here).
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  applyLine,
  applyExit,
  applyStart,
  resetJobsStore,
  type JobsState,
} from './jobs';

const EMPTY: JobsState = { jobs: {}, order: [] };

function withJob(jobId = 'j1', label = 'Test Job'): JobsState {
  return applyStart(EMPTY, jobId, label);
}

beforeEach(() => {
  resetJobsStore();
});

// ---------------------------------------------------------------------------
// applyStart
// ---------------------------------------------------------------------------
describe('applyStart()', () => {
  it('adds a new job entry to the state', () => {
    const next = applyStart(EMPTY, 'j1', 'Scan');
    expect(next.jobs['j1']).toBeDefined();
    expect(next.jobs['j1'].label).toBe('Scan');
    expect(next.jobs['j1'].lines).toEqual([]);
    expect(next.jobs['j1'].status).toEqual({ kind: 'running' });
  });

  it('prepends jobId to order', () => {
    const s1 = applyStart(EMPTY, 'j1', 'A');
    const s2 = applyStart(s1, 'j2', 'B');
    expect(s2.order[0]).toBe('j2');
    expect(s2.order[1]).toBe('j1');
  });

  it('is a no-op if jobId already exists', () => {
    const s1 = applyStart(EMPTY, 'j1', 'A');
    const s2 = applyStart(s1, 'j1', 'A-dup');
    expect(s2.order).toHaveLength(1);
    expect(s2.jobs['j1'].label).toBe('A');
  });

  it('does not mutate the input state', () => {
    const before = JSON.stringify(EMPTY);
    applyStart(EMPTY, 'j1', 'X');
    expect(JSON.stringify(EMPTY)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// applyLine
// ---------------------------------------------------------------------------
describe('applyLine()', () => {
  it('appends a stdout line to the correct job', () => {
    const s1 = withJob();
    const s2 = applyLine(s1, 'j1', 'stdout', 'hello');
    expect(s2.jobs['j1'].lines).toHaveLength(1);
    expect(s2.jobs['j1'].lines[0]).toEqual({ stream: 'stdout', text: 'hello' });
  });

  it('appends a stderr line with correct stream tag', () => {
    const s1 = withJob();
    const s2 = applyLine(s1, 'j1', 'stderr', 'error msg');
    expect(s2.jobs['j1'].lines[0].stream).toBe('stderr');
  });

  it('accumulates multiple lines', () => {
    let s = withJob();
    s = applyLine(s, 'j1', 'stdout', 'line 1');
    s = applyLine(s, 'j1', 'stdout', 'line 2');
    s = applyLine(s, 'j1', 'stderr', 'err 1');
    expect(s.jobs['j1'].lines).toHaveLength(3);
  });

  it('is a no-op for unknown jobId', () => {
    const s = withJob('j1');
    const next = applyLine(s, 'unknown', 'stdout', 'hi');
    expect(next).toBe(s);
  });

  it('does not mutate the input state', () => {
    const s = withJob();
    const beforeLines = [...s.jobs['j1'].lines];
    applyLine(s, 'j1', 'stdout', 'x');
    expect(s.jobs['j1'].lines).toEqual(beforeLines);
  });
});

// ---------------------------------------------------------------------------
// applyExit
// ---------------------------------------------------------------------------
describe('applyExit()', () => {
  it('sets status to exited with the given exit code', () => {
    const s1 = withJob();
    const s2 = applyExit(s1, 'j1', 0);
    expect(s2.jobs['j1'].status).toEqual({ kind: 'exited', code: 0 });
  });

  it('preserves existing lines after exit', () => {
    let s = withJob();
    s = applyLine(s, 'j1', 'stdout', 'done');
    s = applyExit(s, 'j1', 0);
    expect(s.jobs['j1'].lines).toHaveLength(1);
  });

  it('records non-zero exit codes', () => {
    const s1 = withJob();
    const s2 = applyExit(s1, 'j1', 1);
    expect(s2.jobs['j1'].status).toEqual({ kind: 'exited', code: 1 });
  });

  it('is a no-op for unknown jobId', () => {
    const s = withJob('j1');
    const next = applyExit(s, 'unknown', 0);
    expect(next).toBe(s);
  });
});
