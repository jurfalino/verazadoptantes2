import { describe, it, expect } from 'vitest';
import { normalizeConfidence, storedScoreToPercent, PRACTICAL_MAX_DUPLICATE } from './scoring';

/**
 * Guards the two-scale confusion behind the "medium · 100% coincidencia" bug
 * (2026-09-07): a raw token score gets normalised against
 * PRACTICAL_MAX_DUPLICATE, and the RESULT is what lands in
 * duplicate_candidates.score. Reading that column back through
 * normalizeConfidence a second time clamped every row to 100%.
 */
describe('normalizeConfidence — raw token score → percent', () => {
    it('scales a raw score against the ceiling', () => {
        // name_full (2) + name_word (1) = 3 of a possible 12.
        expect(normalizeConfidence(3, PRACTICAL_MAX_DUPLICATE)).toBe(25);
        // phone (3) + email (3) = 6.
        expect(normalizeConfidence(6, PRACTICAL_MAX_DUPLICATE)).toBe(50);
    });

    it('clamps at 100 and never divides by zero', () => {
        expect(normalizeConfidence(99, PRACTICAL_MAX_DUPLICATE)).toBe(100);
        expect(normalizeConfidence(5, 0)).toBe(0);
    });
});

describe('storedScoreToPercent — a value already in percent', () => {
    it('passes a stored score through unchanged', () => {
        // The exact production rows behind the report: every band, every score.
        expect(storedScoreToPercent(20)).toBe(20);   // 516 rows, banded low
        expect(storedScoreToPercent(35)).toBe(35);   // 99 rows, medium — the Cristina pairs
        expect(storedScoreToPercent(40)).toBe(40);
        expect(storedScoreToPercent(100)).toBe(100);
    });

    it('does NOT re-normalise against the token ceiling', () => {
        // The bug: 35 / 12 * 100 = 292 → clamped to 100, so a `medium` pair
        // displayed as a perfect match.
        expect(storedScoreToPercent(35)).not.toBe(normalizeConfidence(35, PRACTICAL_MAX_DUPLICATE));
        expect(normalizeConfidence(35, PRACTICAL_MAX_DUPLICATE)).toBe(100);
    });

    it('is defensive about junk', () => {
        expect(storedScoreToPercent(0)).toBe(0);
        expect(storedScoreToPercent(-5)).toBe(0);
        expect(storedScoreToPercent(NaN)).toBe(0);
        expect(storedScoreToPercent(1e6)).toBe(100);
    });
});
