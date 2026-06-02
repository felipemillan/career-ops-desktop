/**
 * store.test.ts — Unit tests for the ApplicationsStore and refreshBus.
 * Does NOT use React.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ipc before importing store
vi.mock('./ipc', () => ({
  readApplications: vi.fn(),
}));

// Mock parsers/applications to return a predictable result
vi.mock('./parsers/applications', () => ({
  parseApplications: vi.fn((content: string) => {
    if (!content) return [];
    // Return a simple stub app for non-empty content
    return [
      {
        number: 1,
        date: '2026-01-01',
        company: 'Test Co',
        role: 'Engineer',
        status: 'Evaluated',
        score: 4.0,
        scoreRaw: '4.0/5',
        hasPDF: false,
        reportPath: null,
        reportNumber: null,
        notes: '',
        jobURL: null,
      },
    ];
  }),
}));

import { readApplications } from './ipc';
import { parseApplications } from './parsers/applications';
import {
  subscribe,
  emitRefresh,
  fetchApplications,
  getApplicationsState,
  resetStore,
} from './store';

const mockReadApplications = vi.mocked(readApplications);
const mockParseApplications = vi.mocked(parseApplications);

beforeEach(() => {
  resetStore();
  mockReadApplications.mockReset();
  mockParseApplications.mockClear();
});

// ---------------------------------------------------------------------------
// refreshBus
// ---------------------------------------------------------------------------
describe('refreshBus — subscribe / emitRefresh', () => {
  it('calls subscriber when emitRefresh is called for its topic', () => {
    const fn = vi.fn();
    subscribe('applications', fn);
    emitRefresh('applications');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT call subscriber for a different topic', () => {
    const fn = vi.fn();
    subscribe('reports', fn);
    emitRefresh('applications');
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls multiple subscribers for the same topic', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    subscribe('applications', fn1);
    subscribe('applications', fn2);
    emitRefresh('applications');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe returned function stops future calls', () => {
    const fn = vi.fn();
    const unsub = subscribe('scan', fn);
    unsub();
    emitRefresh('scan');
    expect(fn).not.toHaveBeenCalled();
  });

  it('supports all four refresh topics without error', () => {
    const topics = ['applications', 'reports', 'pipeline', 'scan'] as const;
    for (const topic of topics) {
      expect(() => emitRefresh(topic)).not.toThrow();
    }
  });

  it('emitRefresh on topic with no subscribers does not throw', () => {
    expect(() => emitRefresh('pipeline')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// fetchApplications
// ---------------------------------------------------------------------------
describe('fetchApplications()', () => {
  it('calls readApplications exactly once per fetch', async () => {
    mockReadApplications.mockResolvedValue({ kind: 'text', content: 'data' });
    await fetchApplications();
    expect(mockReadApplications).toHaveBeenCalledTimes(1);
  });

  it('updates state.apps after fetch', async () => {
    mockReadApplications.mockResolvedValue({ kind: 'text', content: 'data' });
    await fetchApplications();
    expect(getApplicationsState().apps).toHaveLength(1);
    expect(getApplicationsState().apps[0].company).toBe('Test Co');
  });

  it('sets loading to false after successful fetch', async () => {
    mockReadApplications.mockResolvedValue({ kind: 'text', content: 'data' });
    await fetchApplications();
    expect(getApplicationsState().loading).toBe(false);
  });

  it('sets lastFetched after successful fetch', async () => {
    mockReadApplications.mockResolvedValue({ kind: 'text', content: 'data' });
    await fetchApplications();
    expect(getApplicationsState().lastFetched).not.toBeNull();
  });

  it('sets error on failure and loading stays false', async () => {
    mockReadApplications.mockRejectedValue(new Error('network error'));
    await expect(fetchApplications()).rejects.toThrow('network error');
    expect(getApplicationsState().error).toBe('network error');
    expect(getApplicationsState().loading).toBe(false);
  });

  it('emits refresh("applications") after successful fetch', async () => {
    mockReadApplications.mockResolvedValue({ kind: 'text', content: 'data' });
    const fn = vi.fn();
    subscribe('applications', fn);
    await fetchApplications();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // Dedup: concurrent fetches share one underlying call
  it('deduplicates concurrent fetches — only ONE readApplications call', async () => {
    let resolveA!: (v: { kind: 'text'; content: string }) => void;
    const pending = new Promise<{ kind: 'text'; content: string }>((res) => { resolveA = res; });
    mockReadApplications.mockReturnValue(pending);

    // Start two concurrent fetches
    const p1 = fetchApplications();
    const p2 = fetchApplications();

    // Resolve the single underlying call
    resolveA({ kind: 'text', content: 'data' });

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both callers get the same result
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(1);

    // Only one actual IPC call was made
    expect(mockReadApplications).toHaveBeenCalledTimes(1);
  });

  it('second fetch after first completes triggers a new call', async () => {
    mockReadApplications.mockResolvedValue({ kind: 'text', content: 'data' });
    await fetchApplications();
    await fetchApplications();
    expect(mockReadApplications).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// getApplicationsState
// ---------------------------------------------------------------------------
describe('getApplicationsState()', () => {
  it('initial state has apps=[], loading=false, error=null, lastFetched=null', () => {
    const s = getApplicationsState();
    expect(s.apps).toEqual([]);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.lastFetched).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resetStore
// ---------------------------------------------------------------------------
describe('resetStore()', () => {
  it('clears state and subscribers', async () => {
    mockReadApplications.mockResolvedValue({ kind: 'text', content: 'data' });
    const fn = vi.fn();
    subscribe('applications', fn);
    await fetchApplications();
    // fn was called once by the fetch's emitRefresh
    expect(fn).toHaveBeenCalledTimes(1);
    resetStore();
    fn.mockClear(); // reset the call counter after store is cleared
    emitRefresh('applications');
    expect(fn).not.toHaveBeenCalled(); // subscriber was removed by resetStore
    expect(getApplicationsState().apps).toEqual([]);
  });
});
