/**
 * PipelineTab.tsx — Displays the pending/processed job URL pipeline.
 *
 * Data flow: usePipeline() → readPipeline() (ipc) → parsePipeline() (parser)
 * URL opening: @tauri-apps/plugin-opener openUrl()
 * No direct invoke. No node:fs. No 'use client'.
 */

import { usePipeline } from '../hooks/usePipeline';
import { openUrl } from '@tauri-apps/plugin-opener';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a bare URL from a pipeline list line like "- [ ] https://..." */
function extractUrl(line: string): string | null {
  const match = line.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

/** Extract a display label from a pipeline line for readability. */
function extractLabel(line: string): { url: string | null; rest: string } {
  // Lines can look like:
  //   - [ ] https://jobs.example.com
  //   - [x] #10 | https://example.com | Acme | Head of Marketing | 4.2/5 | PDF ✅
  // Strip the checkbox prefix and return the remainder as the label.
  const withoutCheckbox = line.replace(/^\s*- \[[ x]\]\s*/, '');
  const url = extractUrl(withoutCheckbox);
  return { url, rest: withoutCheckbox };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-3 text-gray-400 dark:text-gray-500">
        <svg
          className="animate-spin h-8 w-8"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
        <span className="text-sm">Loading pipeline…</span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="flex flex-col items-center gap-3 text-center max-w-sm">
        <span className="text-4xl">📋</span>
        <h3 className="text-gray-700 dark:text-gray-200 font-semibold">Pipeline is empty</h3>
        <p className="text-gray-400 dark:text-gray-500 text-sm">
          Add job URLs to <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">data/pipeline.md</code> to start processing.
        </p>
      </div>
    </div>
  );
}

interface UrlRowProps {
  line: string;
  checked: boolean;
}

function UrlRow({ line, checked }: UrlRowProps) {
  const { url, rest } = extractLabel(line);

  async function handleClick() {
    if (url) {
      await openUrl(url);
    }
  }

  return (
    <div
      className={[
        'flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors',
        checked
          ? 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 opacity-60'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800',
      ].join(' ')}
    >
      {/* Checkbox indicator */}
      <span className="mt-0.5 shrink-0">
        {checked ? (
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded bg-green-500 text-white text-[10px] font-bold"
            title="Processed"
          >
            ✓
          </span>
        ) : (
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-600"
            title="Pending"
          />
        )}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {url ? (
          <button
            type="button"
            onClick={handleClick}
            className={[
              'text-left w-full truncate text-sm',
              checked
                ? 'text-gray-400 dark:text-gray-500 line-through-none'
                : 'text-blue-600 dark:text-blue-400 hover:underline cursor-pointer',
            ].join(' ')}
            title={url}
          >
            {rest}
          </button>
        ) : (
          <span className="text-sm text-gray-500 dark:text-gray-400 truncate block">
            {rest}
          </span>
        )}
      </div>

      {/* External link icon for pending items with a URL */}
      {!checked && url && (
        <button
          type="button"
          onClick={handleClick}
          className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-blue-500 dark:hover:text-blue-400 transition-colors mt-0.5"
          title="Open URL"
          aria-label="Open URL in browser"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="w-3.5 h-3.5"
          >
            <path
              fillRule="evenodd"
              d="M9.604 1.396a.75.75 0 0 1 .75-.75h4.25a.75.75 0 0 1 .75.75v4.25a.75.75 0 0 1-1.5 0V3.31l-8.22 8.22a.75.75 0 0 1-1.06-1.06l8.22-8.22h-2.44a.75.75 0 0 1-.75-.75Z"
              clipRule="evenodd"
            />
            <path d="M3.25 4a.75.75 0 0 0-.75.75v8a.75.75 0 0 0 .75.75h8a.75.75 0 0 0 .75-.75v-3.5a.75.75 0 0 1 1.5 0v3.5A2.25 2.25 0 0 1 11.25 15h-8A2.25 2.25 0 0 1 1 12.75v-8A2.25 2.25 0 0 1 3.25 2.5h3.5a.75.75 0 0 1 0 1.5h-3.5Z" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function PipelineTab() {
  const { items, pendingCount, loading, error, refresh } = usePipeline();

  const pending = items.filter((i) => !i.checked);
  const processed = items.filter((i) => i.checked);

  // Loading
  if (loading && items.length === 0) {
    return <Spinner />;
  }

  // Error
  if (error !== null && items.length === 0) {
    // File not found → show empty state with a helpful note
    if (error.includes('not_found') || error.includes('pipeline')) {
      return <EmptyState />;
    }
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-2 text-center max-w-sm">
          <span className="text-3xl">⚠️</span>
          <p className="text-red-600 dark:text-red-400 text-sm font-medium">
            Failed to load pipeline
          </p>
          <p className="text-gray-500 dark:text-gray-400 text-xs break-all">{error}</p>
        </div>
      </div>
    );
  }

  // Empty
  if (!loading && items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            Pipeline
          </h2>
          {pendingCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {pendingCount} pending
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40 transition-colors"
          title="Refresh pipeline"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Pending section */}
      {pending.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-xs font-bold tracking-widest uppercase text-gray-400 dark:text-gray-500">
              Pending
            </h3>
            <span className="text-xs tabular-nums text-gray-400 dark:text-gray-500">
              {pending.length} URL{pending.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {pending.map((item, idx) => (
              <UrlRow key={idx} line={item.line} checked={item.checked} />
            ))}
          </div>
        </section>
      )}

      {/* Processed section */}
      {processed.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-xs font-bold tracking-widest uppercase text-gray-400 dark:text-gray-500">
              Processed
            </h3>
            <span className="text-xs tabular-nums text-gray-400 dark:text-gray-500">
              {processed.length} URL{processed.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {processed.map((item, idx) => (
              <UrlRow key={idx} line={item.line} checked={item.checked} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
