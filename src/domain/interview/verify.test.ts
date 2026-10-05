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
    it('addresses match when equal after accents/case, or sharing two meaningful words', () => {
        expect(factMatches('address', ['Av. Rivadavia 4500, Caballito'], ['av rivadavia 4500 caballito'])).toBe(true);
        expect(factMatches('address', ['Rivadavia 4500, Caballito'], ['vivo en Rivadavia 4500'])).toBe(true);
        expect(factMatches('address', ['Rivadavia 4500, Caballito'], ['Corrientes 1200, Almagro'])).toBe(false);
    });
    it('nothing to compare is never a match', () => {
        expect(factMatches('phones', [], ['1165851333'])).toBe(false);
        expect(factMatches('phones', ['1165851333'], [])).toBe(false);
    });
});
