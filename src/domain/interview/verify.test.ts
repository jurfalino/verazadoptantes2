import { describe, it, expect } from 'vitest';
import { factMatches } from './verify';

describe('factMatches', () => {
    it('phones match across formatting and country code', () => {
        expect(factMatches('phones', ['+5491165851333'], ['11 6585-1333'])).toBe(true);
        expect(factMatches('phones', ['+5491165851333'], ['11 6585-0000'])).toBe(false);
    });
    it('emails and socials compare normalized', () => {
        expect(factMatches('emails', ['Juan@Mail.com'], ['juan@mail.com'])).toBe(true);
        expect(factMatches('socials', ['https://www.instagram.com/juan.perez/'], ['@juan.perez'])).toBe(true);
    });
    it('addresses match on exact normalization or shared street pairs', () => {
        // Positive: exact match after normalization
        expect(factMatches('address', ['Av. Rivadavia 4500, Caballito'], ['av rivadavia 4500 caballito'])).toBe(true);
        // Positive: shared street pair (Rivadavia 4500)
        expect(factMatches('address', ['Rivadavia 4500, Caballito'], ['vivo en Rivadavia 4500'])).toBe(true);
        // Negative: different streets (Rivadavia vs Corrientes), even in same city
        expect(factMatches('address', ['Rivadavia 4500, Buenos Aires'], ['Corrientes 1200, Buenos Aires'])).toBe(false);
        // Negative: different streets with different numbers, same neighborhood
        expect(factMatches('address', ['Mendoza 1200 Caballito'], ['Cordoba 1200 Caballito'])).toBe(false);
        // Negative: same street, different numbers
        expect(factMatches('address', ['Rivadavia 4500'], ['Rivadavia 4600'])).toBe(false);
        // Negative: no street pairs on one side (city name alone)
        expect(factMatches('address', ['Caballito'], ['Caballito, Buenos Aires'])).toBe(false);
    });
    it('nothing to compare is never a match', () => {
        expect(factMatches('phones', [], ['1165851333'])).toBe(false);
        expect(factMatches('phones', ['1165851333'], [])).toBe(false);
    });
});

import { streetPairs } from './verify';
describe('streetPairs', () => {
    it('counts distinct street+number pairs', () => {
        expect(streetPairs('Av Rivadavia 1234')).toHaveLength(1);
        expect(streetPairs('Rivadavia 1234, Corrientes 5678')).toHaveLength(2);
        expect(streetPairs('barrio norte')).toHaveLength(0);
    });
});
