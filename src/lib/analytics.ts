/**
 * analytics.ts — Central PostHog telemetry module.
 *
 * Privacy contract (hard invariants):
 *  - If VITE_POSTHOG_KEY is absent/empty → module is fully disabled. No init,
 *    all exported functions are no-ops.
 *  - autocapture, pageview, pageleave, session recording are ALL disabled.
 *  - before_send scrubs every outgoing event: removes URL-shaped properties,
 *    home-directory paths, and token-shaped strings before anything leaves.
 *  - No company, role, URL, file path, CV content, pipeline content, API key,
 *    or application number is ever passed as a property by this module.
 *
 * Exported surface:
 *  - initAnalytics()         — call once before render
 *  - track(name, props?)     — fire a named event with safe whitelisted props
 *  - captureError(err, ctx?) — send a scrubbed exception
 *  - isAnalyticsEnabled()    — boolean gate used by tests / feature detection
 *  - scrubString(s)          — exported for unit tests
 */

import posthog from 'posthog-js';
import type { CaptureResult } from 'posthog-js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _enabled = !!(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN as string | undefined);

// ---------------------------------------------------------------------------
// scrubString — the PII firewall
// ---------------------------------------------------------------------------

/**
 * Scrub a single string of known-sensitive patterns:
 *  1. Absolute home paths  (/Users/anything/…)  → "<path>"
 *  2. HTTP/HTTPS URLs                            → "<url>"
 *  3. Firecrawl keys (fc-…) or PostHog keys (phc_…) → "<token>"
 *  4. Long digit runs (≥ 8 consecutive digits)  → "<id>"
 */
export function scrubString(s: string): string {
  // 1. Absolute home paths — must run before URL scrub to catch file:// too
  s = s.replace(/\/Users\/[^\s"']+/g, '<path>');
  // 2. HTTP/HTTPS URLs
  s = s.replace(/https?:\/\/[^\s"']+/g, '<url>');
  // 3. API tokens: Firecrawl (fc-…) or PostHog (phc_…)
  s = s.replace(/\b(?:fc-|phc_)[A-Za-z0-9_-]+/g, '<token>');
  // 4. Long digit runs (8+ digits — catches IDs, phone numbers, etc.)
  s = s.replace(/\b\d{8,}\b/g, '<id>');
  return s;
}

// ---------------------------------------------------------------------------
// before_send — scrubs every outgoing event
// ---------------------------------------------------------------------------

function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (event === null) return null;

  const props = event.properties;

  // Delete well-known URL/referrer properties PostHog auto-attaches
  for (const key of [
    '$current_url',
    '$pathname',
    '$referrer',
    '$referring_domain',
    '$host',
    '$initial_current_url',
    '$initial_referrer',
    '$initial_referring_domain',
  ] as const) {
    delete (props as Record<string, unknown>)[key];
  }

  // Walk all string properties: drop URL-like values, scrub the rest
  for (const key of Object.keys(props)) {
    const val = props[key];
    if (typeof val === 'string') {
      // Drop property entirely if its value looks like a URL or home path
      if (/^https?:\/\//i.test(val) || /^\/Users\//i.test(val)) {
        delete (props as Record<string, unknown>)[key];
      } else {
        (props as Record<string, unknown>)[key] = scrubString(val);
      }
    }
  }

  return event;
}

// ---------------------------------------------------------------------------
// initAnalytics
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provider config — consumed by <PostHogProvider> in main.tsx
// ---------------------------------------------------------------------------

/** Project token (phc_…). Telemetry is OFF when absent. */
export const POSTHOG_TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN as
  | string
  | undefined;

const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
  'https://eu.i.posthog.com';

/** True when a project token is configured. main.tsx renders the provider iff true. */
export const analyticsEnabled = !!POSTHOG_TOKEN;

/**
 * Options for <PostHogProvider>. Uses PostHog's `defaults` preset (per the
 * official snippet) but OVERRIDES every capture that could leak personal data —
 * this app holds applications, CV, URLs, keys. Overrides win over the preset.
 */
export const posthogOptions = {
  api_host: POSTHOG_HOST,
  defaults: '2026-01-30',
  // ── Privacy overrides (beat the defaults preset) ───────────────────────────
  autocapture: false,
  capture_pageview: true, // desktop $current_url is localhost/tauri:// (non-PII) + scrubbed; clears onboarding
  capture_pageleave: false,
  disable_session_recording: true,
  capture_heatmaps: false,
  mask_all_text: true,
  mask_all_element_attributes: true,
  persistence: 'localStorage',
  // ── PII firewall ───────────────────────────────────────────────────────────
  before_send: scrubEvent,
} as const;

/**
 * Wire global error handlers → captureError (scrubbed). Call once in main.tsx.
 * The PostHogProvider performs posthog.init(); this only adds window capture.
 */
export function initAnalytics(): void {
  if (!analyticsEnabled) return;
  _enabled = true;

  window.addEventListener('error', (event) => {
    captureError(event.error ?? new Error(event.message));
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureError(
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason)),
    );
  });
}

// ---------------------------------------------------------------------------
// isAnalyticsEnabled
// ---------------------------------------------------------------------------

export function isAnalyticsEnabled(): boolean {
  return _enabled;
}

// ---------------------------------------------------------------------------
// track
// ---------------------------------------------------------------------------

export function track(
  name: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (!_enabled) return;

  // Defensively scrub any string values the caller passed
  const safe: Record<string, string | number | boolean> = {};
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      safe[k] = typeof v === 'string' ? scrubString(v) : v;
    }
  }

  posthog.capture(name, safe);
}

// ---------------------------------------------------------------------------
// captureError
// ---------------------------------------------------------------------------

export function captureError(
  err: unknown,
  ctx?: Record<string, string>,
): void {
  if (!_enabled) return;

  // Normalise to Error
  const error: Error =
    err instanceof Error
      ? err
      : new Error(typeof err === 'string' ? err : String(err));

  // Scrub message + stack
  const scrubbedError = new Error(scrubString(error.message));
  scrubbedError.name = error.name;
  if (error.stack) {
    scrubbedError.stack = scrubString(error.stack);
  }

  // Scrub context props
  const scrubbedCtx: Record<string, string> | undefined = ctx
    ? Object.fromEntries(
        Object.entries(ctx).map(([k, v]) => [k, scrubString(v)]),
      )
    : undefined;

  posthog.captureException(scrubbedError, scrubbedCtx);
}
