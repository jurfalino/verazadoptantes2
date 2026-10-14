import { describe, it, expect } from 'vitest';
import { clampFreeText, socialHandle } from './formFreeText';

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
