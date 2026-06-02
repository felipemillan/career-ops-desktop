/**
 * RepoPicker.tsx — Shown when the repo path is not configured.
 * Lets the user enter a path and persist it via saveConfig().
 * Does NOT import invoke or node:fs directly — all IPC through ipc.ts.
 */
import { useState } from "react";
import { saveConfig } from "../lib/ipc";
import { fetchApplications } from "../lib/store";

interface RepoPickerProps {
  onConfigured?: () => void;
}

export function RepoPicker({ onConfigured }: RepoPickerProps) {
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await saveConfig(trimmed);
      // Trigger a fresh fetch now that the repo is configured
      await fetchApplications();
      onConfigured?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 px-4">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
          Set your career-ops repo path
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Enter the absolute path to your local career-ops repository so the
          app can read your applications, reports, and config.
        </p>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-3 w-full max-w-md">
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/you/career-ops"
          disabled={saving}
          className={[
            "rounded-lg border px-3 py-2 text-sm font-mono",
            "bg-white dark:bg-gray-900",
            "border-gray-300 dark:border-gray-600",
            "text-gray-800 dark:text-gray-100",
            "focus:outline-none focus:ring-2 focus:ring-blue-500",
            "disabled:opacity-50",
          ].join(" ")}
        />
        {error && (
          <p className="text-red-500 text-xs">{error}</p>
        )}
        <button
          type="submit"
          disabled={saving || !path.trim()}
          className={[
            "rounded-lg px-4 py-2 text-sm font-semibold",
            "bg-blue-600 hover:bg-blue-700 active:bg-blue-800",
            "text-white",
            "transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Save & connect"}
        </button>
      </form>
    </div>
  );
}
