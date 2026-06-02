/**
 * LegitimacyBadge — colored badge for posting legitimacy tier.
 * Port of dashboard-web/src/features/reports/components/legitimacy-badge.tsx.
 * No 'use client', no Next.js imports.
 */

type LegitimacyBadgeProps = {
  value?: string | null;
  className?: string;
};

type Tone = "good" | "warn" | "bad" | "neutral";

/** Verbatim port of the tone() function from the Next.js dashboard. */
function tone(value: string): Tone {
  const v = value.toLowerCase();
  if (v.includes("verified") || v.includes("high confidence") || v.includes("active"))
    return "good";
  if (v.includes("low confidence") || v.includes("suspect") || v.includes("reposted"))
    return "warn";
  if (v.includes("closed") || v.includes("dead") || v.includes("expired"))
    return "bad";
  return "neutral";
}

const TONE_CLASSES: Record<Tone, string> = {
  good:
    "border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn:
    "border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad:
    "border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  neutral:
    "border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
};

export function LegitimacyBadge({ value, className }: LegitimacyBadgeProps) {
  if (!value) return null;
  const t = tone(value);
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[t],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {value}
    </span>
  );
}
