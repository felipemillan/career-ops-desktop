/**
 * App.tsx — Root shell: sidebar nav + tab host. Owned by the shell. Agents: do NOT edit.
 * Inactive tabs stay mounted with `hidden` to preserve scroll/state.
 * All IPC goes through ipc.ts — never import invoke here.
 */
import { Suspense, lazy, useEffect, useState } from "react";
import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TABS, type TabId } from "./lib/tabs";
import { Applications } from "./tabs/Applications";

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

function App() {
  const [active, setActive] = useState<TabId>("applications");
  // Track which tabs have been activated, so we mount lazily then keep them alive.
  const [seen, setSeen] = useState<Set<TabId>>(new Set(["applications"]));

  const select = (id: TabId) => {
    setActive(id);
    setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  // Cmd+1..5 shortcuts
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

  const panes: Record<Exclude<TabId, "terminal">, React.ReactNode> = {
    applications: <Applications />,
    pipeline: <PipelineTab />,
    reports: <ReportsTab />,
    scan: <ScanTab />,
    analytics: <AnalyticsTab />,
  };

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Sidebar active={active} onSelect={select} />
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
    </div>
  );
}

export default App;
