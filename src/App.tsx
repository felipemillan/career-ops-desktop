/**
 * App.tsx — Root shell: sidebar nav + tab host. Owned by the shell. Agents: do NOT edit.
 * Inactive tabs stay mounted with `hidden` to preserve scroll/state.
 * All IPC goes through ipc.ts — never import invoke here.
 */
import { useEffect, useState } from "react";
import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { TABS, type TabId } from "./lib/tabs";
import { Applications } from "./tabs/Applications";
import { PipelineTab } from "./tabs/PipelineTab";
import { ReportsTab } from "./tabs/ReportsTab";
import { ScanTab } from "./tabs/ScanTab";
import { AnalyticsTab } from "./tabs/AnalyticsTab";

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
              {panes[id]}
            </div>
          ) : null,
        )}
      </main>
    </div>
  );
}

export default App;
