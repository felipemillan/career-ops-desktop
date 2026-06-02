/**
 * Tab registry — single source of truth for the sidebar nav + keyboard shortcuts.
 * Owned by the shell. Tab components live in src/tabs/*.
 */
export type TabId =
  | "applications"
  | "pipeline"
  | "reports"
  | "scan"
  | "analytics"
  | "terminal";

export interface TabDef {
  id: TabId;
  label: string;
  /** Cmd+<key> shortcut digit; undefined = no shortcut (e.g. disabled tabs). */
  shortcut?: string;
  /** Disabled tabs render in the nav but cannot be activated (Phase gating). */
  disabled?: boolean;
}

export const TABS: TabDef[] = [
  { id: "applications", label: "Applications", shortcut: "1" },
  { id: "pipeline", label: "Pipeline", shortcut: "2" },
  { id: "reports", label: "Reports", shortcut: "3" },
  { id: "scan", label: "Scan History", shortcut: "4" },
  { id: "analytics", label: "Analytics", shortcut: "5" },
  { id: "terminal", label: "Terminal", shortcut: "6" },
];
