/**
 * FirecrawlPanel.tsx — Modal/drawer for Firecrawl API key management + scrape trigger.
 *
 * On open: calls firecrawlStatus() to fetch key count and dormancy state.
 * Shows masked key rows (Key 1, Key 2, …) with remove (✕) buttons.
 * Add key input (type=password, fc-… prefix) → firecrawlAddKey() → refresh.
 * "Scrape long-tail" → firecrawlEnqueue([]) — fires the enqueue job.
 *   When firecrawlEnqueue returns write_ok, calls onJobStarted(job_id) if
 *   the backend returned a job_id. Because the current ipc.ts firecrawlEnqueue
 *   returns write_ok (not job_started), the "Scrape" button shows a toast
 *   confirming the enqueue and directs the user to the console.
 *
 * Keys are sensitive: input type=password, never logged, panel only sees
 * the COUNT from firecrawlStatus() — never the stored values.
 *
 * Constraints: ipc.ts wrappers only, no direct invoke, no new npm deps.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  firecrawlStatus,
  firecrawlAddKey,
  firecrawlRemoveKey,
  firecrawlEnqueue,
  type FirecrawlStatusDto,
} from '../lib/ipc';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FirecrawlPanelProps {
  onClose: () => void;
  onJobStarted: (jobId: string) => void;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  kind: ToastKind;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidKey(key: string): boolean {
  return key.trim().startsWith('fc-') && key.trim().length > 4;
}

function DormantBadge({ dormant }: { dormant: boolean }): React.ReactElement {
  return dormant ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
      dormant
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700">
      <span className="animate-pulse h-1.5 w-1.5 rounded-full bg-green-500" />
      active
    </span>
  );
}

// ---------------------------------------------------------------------------
// FirecrawlPanel
// ---------------------------------------------------------------------------

export function FirecrawlPanel({ onClose, onJobStarted }: FirecrawlPanelProps): React.ReactElement {
  const [status, setStatus] = useState<FirecrawlStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [removeBusy, setRemoveBusy] = useState<Record<number, boolean>>({});
  const [scrapeBusy, setScrapeBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss toast after 4 s
  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  const showToast = (kind: ToastKind, message: string) => setToast({ kind, message });

  const loadStatus = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await firecrawlStatus();
      setStatus(res.status);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Fetch status when panel opens
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleAddKey(): Promise<void> {
    const key = newKey.trim();
    if (!isValidKey(key) || addBusy) return;
    setAddBusy(true);
    try {
      await firecrawlAddKey(key);
      setNewKey('');
      showToast('success', 'Key added');
      await loadStatus();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
  }

  async function handleRemoveKey(index: number): Promise<void> {
    if (removeBusy[index]) return;
    setRemoveBusy((b) => ({ ...b, [index]: true }));
    try {
      await firecrawlRemoveKey(index);
      showToast('info', `Key ${index + 1} removed`);
      await loadStatus();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setRemoveBusy((b) => ({ ...b, [index]: false }));
    }
  }

  async function handleScrape(): Promise<void> {
    if (scrapeBusy || !status || status.dormant) return;
    setScrapeBusy(true);
    try {
      // firecrawlEnqueue runs firecrawl-probe.mjs → returns the job_id; open the console to stream it.
      const res = await firecrawlEnqueue([]);
      onJobStarted(res.job_id);
      onClose();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setScrapeBusy(false);
    }
  }

  const keyCount = status?.keys ?? 0;
  const isDormant = status?.dormant ?? true;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        className="relative w-full max-w-sm mx-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Firecrawl settings"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">Firecrawl</span>
            {status && <DormantBadge dormant={isDormant} />}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-4 py-4 overflow-y-auto">
          {/* Load error */}
          {loadError && (
            <p className="text-xs text-red-500 dark:text-red-400">{loadError}</p>
          )}

          {/* Status summary */}
          {status && (
            <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
              <span>
                <span className="font-medium text-gray-800 dark:text-gray-200">{keyCount}</span> key{keyCount !== 1 ? 's' : ''}
              </span>
              {status.queue_len > 0 && (
                <span>{status.queue_len} queued</span>
              )}
              {status.cooling_down > 0 && (
                <span className="text-amber-600 dark:text-amber-400">{status.cooling_down} cooling</span>
              )}
            </div>
          )}

          {/* Key list */}
          {status && keyCount > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Stored keys
              </p>
              {Array.from({ length: keyCount }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                >
                  <span className="text-xs text-gray-600 dark:text-gray-300 font-mono">
                    Key {i + 1} <span className="text-gray-400 dark:text-gray-500">••••••••</span>
                  </span>
                  <button
                    type="button"
                    disabled={!!removeBusy[i]}
                    onClick={() => void handleRemoveKey(i)}
                    className="text-[10px] text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-40 cursor-pointer transition-colors ml-2"
                    aria-label={`Remove key ${i + 1}`}
                  >
                    {removeBusy[i] ? '…' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add key */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Add key
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddKey(); }}
                placeholder="fc-…"
                disabled={addBusy}
                autoComplete="new-password"
                className={[
                  'flex-1 text-xs px-2.5 py-1.5 rounded-lg border',
                  'bg-white dark:bg-gray-800',
                  'text-gray-700 dark:text-gray-200',
                  'border-gray-300 dark:border-gray-600',
                  'focus:outline-none focus:ring-1 focus:ring-indigo-400',
                  addBusy ? 'opacity-50' : '',
                ].join(' ')}
              />
              <button
                type="button"
                disabled={!isValidKey(newKey) || addBusy}
                onClick={() => void handleAddKey()}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                  !isValidKey(newKey) || addBusy
                    ? 'opacity-50 cursor-not-allowed border-indigo-300 dark:border-indigo-700 bg-indigo-100 dark:bg-indigo-900 text-indigo-400'
                    : 'border-indigo-500 dark:border-indigo-400 bg-indigo-500 dark:bg-indigo-600 text-white hover:bg-indigo-600 dark:hover:bg-indigo-500 cursor-pointer',
                ].join(' ')}
              >
                {addBusy ? 'Adding…' : 'Add'}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              Keys are stored securely and never displayed after entry.
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-100 dark:border-gray-800" />

          {/* Scrape long-tail */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={isDormant || scrapeBusy}
              onClick={() => void handleScrape()}
              className={[
                'w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors border',
                isDormant || scrapeBusy
                  ? 'opacity-50 cursor-not-allowed border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-400'
                  : 'border-green-500 dark:border-green-600 bg-green-500 dark:bg-green-700 text-white hover:bg-green-600 dark:hover:bg-green-600 cursor-pointer',
              ].join(' ')}
            >
              {scrapeBusy ? 'Enqueuing…' : 'Scrape long-tail'}
            </button>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
              Opt-in. Uses your Firecrawl API keys. Output streams to the console.
              {isDormant && ' Add at least one key to enable.'}
            </p>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={[
              'mx-4 mb-4 px-3 py-2 rounded-lg text-xs font-medium',
              toast.kind === 'success'
                ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700'
                : toast.kind === 'info'
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700'
                  : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700',
            ].join(' ')}
          >
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
}
