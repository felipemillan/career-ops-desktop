/**
 * Onboarding.tsx — Full-window first-run screen shown when no valid career-ops
 * repo is configured (root_valid is false). Guides the user to pick the folder.
 *
 * Props:
 *   onConfigured — called once the backend confirms root_valid = true.
 *
 * IPC: saveConfig (ipc.ts) + getConfig (ipc.ts).
 * Dialog: open() from @tauri-apps/plugin-dialog — already installed.
 * No 'use client', no direct invoke calls.
 */
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { saveConfig, getConfig } from "../lib/ipc";

interface OnboardingProps {
  onConfigured: () => void;
}

export function Onboarding({ onConfigured }: OnboardingProps) {
  const [manualPath, setManualPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function applyPath(path: string): Promise<void> {
    const trimmed = path.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      await saveConfig(trimmed);
      const cfg = await getConfig();
      if (cfg.root_valid) {
        onConfigured();
      } else {
        setError(
          "No applications.md found in that folder — pick your career-ops repo root.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleChooseFolder(): Promise<void> {
    let dir: string | null = null;
    try {
      // open() returns string | null (user cancelled = null)
      dir = (await open({
        directory: true,
        multiple: false,
        title: "Select your career-ops folder",
      })) as string | null;
    } catch (err) {
      // Dialog failure (e.g. permissions) — fall back gracefully
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!dir) return; // user cancelled
    await applyPath(dir);
  }

  async function handleManualSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await applyPath(manualPath);
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 px-6">
      <div className="w-full max-w-md flex flex-col gap-8">
        {/* Header */}
        <div className="text-center flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">career-ops</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
            Point me at your career-ops folder and I'll load your applications,
            reports, and pipeline automatically.
          </p>
        </div>

        {/* Primary action: folder picker */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleChooseFolder()}
            className={[
              "w-full rounded-lg py-2.5 px-4 text-sm font-semibold transition-colors",
              "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            ].join(" ")}
          >
            {loading ? "Checking…" : "Choose folder…"}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-600">
            <span className="flex-1 border-t border-gray-200 dark:border-gray-800" />
            or paste path manually
            <span className="flex-1 border-t border-gray-200 dark:border-gray-800" />
          </div>

          {/* Manual path fallback */}
          <form onSubmit={(e) => void handleManualSubmit(e)} className="flex flex-col gap-2">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => {
                setManualPath(e.target.value);
                setError(null);
              }}
              placeholder="/Users/you/career-ops"
              disabled={loading}
              className={[
                "rounded-lg border px-3 py-2 text-sm font-mono",
                "bg-white dark:bg-gray-900",
                error
                  ? "border-red-400 dark:border-red-500"
                  : "border-gray-300 dark:border-gray-600",
                "text-gray-800 dark:text-gray-100",
                "focus:outline-none focus:ring-2 focus:ring-blue-500",
                "disabled:opacity-50",
              ].join(" ")}
            />
            {error && (
              <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !manualPath.trim()}
              className={[
                "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                "border border-gray-300 dark:border-gray-600",
                "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200",
                "hover:bg-gray-100 dark:hover:bg-gray-700",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              ].join(" ")}
            >
              {loading ? "Checking…" : "Use this path"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
