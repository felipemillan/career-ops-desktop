/**
 * ApplicationsKanban.test.ts
 *
 * Unit tests for the pure `shouldWriteStatus` helper extracted from
 * ApplicationsKanban.tsx. No React, no DOM — just logic.
 */
import { describe, it, expect } from 'vitest';
import { shouldWriteStatus, CANONICAL_STATUSES } from './ApplicationsKanban';

describe('shouldWriteStatus()', () => {
  it('returns false when target column === current status (no-op drop)', () => {
    for (const s of CANONICAL_STATUSES) {
      expect(shouldWriteStatus(s, s)).toBe(false);
    }
  });

  it('returns true when target is a different canonical status', () => {
    expect(shouldWriteStatus('Evaluated', 'Applied')).toBe(true);
    expect(shouldWriteStatus('Applied', 'Interview')).toBe(true);
    expect(shouldWriteStatus('Interview', 'Offer')).toBe(true);
    expect(shouldWriteStatus('Offer', 'Rejected')).toBe(true);
    expect(shouldWriteStatus('Responded', 'Discarded')).toBe(true);
    expect(shouldWriteStatus('SKIP', 'Evaluated')).toBe(true);
  });

  it('returns false when targetColumnId is not one of the 8 canonical statuses', () => {
    expect(shouldWriteStatus('Evaluated', 'UnknownColumn')).toBe(false);
    expect(shouldWriteStatus('Applied', '')).toBe(false);
    expect(shouldWriteStatus('Interview', 'draft')).toBe(false);
  });

  it('covers all 8 → 8 cross-column moves (returns true for every cross-status pair)', () => {
    for (const from of CANONICAL_STATUSES) {
      for (const to of CANONICAL_STATUSES) {
        if (from === to) {
          expect(shouldWriteStatus(from, to)).toBe(false);
        } else {
          expect(shouldWriteStatus(from, to)).toBe(true);
        }
      }
    }
  });
});
