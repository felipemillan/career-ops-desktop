/**
 * App.tsx — Root shell. Phase 1: Applications tab only.
 * Sidebar navigation is Phase 2.
 * All IPC goes through ipc.ts — do NOT import invoke directly here.
 */
import "./App.css";
import { Applications } from "./tabs/Applications";

function App() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 flex items-center gap-3">
        <span className="text-lg font-semibold text-gray-900 dark:text-white">
          career-ops
        </span>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
          Applications
        </span>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-4">
        <Applications />
      </main>
    </div>
  );
}

export default App;
