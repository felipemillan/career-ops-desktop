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

let _enabled = false;

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

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
    'https://eu.i.posthog.com';

  if (!key) {
    // No key → stay disabled, all calls are no-ops
    return;
  }

  posthog.init(key, {
    api_host: host,
    // ── Privacy guards ─────────────────────────────────────────────────────
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    // ── Storage ─────────────────────────────────────────────────────────────
    persistence: 'localStorage',
    // ── PII firewall ─────────────────────────────────────────────────────
    before_send: scrubEvent,
  });

  _enabled = true;

  // Register global error handlers → captureError (scrubbed)
  window.addEventListener('error', (event) => {
    captureError(event.error ?? new Error(event.message));
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureError(event.reason instanceof Error
      ? event.reason
      : new Error(String(event.reason)));
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
