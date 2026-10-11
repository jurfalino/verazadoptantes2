import { describe, it, expect } from 'vitest';
import { pairsOnSharedToken } from './duplicatePairing';

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
