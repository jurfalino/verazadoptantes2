import { describe, it, expect } from 'vitest';
import { normalizePhoneForWa, buildWaMeUrl, buildTelegramUrl } from './whatsapp';
import { interpolate } from './interpolate';

describe('normalizePhoneForWa (AR rules)', () => {
    it('keeps a correct 549 number (no double prefix)', () => {
        expect(normalizePhoneForWa('5491134567890')).toBe('5491134567890');
        expect(normalizePhoneForWa('+54 9 11 3456-7890')).toBe('5491134567890');
    });
    it('inserts the mobile 9 after a bare 54', () => {
        expect(normalizePhoneForWa('54 11 3456 7890')).toBe('5491134567890');
    });
    it('normalizes local formats: leading 0 and 15 prefixes', () => {
        expect(normalizePhoneForWa('011 3456-7890')).toBe('549' + '1134567890');
        expect(normalizePhoneForWa('15-3456-7890')).toBe('549' + '34567890');
        expect(normalizePhoneForWa('11 3456 7890')).toBe('5491134567890');
    });
    it('strips 00 international prefix', () => {
        expect(normalizePhoneForWa('0054 11 3456 7890')).toBe('5491134567890');
    });
    it('passes through non-AR international numbers', () => {
        expect(normalizePhoneForWa('+1 415 555 0100')).toBe('14155550100');
    });
    it('rejects garbage and too-short values', () => {
        expect(normalizePhoneForWa('')).toBeNull();
        expect(normalizePhoneForWa(null)).toBeNull();
        expect(normalizePhoneForWa('555')).toBeNull();
    });
});

describe('deep links', () => {
    it('wa.me url encodes the message', () => {
        expect(buildWaMeUrl('11 3456 7890', '¿Cómo va Luna?'))
            .toBe('https://wa.me/5491134567890?text=%C2%BFC%C3%B3mo%20va%20Luna%3F');
    });
    it('telegram opens the chat by phone (no text — copied client-side)', () => {
        expect(buildTelegramUrl('11 3456 7890')).toBe('https://t.me/+5491134567890');
    });
    it('null phone → null link', () => {
        expect(buildWaMeUrl('x', 'hola')).toBeNull();
    });
});

describe('interpolate', () => {
    it('fills known vars and leaves unknown placeholders visible', () => {
        expect(interpolate('Hola {familia}, {animal} lleva {dias} días. {typo}', { familia: 'Carla', animal: 'Luna', dias: 7 }))
            .toBe('Hola Carla, Luna lleva 7 días. {typo}');
    });
});
