/**
 * Sidebar — primary nav. Owned by the shell. Agents: do NOT edit.
 */
import { TABS, type TabId } from "../lib/tabs";

interface SidebarProps {
  active: TabId;
  onSelect: (id: TabId) => void;
}

export function Sidebar({ active, onSelect }: SidebarProps) {
  return (
    <nav className="w-52 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col">
      <div className="px-4 py-4 flex items-center gap-2">
        <span className="text-base font-semibold text-gray-900 dark:text-white">
          career-ops
        </span>
      </div>
      <ul className="flex-1 px-2 space-y-0.5">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id}>
              <button
                type="button"
                disabled={tab.disabled}
                onClick={() => !tab.disabled && onSelect(tab.id)}
                className={[
                  "w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between",
                  tab.disabled
                    ? "text-gray-400 dark:text-gray-600 cursor-not-allowed"
                    : isActive
                      ? "bg-blue-600 text-white"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
                ].join(" ")}
              >
                <span>{tab.label}</span>
                {tab.disabled ? (
                  <span className="text-[10px] uppercase tracking-wide">soon</span>
                ) : tab.shortcut ? (
                  <span
                    className={[
                      "text-[10px] font-mono",
                      isActive ? "text-blue-100" : "text-gray-400",
                    ].join(" ")}
                  >
                    ⌘{tab.shortcut}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
