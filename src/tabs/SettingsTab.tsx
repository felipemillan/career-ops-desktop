/**
 * SettingsTab.tsx — Settings page shown once the repo is configured.
 *
 * Sections:
 *   1. Repo folder — current root, valid/invalid badge, Change button + manual input.
 *   2. Eval model — reuses <ModelSelect />.
 *   3. Firecrawl — key count summary (manage via action bar's Firecrawl panel).
 *   4. Telemetry — read-only notice about PostHog build flag.
 *
 * IPC: getConfig, saveConfig, firecrawlStatus (via ipc.ts).
 * Dialog: open() from @tauri-apps/plugin-dialog — already installed.
 * No 'use client', no direct invoke calls.
 */
import { useState, useEffect, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getConfig, saveConfig, firecrawlStatus } from "../lib/ipc";
import { ModelSelect } from "../components/ModelSelect";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigSnapshot {
  root: string;
  root_valid: boolean;
  eval_model: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ValidBadge({ valid }: { valid: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        valid
          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
      ].join(" ")}
    >
      {valid ? "valid" : "not found"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SettingsTab
// ---------------------------------------------------------------------------

export function SettingsTab(): React.ReactElement {
  const [cfg, setCfg] = useState<ConfigSnapshot | null>(null);
  const [fcKeys, setFcKeys] = useState<number | null>(null);
  const [manualPath, setManualPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await getConfig();
      setCfg({ root: res.root, root_valid: res.root_valid, eval_model: res.eval_model });
      setManualPath(res.root);
    } catch {
      // Non-fatal — will surface when user tries to save
    }
  }, []);

  const loadFirecrawl = useCallback(async () => {
    try {
      const res = await firecrawlStatus();
      setFcKeys(res.status.keys);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadFirecrawl();
  }, [loadConfig, loadFirecrawl]);

  async function applyPath(path: string): Promise<void> {
    const trimmed = path.trim();
    if (!trimmed) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await saveConfig(trimmed);
      const res = await getConfig();
      setCfg({ root: res.root, root_valid: res.root_valid, eval_model: res.eval_model });
      setManualPath(res.root);
      if (res.root_valid) {
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 2000);
      } else {
        setSaveError(
          "No applications.md found in that folder — pick your career-ops repo root.",
        );
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleChooseFolder(): Promise<void> {
    let dir: string | null = null;
    try {
      dir = (await open({
        directory: true,
        multiple: false,
        title: "Select your career-ops folder",
      })) as string | null;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!dir) return;
    await applyPath(dir);
  }

  async function handleManualSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await applyPath(manualPath);
  }

  return (
    <div className="max-w-xl mx-auto py-8 flex flex-col gap-8">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h1>

      {/* ------------------------------------------------------------------ */}
      {/* Repo folder                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 pb-1">
          Repo folder
        </h2>

        {cfg ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all">
                {cfg.root || <span className="text-gray-400 italic">not set</span>}
              </span>
              <ValidBadge valid={cfg.root_valid} />
            </div>

            <form onSubmit={(e) => void handleManualSubmit(e)} className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualPath}
                  onChange={(e) => {
                    setManualPath(e.target.value);
                    setSaveError(null);
                  }}
                  placeholder="/Users/you/career-ops"
                  disabled={saving}
                  className={[
                    "flex-1 rounded-lg border px-3 py-2 text-sm font-mono",
                    "bg-white dark:bg-gray-900",
                    saveError
                      ? "border-red-400 dark:border-red-500"
                      : "border-gray-300 dark:border-gray-600",
                    "text-gray-800 dark:text-gray-100",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500",
                    "disabled:opacity-50",
                  ].join(" ")}
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleChooseFolder()}
                  className={[
                    "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                >
                  {saving ? "Checking…" : "Change…"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving || !manualPath.trim()}
                  className={[
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    "border border-gray-300 dark:border-gray-600",
                    "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200",
                    "hover:bg-gray-100 dark:hover:bg-gray-700",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                >
                  {saving ? "Saving…" : "Use this path"}
                </button>
                {saveOk && (
                  <span className="text-xs text-green-600 dark:text-green-400">Saved.</span>
                )}
                {saveError && (
                  <span className="text-xs text-red-500 dark:text-red-400">{saveError}</span>
                )}
              </div>
            </form>
          </>
        ) : (
          <p className="text-sm text-gray-400">Loading…</p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Eval model                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 pb-1">
          Eval model
        </h2>
        <div className="flex items-center gap-2">
          <ModelSelect />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Used for offer evaluation and pipeline processing.
          </span>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Firecrawl                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 pb-1">
          Firecrawl
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {fcKeys === null
            ? "Loading…"
            : fcKeys === 0
              ? "No API keys configured."
              : `${fcKeys} API key${fcKeys === 1 ? "" : "s"} configured.`}{" "}
          Manage keys via the <strong>Firecrawl</strong> button in the action bar.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Telemetry                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 pb-1">
          Telemetry
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          PostHog telemetry is{" "}
          {import.meta.env.VITE_POSTHOG_KEY ? (
            <strong>enabled</strong>
          ) : (
            <strong>disabled</strong>
          )}{" "}
          in this build. Only anonymous usage events are tracked (tab views,
          action runs). No personal data, CV content, or job details are sent.
        </p>
      </section>
    </div>
  );
}
