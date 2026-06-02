/**
 * ScoreBreakdownChart — pure CSS bar chart for per-block scores (A–F).
 * No chart library. Regex: /\*\*(Block [A-F]).*?(\d+\.?\d*)\/5/gm over markdown.
 * Falls back to the parseScoreBlocks from the Next.js parser (ported inline).
 * No 'use client', no Next.js imports.
 */

type ScoreBlock = {
  key: string;
  label: string;
  score: number;
};

// ---------------------------------------------------------------------------
// Parser (adapted from dashboard-web parse-score-blocks.ts)
// ---------------------------------------------------------------------------

const BLOCK_LABELS: Record<string, string> = {
  A: "Targeting",
  B: "CV Match",
  C: "Level / Strategy",
  D: "Comp & Market",
  E: "Personalization",
  F: "Cultural / Interview",
};

const SCORED_BLOCK_KEYS = ["A", "B", "C", "D", "E", "F"] as const;

const HEADING_RE =
  /^#{2,3}\s+(?:Block\s+([A-G])\s*[—\-:]\s*([^\n]+)|([A-G])\)\s*([^\n]+)|([A-G])\s+[—\-]\s+([^\n]+))\s*$/gim;

const SCORE_RES = [
  /\*{0,2}Score[:\s]*\*{0,2}\s*([0-5](?:\.\d+)?|\d+(?:\.\d+)?)\s*\/\s*5/i,
  /^\s*\*{1,2}([0-5](?:\.\d+)?|\d+(?:\.\d+)?)\s*\/\s*5\*{1,2}/m,
];

function clamp05(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(5, Math.max(0, n));
}

function firstScoreIn(section: string): number | null {
  for (const re of SCORE_RES) {
    const m = section.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      if (!Number.isNaN(v)) return clamp05(v);
    }
  }
  return null;
}

function cleanHeadingLabel(raw: string): string {
  return raw.replace(/^[—\-:]\s*/, "").trim();
}

const DIMENSION_KEY_MAP: [RegExp, string][] = [
  [/^north\s+star$/i, "A"],
  [/^match\s+(cv|con\s+cv)$/i, "B"],
  [/^comp(ensaci[oó]n)?(\s+y\s+demanda)?$/i, "C"],
  [/^cultural(\s+signals?)?$/i, "D"],
];

function keyForDimension(raw: string): string | null {
  const clean = raw.replace(/\*+/g, "").trim();
  for (const [re, key] of DIMENSION_KEY_MAP) {
    if (re.test(clean)) return key;
  }
  return null;
}

function parseScoreBreakdownTable(markdown: string): ScoreBlock[] {
  const headingRe = /^#{2,3}\s+Score\s+Breakdown\s*$/im;
  const hm = headingRe.exec(markdown);
  if (!hm) return [];

  const after = markdown.slice(hm.index + hm[0].length);
  const results: ScoreBlock[] = [];
  const rowRe = /^\|([^|\n]+)\|([^|\n]+)\|/gm;
  let row: RegExpExecArray | null;

  while ((row = rowRe.exec(after))) {
    const rawDim = row[1].trim();
    const rawScore = row[2].trim().replace(/\*+/g, "").trim();

    if (/^dimension$/i.test(rawDim) || /^[-:\s]+$/.test(rawDim)) continue;
    if (/^global$/i.test(rawDim.replace(/\*+/g, "").trim())) continue;
    if (/red\s*flag/i.test(rawDim)) continue;

    const key = keyForDimension(rawDim);
    if (!key) continue;

    const scoreMatch = rawScore.match(/^([0-5](?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:\/\s*5)?$/);
    if (!scoreMatch) continue;
    const score = parseFloat(scoreMatch[1]);
    if (isNaN(score) || score < 0) continue;

    const label = rawDim.replace(/\*+/g, "").trim();
    results.push({ key, label, score: clamp05(score) });
  }

  const ORDER = ["A", "B", "C", "D", "E", "F"];
  return results.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}

function parseScoreBlocks(markdown: string): ScoreBlock[] {
  if (!markdown) return [];

  const matches: { key: string; label: string; start: number; end: number }[] =
    [];
  let m: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(markdown))) {
    const key = (m[1] ?? m[3] ?? m[5]).toUpperCase();
    const label = (m[2] ?? m[4] ?? m[6]).trim();
    matches.push({ key, label, start: m.index, end: m.index + m[0].length });
  }

  const found = new Map<string, ScoreBlock>();
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    if (cur.key === "G") continue;
    const nextStart =
      i + 1 < matches.length ? matches[i + 1].start : markdown.length;
    const section = markdown.slice(cur.end, nextStart);
    const score = firstScoreIn(section);
    if (score === null) continue;
    found.set(cur.key, {
      key: cur.key,
      label:
        cleanHeadingLabel(cur.label) || BLOCK_LABELS[cur.key] || cur.key,
      score,
    });
  }

  const result = SCORED_BLOCK_KEYS.map((k) => found.get(k)).filter(
    (b): b is ScoreBlock => Boolean(b)
  );

  if (result.length === 0) return parseScoreBreakdownTable(markdown);

  return result;
}

// ---------------------------------------------------------------------------
// Color helper (inline, no external dep)
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 4.5) return "#22c55e"; // emerald-500
  if (score >= 4.0) return "#4ade80"; // emerald-400
  if (score >= 3.5) return "#84cc16"; // lime-500
  if (score >= 3.0) return "#eab308"; // yellow-500
  if (score >= 2.0) return "#f97316"; // orange-500
  return "#ef4444"; // red-500
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScoreBreakdownChart({ markdown }: { markdown: string }) {
  const blocks = parseScoreBlocks(markdown);

  if (blocks.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6">
        <div className="flex flex-col items-center gap-3 py-8 text-center text-gray-400 dark:text-gray-500">
          <svg
            className="size-8 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
            />
          </svg>
          <p className="text-sm">No score breakdown found in this report.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Score Breakdown
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Scored 0–5 per dimension
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {blocks.map((block) => {
          const pct = (block.score / 5) * 100;
          const color = scoreColor(block.score);
          return (
            <div key={block.key} className="flex items-center gap-3">
              {/* Label */}
              <div className="w-36 shrink-0 text-right">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate block">
                  {block.key}. {block.label}
                </span>
              </div>
              {/* Bar track */}
              <div className="flex-1 h-5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: color,
                    opacity: 0.85,
                  }}
                />
              </div>
              {/* Score label */}
              <div className="w-10 shrink-0 text-left">
                <span
                  className="text-xs font-semibold tabular-nums"
                  style={{ color }}
                >
                  {block.score.toFixed(1)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {/* X-axis hint */}
      <div className="mt-3 flex justify-between text-[10px] text-gray-400 dark:text-gray-600 pl-[9.5rem]">
        <span>0</span>
        <span>1</span>
        <span>2</span>
        <span>3</span>
        <span>4</span>
        <span>5</span>
      </div>
    </div>
  );
}
