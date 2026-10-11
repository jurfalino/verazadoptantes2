import { describe, it, expect } from 'vitest';
import { pairsOnSharedToken, scorePair, confidenceOf } from './duplicatePairing';

describe('pairsOnSharedToken', () => {
    it('a place word on many records pairs nobody', () => {
        expect(pairsOnSharedToken('address_word', 95)).toBe(false); // "villa"
        expect(pairsOnSharedToken('address_word', 6)).toBe(false);
    });
    it('a rare address word still pairs (a real shared address)', () => {
        expect(pairsOnSharedToken('address_word', 2)).toBe(true);
        expect(pairsOnSharedToken('address_word', 5)).toBe(true);
    });
    it('keeps the existing social-handle cap', () => {
        expect(pairsOnSharedToken('social_handle', 9)).toBe(false);
        expect(pairsOnSharedToken('social', 8)).toBe(true);
    });
    it('never caps strong identifiers', () => {
        expect(pairsOnSharedToken('phone', 50)).toBe(true);
        expect(pairsOnSharedToken('id_number', 50)).toBe(true);
    });
});

describe('scorePair', () => {
    it('an address shared with its house number is a medium signal', () => {
        expect(confidenceOf(scorePair({ address_word: ['rivadavia', '1234'] }))).toBe('medium');
    });
    it('the same street and town without a number is only low', () => {
        const s = scorePair({ address_word: ['rivadavia', 'moron'] });
        expect(s).toBeGreaterThanOrEqual(10);
        expect(confidenceOf(s)).toBe('low');
    });
    it('one shared address word scores nothing', () => {
        expect(scorePair({ address_word: ['rivadavia'] })).toBe(0);
    });
    it('keeps the other weights', () => {
        expect(confidenceOf(scorePair({ phone: ['541165851333'] }))).toBe('high');
        expect(scorePair({ name_word: ['maria'] })).toBe(5);
        expect(scorePair({ name_word: ['maria', 'garcia'], name_full: ['maria garcia'] })).toBe(50);
    });
});
