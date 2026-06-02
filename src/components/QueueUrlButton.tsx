/**
 * QueueUrlButton.tsx — Compact URL input + "Queue" button.
 *
 * Validates non-empty http(s) URL client-side, calls queueUrl() from ipc.ts,
 * shows a transient toast (Queued / Already in pipeline / error).
 * Clears input on success.
 *
 * Constraints: ipc.ts wrappers only, no direct invoke, no new npm deps.
 */

import { useEffect, useRef, useState } from 'react';
import { queueUrl } from '../lib/ipc';

// ---------------------------------------------------------------------------
// Toast state
// ---------------------------------------------------------------------------

type ToastKind = 'success' | 'duplicate' | 'error';

interface Toast {
  kind: ToastKind;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// QueueUrlButton
// ---------------------------------------------------------------------------

export function QueueUrlButton(): React.ReactElement {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss toast after 3 s
  useEffect(() => {
    if (!toast) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 3000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast]);

  const trimmed = url.trim();
  const valid = trimmed.length > 0 && isHttpUrl(trimmed);

  async function handleQueue(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await queueUrl(trimmed);
      if (res.duplicate) {
        setToast({ kind: 'duplicate', message: 'Already in pipeline' });
      } else {
        setToast({ kind: 'success', message: 'Queued' });
        setUrl('');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      <input
        type="url"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setToast(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') void handleQueue(); }}
        placeholder="Queue job URL…"
        disabled={busy}
        className={[
          'text-xs px-2 py-1 rounded border',
          'bg-white dark:bg-gray-800',
          'text-gray-700 dark:text-gray-200',
          toast?.kind === 'error'
            ? 'border-red-400 dark:border-red-500'
            : 'border-gray-300 dark:border-gray-600',
          'focus:outline-none focus:ring-1 focus:ring-indigo-400 w-48',
          busy ? 'opacity-50' : '',
        ].join(' ')}
      />
      <button
        type="button"
        disabled={!valid || busy}
        onClick={() => void handleQueue()}
        className={[
          'inline-flex items-center px-2.5 py-1 rounded text-xs font-medium transition-colors',
          'border border-indigo-500 dark:border-indigo-400',
          !valid || busy
            ? 'opacity-50 cursor-not-allowed bg-indigo-300 dark:bg-indigo-900 text-white'
            : 'bg-indigo-500 dark:bg-indigo-600 text-white hover:bg-indigo-600 dark:hover:bg-indigo-500 cursor-pointer',
        ].join(' ')}
      >
        {busy ? 'Queuing…' : 'Queue'}
      </button>

      {/* Transient toast */}
      {toast && (
        <span
          className={[
            'text-[10px] whitespace-nowrap font-medium',
            toast.kind === 'success'
              ? 'text-green-600 dark:text-green-400'
              : toast.kind === 'duplicate'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-red-500 dark:text-red-400 truncate max-w-[160px]',
          ].join(' ')}
          title={toast.message}
        >
          {toast.message}
        </span>
      )}
    </div>
  );
}
