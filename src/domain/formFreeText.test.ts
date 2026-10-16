import { describe, it, expect } from 'vitest';
import { clampFreeText, socialHandle, normalizeOpenAnswers } from './formFreeText';

describe('free text from the public form', () => {
    it('trims and clamps; non-strings and blanks are dropped', () => {
        expect(clampFreeText('  hola ', 300)).toBe('hola');
        expect(clampFreeText('x'.repeat(400), 300)).toHaveLength(300);
        expect(clampFreeText(42, 300)).toBeUndefined();
        expect(clampFreeText('   ', 300)).toBeUndefined();
    });
});

describe('social handles that may reach a profile', () => {
    it('accepts a handle or a profile URL of that network', () => {
        expect(socialHandle(' @laura.perez ', 'instagram')).toEqual({ value: '@laura.perez', platform: 'instagram' });
        expect(socialHandle('laura_p', 'instagram')).toEqual({ value: '@laura_p', platform: 'instagram' });
        expect(socialHandle('instagram.com/laura', 'instagram')).toEqual({ value: 'instagram.com/laura', platform: 'instagram' });
        expect(socialHandle('https://facebook.com/laura.p', 'facebook')).toEqual({ value: 'https://facebook.com/laura.p', platform: 'facebook' });
    });
    it('refuses sentences, other networks and junk', () => {
        expect(socialHandle('no tengo', 'instagram')).toBeNull();
        expect(socialHandle('facebook.com/laura', 'instagram')).toBeNull();
        expect(socialHandle('@'.repeat(5), 'instagram')).toBeNull();
        expect(socialHandle('x'.repeat(120), 'instagram')).toBeNull();
        expect(socialHandle(7, 'instagram')).toBeNull();
    });
});

describe('review fixes (2026-10-14)', () => {
    it('a "no tengo"-style answer is not a handle — it would pair unrelated applicants', () => {
        for (const v of ['no', 'No', 'ninguno', 'Ninguna', 'nada', 'none', 'n/a', '-', 'no tengo', 'notengo', 'sin', '@no']) {
            expect(socialHandle(v, 'instagram'), v).toBeNull();
        }
        expect(socialHandle('ab', 'instagram')).toBeNull();
        expect(socialHandle('ana', 'instagram')).toEqual({ value: '@ana', platform: 'instagram' });
    });
    it('share links of a real profile are profiles: the query is dropped', () => {
        expect(socialHandle('https://www.instagram.com/laura.p?igsh=MXd2a3Y=', 'instagram')).toEqual({ value: 'https://www.instagram.com/laura.p', platform: 'instagram' });
        expect(socialHandle('https://www.facebook.com/profile.php?id=100012345678', 'facebook')).toEqual({ value: 'https://www.facebook.com/profile.php?id=100012345678', platform: 'facebook' });
        expect(socialHandle('https://facebook.com/laura.p?mibextid=ZbWKwL', 'facebook')).toEqual({ value: 'https://facebook.com/laura.p', platform: 'facebook' });
    });
});

describe('free-text answers to closed questions (release 3)', () => {
    it('keep { open } trimmed and clamped; drop empty text and any other object', () => {
        const out = normalizeOpenAnswers({
            rental: { open: '  alquilo  ' }, gaveAway: { open: 'x'.repeat(900) }, carer: { open: '   ' },
            sleepPlace: { evil: true }, lastAnimal: { open: 'murió de viejo' }, existingPets: { dogs: 1 }, name: 'A',
        });
        expect(out.rental).toEqual({ open: 'alquilo' });
        expect((out.gaveAway as { open: string }).open).toHaveLength(500);
        expect(out).not.toHaveProperty('carer');
        expect(out).not.toHaveProperty('sleepPlace');
        expect(out.lastAnimal).toEqual({ open: 'murió de viejo' });
        expect(out.existingPets).toEqual({ dogs: 1 });
        expect(out.name).toBe('A');
    });
});
