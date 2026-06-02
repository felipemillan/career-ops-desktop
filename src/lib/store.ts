/**
 * store.ts — ApplicationsStore and typed refreshBus.
 *
 * Single source of truth for parsed apps. Framework-light: plain TS with a
 * small subscriber set. A React hook wrapper is exported for convenience but
 * the core is unit-testable without React.
 */

import type { CareerApplication } from './types';
import { readApplications } from './ipc';
import { parseApplications } from './parsers/applications';

// ---------------------------------------------------------------------------
// Refresh bus
// ---------------------------------------------------------------------------

export type RefreshTopic = 'applications' | 'reports' | 'pipeline' | 'scan';

type Subscriber = () => void;

const subscribers = new Map<RefreshTopic, Set<Subscriber>>();

function getTopicSet(topic: RefreshTopic): Set<Subscriber> {
  let s = subscribers.get(topic);
  if (!s) {
    s = new Set();
    subscribers.set(topic, s);
  }
  return s;
}

export function subscribe(topic: RefreshTopic, fn: Subscriber): () => void {
  const set = getTopicSet(topic);
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

export function emitRefresh(topic: RefreshTopic): void {
  const set = subscribers.get(topic);
  if (set) {
    for (const fn of set) {
      fn();
    }
  }
}

// ---------------------------------------------------------------------------
// ApplicationsStore
// ---------------------------------------------------------------------------

export type ApplicationsState = {
  apps: CareerApplication[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
};

const initialState: ApplicationsState = {
  apps: [],
  loading: false,
  error: null,
  lastFetched: null,
};

let state: ApplicationsState = { ...initialState };
let inflight: Promise<CareerApplication[]> | null = null;

function setState(next: Partial<ApplicationsState>): void {
  state = { ...state, ...next };
}

export function getApplicationsState(): ApplicationsState {
  return state;
}

/**
 * Fetch (or join an in-flight fetch) and update the store.
 * Concurrent calls share the same underlying network request.
 */
export async function fetchApplications(): Promise<CareerApplication[]> {
  // If there's already a fetch in flight, await the same promise (dedup).
  if (inflight) {
    return inflight;
  }

  setState({ loading: true, error: null });

  inflight = (async (): Promise<CareerApplication[]> => {
    try {
      const response = await readApplications();
      const apps = parseApplications(response.content);
      setState({ apps, loading: false, lastFetched: Date.now() });
      emitRefresh('applications');
      return apps;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ loading: false, error: message });
      throw err;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Reset the store to its initial state (useful in tests).
 */
export function resetStore(): void {
  state = { ...initialState };
  inflight = null;
  subscribers.clear();
}

// ---------------------------------------------------------------------------
// React hook (optional convenience — core works without React)
// ---------------------------------------------------------------------------

// Import React at the top level. The import is safe to use in Node/test
// environments because vitest mocks/stubs it automatically when present.
// If React is not in the module graph, this import simply won't resolve —
// but since react is a declared dependency this will always resolve in the
// actual app. The hook MUST only be called inside a React component tree.
import { useState, useEffect } from 'react';

export function useApplications(): ApplicationsState & { refresh: () => Promise<void> } {
  const [snap, setSnap] = useState<ApplicationsState>(getApplicationsState());

  useEffect(() => {
    // Push current state immediately
    setSnap(getApplicationsState());
    // Subscribe to refresh events
    const unsub = subscribe('applications', () => {
      setSnap(getApplicationsState());
    });
    // Kick off initial fetch if needed
    if (!getApplicationsState().lastFetched && !getApplicationsState().loading) {
      fetchApplications().catch(() => {
        // error is stored in state; component will re-render via subscription
      });
    }
    return unsub;
  }, []);

  return {
    ...snap,
    refresh: async () => {
      await fetchApplications();
    },
  };
}
