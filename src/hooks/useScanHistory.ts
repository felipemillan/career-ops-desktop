/**
 * useScanHistory.ts — React hook for loading and parsing data/scan-history.tsv.
 *
 * Fetches via ipc.readScanHistory(), parses via parsers/scan-history.ts.
 * Subscribes to the 'scan' refresh topic from store.ts so that
 * any emitRefresh('scan') call elsewhere triggers a re-fetch.
 *
 * No direct invoke. No node:fs.
 */

import { useState, useEffect, useCallback } from 'react';
import { readScanHistory } from '../lib/ipc';
import { parseScanHistory, type ScanHistoryRow } from '../lib/parsers/scan-history';
import { subscribe, emitRefresh } from '../lib/store';

export type ScanHistoryState = {
  rows: ScanHistoryRow[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
};

let state: ScanHistoryState = {
  rows: [],
  loading: false,
  error: null,
  lastFetched: null,
};

let inflight: Promise<ScanHistoryRow[]> | null = null;

function setState(next: Partial<ScanHistoryState>): void {
  state = { ...state, ...next };
}

export function getScanHistoryState(): ScanHistoryState {
  return state;
}

export async function fetchScanHistory(): Promise<ScanHistoryRow[]> {
  if (inflight) return inflight;

  setState({ loading: true, error: null });

  inflight = (async (): Promise<ScanHistoryRow[]> => {
    try {
      const response = await readScanHistory();
      const rows = parseScanHistory(response.content);
      setState({ rows, loading: false, lastFetched: Date.now() });
      emitRefresh('scan');
      return rows;
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

export function useScanHistory(): ScanHistoryState & { refresh: () => Promise<void> } {
  const [snap, setSnap] = useState<ScanHistoryState>(getScanHistoryState());

  const refresh = useCallback(async () => {
    await fetchScanHistory();
  }, []);

  useEffect(() => {
    setSnap(getScanHistoryState());

    const unsub = subscribe('scan', () => {
      setSnap(getScanHistoryState());
    });

    if (!getScanHistoryState().lastFetched && !getScanHistoryState().loading) {
      fetchScanHistory().catch(() => {
        // error stored in state; component re-renders via subscription
      });
    }

    return unsub;
  }, []);

  return { ...snap, refresh };
}
