/**
 * ModelSelect.tsx — Small dropdown for selecting the eval model.
 *
 * On mount, reads the current model via getConfig() (.eval_model).
 * On change, calls setEvalModel() and shows a brief "saved" tick on success.
 * If the stored value isn't in the known list, it appears as a custom entry.
 *
 * Calls ipc.ts wrappers only (never invoke directly).
 */

import { useState, useEffect, useRef } from 'react';
import { getConfig, setEvalModel } from '../lib/ipc';

// ---------------------------------------------------------------------------
// Model options
// ---------------------------------------------------------------------------

type ModelOption = { label: string; value: string };

const MODEL_OPTIONS: ModelOption[] = [
  { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6' },
  { label: 'Opus 4.8',   value: 'claude-opus-4-8' },
  { label: 'Haiku 4.5',  value: 'claude-haiku-4-5' },
];

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// ModelSelect
// ---------------------------------------------------------------------------

export function ModelSelect(): React.ReactElement {
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read current model from config on mount
  useEffect(() => {
    getConfig()
      .then((res) => {
        if (res.eval_model) {
          setModel(res.eval_model);
        }
      })
      .catch(() => {
        // Config not reachable yet — stay with default, non-fatal
      });
    return () => {
      if (savedTimer.current !== null) {
        clearTimeout(savedTimer.current);
      }
    };
  }, []);

  async function handleChange(value: string): Promise<void> {
    setModel(value);
    setSaved(false);
    try {
      await setEvalModel(value);
      setSaved(true);
      if (savedTimer.current !== null) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1800);
    } catch {
      // Error surfaces in console; the local state already reflects the selection
    }
  }

  // Determine whether the stored value is a custom (unlisted) model
  const isCustom = !MODEL_OPTIONS.some((o) => o.value === model);

  return (
    <div className="flex items-center gap-1">
      <label
        className="text-[10px] text-gray-500 dark:text-gray-400 select-none"
        htmlFor="model-select"
      >
        Model
      </label>
      <div className="relative">
        <select
          id="model-select"
          value={model}
          onChange={(e) => void handleChange(e.target.value)}
          className={[
            'text-xs py-1 pl-1.5 pr-5 rounded border appearance-none cursor-pointer',
            'bg-white dark:bg-gray-800',
            'text-gray-700 dark:text-gray-200',
            'border-gray-300 dark:border-gray-600',
            'focus:outline-none focus:ring-1 focus:ring-blue-400',
          ].join(' ')}
        >
          {isCustom && (
            <option value={model}>{model}</option>
          )}
          {MODEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {/* Chevron icon */}
        <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-gray-400 dark:text-gray-500">
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </div>
      {/* Saved tick */}
      {saved && (
        <svg
          className="h-3.5 w-3.5 text-green-500 dark:text-green-400 shrink-0"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-label="Saved"
        >
          <path
            fillRule="evenodd"
            d="M16.707 4.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 11.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </div>
  );
}
