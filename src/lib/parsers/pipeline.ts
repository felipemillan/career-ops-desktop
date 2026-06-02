import type { PipelineItem } from "../types";

const PENDING_ITEM_RE = /^\s*- \[ \]/;
const ANY_ITEM_RE = /^\s*- \[[ x]\]/;

export function parsePipeline(content: string): PipelineItem[] {
  if (!content) return [];
  const out: PipelineItem[] = [];
  for (const line of content.split("\n")) {
    if (!ANY_ITEM_RE.test(line)) continue;
    const checked = !PENDING_ITEM_RE.test(line);
    out.push({ checked, line: line.trim() });
  }
  return out;
}

export function countPending(content: string): number {
  if (!content) return 0;
  return content.split("\n").filter((l) => PENDING_ITEM_RE.test(l)).length;
}
