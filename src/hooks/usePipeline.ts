/**
 * usePipeline.ts — React hook for loading and parsing data/pipeline.md.
 *
 * Fetches via ipc.readPipeline(), parses via parsers/pipeline.ts.
 * Subscribes to the 'pipeline' refresh topic from store.ts so that
 * any emitRefresh('pipeline') call elsewhere triggers a re-fetch.
 *
 * No direct invoke. No node:fs.
 */

import { useState, useEffect, useCallback } from 'react';
import { readPipeline } from '../lib/ipc';
import { parsePipeline, countPending } from '../lib/parsers/pipeline';
import type { PipelineItem } from '../lib/types';
import { subscribe, emitRefresh } from '../lib/store';

export type PipelineState = {
  items: PipelineItem[];
  pendingCount: number;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
};

let state: PipelineState = {
  items: [],
  pendingCount: 0,
  loading: false,
  error: null,
  lastFetched: null,
};

let inflight: Promise<PipelineItem[]> | null = null;

function setState(next: Partial<PipelineState>): void {
  state = { ...state, ...next };
}

export function getPipelineState(): PipelineState {
  return state;
}

export async function fetchPipeline(): Promise<PipelineItem[]> {
  if (inflight) return inflight;

  setState({ loading: true, error: null });

  inflight = (async (): Promise<PipelineItem[]> => {
    try {
      const response = await readPipeline();
      const items = parsePipeline(response.content);
      const pendingCount = countPending(response.content);
      setState({ items, pendingCount, loading: false, lastFetched: Date.now() });
      emitRefresh('pipeline');
      return items;
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

export function usePipeline(): PipelineState & { refresh: () => Promise<void> } {
  const [snap, setSnap] = useState<PipelineState>(getPipelineState());

  const refresh = useCallback(async () => {
    await fetchPipeline();
  }, []);

  useEffect(() => {
    setSnap(getPipelineState());

    const unsub = subscribe('pipeline', () => {
      setSnap(getPipelineState());
    });

    if (!getPipelineState().lastFetched && !getPipelineState().loading) {
      fetchPipeline().catch(() => {
        // error stored in state; component re-renders via subscription
      });
    }

    return unsub;
  }, []);

  return { ...snap, refresh };
}
