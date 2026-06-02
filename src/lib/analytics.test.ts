/**
 * analytics.test.ts — Unit tests for scrubString() and the analytics module.
 *
 * We do NOT test posthog.init/capture (external SDK — tested in integration).
 * We DO test the scrubbing logic exhaustively, since that's the PII firewall.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scrubString, isAnalyticsEnabled, track, captureError } from './analytics';

// ---------------------------------------------------------------------------
// scrubString — PII firewall tests
// ---------------------------------------------------------------------------

describe('scrubString()', () => {
  describe('home path scrubbing', () => {
    it('replaces an absolute macOS home path with <path>', () => {
      const input = '/Users/admin/Github/career-ops-desktop/data/applications.md';
      // The entire /Users/… path is replaced — no leakage of any path component
      expect(scrubString(input)).toBe('<path>');
    });

    it('replaces a home path mid-sentence and preserves surrounding text', () => {
      const input = 'Error reading file /Users/bob/projects/career-ops/cv.md: not found';
      const result = scrubString(input);
      expect(result).not.toContain('/Users/bob');
      expect(result).toContain('<path>');
      expect(result).toContain('Error reading file');
      expect(result).toContain('not found');
    });

    it('leaves strings without home paths unchanged', () => {
      expect(scrubString('Scan completed successfully')).toBe('Scan completed successfully');
    });

    it('handles multiple home paths in one string', () => {
      const input = 'from /Users/alice/src to /Users/alice/dst';
      const result = scrubString(input);
      expect(result).not.toContain('/Users/alice');
      expect(result).toContain('<path>');
    });
  });

  describe('URL scrubbing', () => {
    it('replaces https URLs', () => {
      const input = 'fetched https://greenhouse.io/jobs/12345?t=abc';
      expect(scrubString(input)).toBe('fetched <url>');
    });

    it('replaces http URLs', () => {
      expect(scrubString('see http://example.com/path')).toBe('see <url>');
    });

    it('leaves plain strings without URLs unchanged', () => {
      expect(scrubString('job evaluation complete')).toBe('job evaluation complete');
    });

    it('handles multiple URLs in one string', () => {
      const input = 'primary https://a.com secondary https://b.com';
      expect(scrubString(input)).toBe('primary <url> secondary <url>');
    });
  });

  describe('token scrubbing', () => {
    it('replaces a phc_ PostHog key', () => {
      const input = 'key=phc_xChZVNUH79UNt98MpJNQ74zs3NdmmB7uFJ7mTCF2uL5X';
      expect(scrubString(input)).toBe('key=<token>');
    });

    it('replaces a fc- Firecrawl key', () => {
      const input = 'Firecrawl key fc-abc123XYZ used';
      expect(scrubString(input)).toBe('Firecrawl key <token> used');
    });

    it('replaces multiple tokens', () => {
      const input = 'phc_AAA and fc-BBBccc together';
      expect(scrubString(input)).toBe('<token> and <token> together');
    });

    it('leaves normal words with dashes intact', () => {
      expect(scrubString('dry-run complete')).toBe('dry-run complete');
    });
  });

  describe('long digit run scrubbing', () => {
    it('replaces sequences of 8+ digits', () => {
      expect(scrubString('app number 12345678')).toBe('app number <id>');
    });

    it('preserves short digit sequences (< 8 digits)', () => {
      expect(scrubString('score 4.2 for app #042')).toBe('score 4.2 for app #042');
    });

    it('replaces a 10-digit phone-like number', () => {
      expect(scrubString('call 5551234567 now')).toBe('call <id> now');
    });
  });

  describe('combined patterns', () => {
    it('scrubs a stack trace containing a home path and a URL', () => {
      const input = [
        'Error: invoke failed',
        '    at /Users/admin/Github/career-ops-desktop/src/lib/ipc.ts:100:5',
        '    caused by https://eu.posthog.com/api/error',
      ].join('\n');
      const result = scrubString(input);
      expect(result).not.toContain('/Users/admin');
      expect(result).not.toContain('https://');
      expect(result).toContain('<path>');
      expect(result).toContain('<url>');
    });

    it('leaves a safe label like "Scan" completely unchanged', () => {
      expect(scrubString('Scan')).toBe('Scan');
    });

    it('leaves status strings unchanged', () => {
      for (const s of ['Evaluated', 'Applied', 'Interview', 'Offer', 'Rejected', 'SKIP']) {
        expect(scrubString(s)).toBe(s);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Module-level behaviour when analytics is disabled (no key injected)
// ---------------------------------------------------------------------------

describe('analytics module — disabled state (no VITE_POSTHOG_KEY)', () => {
  beforeEach(() => {
    // import.meta.env.VITE_POSTHOG_KEY is undefined in test env
    vi.resetModules();
  });

  it('isAnalyticsEnabled() reflects token presence', () => {
    // Gating is token-based now; assert the relationship (env-agnostic).
    expect(isAnalyticsEnabled()).toBe(
      !!import.meta.env.VITE_POSTHOG_PROJECT_TOKEN,
    );
  });

  it('track() is a no-op and does not throw', () => {
    expect(() => track('tab_viewed', { tab: 'applications' })).not.toThrow();
  });

  it('captureError() is a no-op and does not throw', () => {
    expect(() => captureError(new Error('test error'))).not.toThrow();
  });

  it('captureError() is a no-op with a string error', () => {
    expect(() => captureError('something went wrong')).not.toThrow();
  });

  it('captureError() is a no-op with a context arg', () => {
    expect(() =>
      captureError(new Error('cmd failed'), { cmd: 'run_scan' }),
    ).not.toThrow();
  });
});
