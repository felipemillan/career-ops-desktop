/**
 * App.tsx — Root shell: sidebar nav + tab host. Owned by the shell.
 * Inactive tabs stay mounted with `hidden` to preserve scroll/state.
 * All IPC goes through ipc.ts — never import invoke here.
 *
 * Phase 3 (P3-T5): ActionBar (global Lane-A toolbar) + ConsolePanel (bottom drawer).
 * Phase 6: Onboarding gate (root_valid check) + Settings tab.
 */
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ActionBar } from "./components/ActionBar";
import { ConsolePanel } from "./components/ConsolePanel";
import { Onboarding } from "./components/Onboarding";
import { TABS, type TabId } from "./lib/tabs";
import { Applications } from "./tabs/Applications";
import { getConfig } from "./lib/ipc";
import { track } from "./lib/analytics";

// Secondary tabs are lazy: their heavy deps (dnd-kit, react-markdown, charts)
// load only when the tab is first opened — keeps launch lean and isolates
// any per-tab load failure to that tab.
const PipelineTab = lazy(() =>
  import("./tabs/PipelineTab").then((m) => ({ default: m.PipelineTab })),
);
const ReportsTab = lazy(() =>
  import("./tabs/ReportsTab").then((m) => ({ default: m.ReportsTab })),
);
const ScanTab = lazy(() =>
  import("./tabs/ScanTab").then((m) => ({ default: m.ScanTab })),
);
const AnalyticsTab = lazy(() =>
  import("./tabs/AnalyticsTab").then((m) => ({ default: m.AnalyticsTab })),
);
const TerminalTab = lazy(() =>
  import("./tabs/TerminalTab").then((m) => ({ default: m.TerminalTab })),
);
const SettingsTab = lazy(() =>
  import("./tabs/SettingsTab").then((m) => ({ default: m.SettingsTab })),
);

function App() {
  const [active, setActive] = useState<TabId>("applications");
  // Track which tabs have been activated, so we mount lazily then keep them alive.
  const [seen, setSeen] = useState<Set<TabId>>(new Set(["applications"]));

  // Console drawer: null = closed, string = focus job_id (open)
  const [consoleJobId, setConsoleJobId] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);

  // Onboarding gate: null = checking, true = configured, false = not configured
  const [configured, setConfigured] = useState<boolean | null>(null);

  // On mount, check whether the repo is valid
  useEffect(() => {
    getConfig()
      .then((res) => {
        setConfigured(res.root_valid);
      })
      .catch(() => {
        // Backend unavailable — treat as not configured so onboarding shows
        setConfigured(false);
      });
  }, []);

  const handleJobStarted = useCallback((jobId: string) => {
    setConsoleJobId(jobId);
    setConsoleOpen(true);
  }, []);

  const handleConsoleClose = useCallback(() => {
    setConsoleOpen(false);
    setConsoleJobId(null);
  }, []);

  const select = (id: TabId) => {
    setActive(id);
    setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    track('tab_viewed', { tab: id });
  };

  // Cmd+1..7 shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const tab = TABS.find((t) => t.shortcut === e.key && !t.disabled);
      if (tab) {
        e.preventDefault();
        select(tab.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Loading splash ---
  if (configured === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <span className="text-sm text-gray-400 dark:text-gray-500">Loading…</span>
      </div>
    );
  }

  // --- Onboarding gate ---
  if (!configured) {
    return <Onboarding onConfigured={() => setConfigured(true)} />;
  }

  const panes: Record<TabId, React.ReactNode> = {
    applications: <Applications />,
    pipeline: <PipelineTab />,
    reports: <ReportsTab />,
    scan: <ScanTab />,
    analytics: <AnalyticsTab />,
    terminal: <TerminalTab />,
    settings: <SettingsTab />,
  };

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Sidebar active={active} onSelect={select} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Lane-A action toolbar — visible across all tabs */}
        <ActionBar onJobStarted={handleJobStarted} />

        {/* Tab content */}
        <main className="flex-1 overflow-auto">
          {(Object.keys(panes) as Array<keyof typeof panes>).map((id) =>
            seen.has(id) ? (
              <div key={id} className={id === active ? "p-4" : "hidden"}>
                <ErrorBoundary label={id}>
                  <Suspense
                    fallback={
                      <div className="p-8 text-sm text-gray-400">Loading {id}…</div>
                    }
                  >
                    {panes[id]}
                  </Suspense>
                </ErrorBoundary>
              </div>
            ) : null,
          )}
        </main>

        {/* Streaming console drawer — collapsed by default, expands when a job starts */}
        {consoleOpen && (
          <ConsolePanel
            focusJobId={consoleJobId}
            onClose={handleConsoleClose}
          />
        )}
      </div>
    </div>
  );
}

export default App;
