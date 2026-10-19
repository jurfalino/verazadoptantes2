import { describe, expect, it } from 'vitest';
import { socialUrl } from './contactEntries';

describe('socialUrl — a name is never a link (2026-10-18/19)', () => {
    it('a display name, with or without a host, is text', () => {
        expect(socialUrl('Ana Perez', 'facebook')).toBeNull();
        expect(socialUrl('facebook.com/Ana Perez', 'facebook')).toBeNull();
        expect(socialUrl('https://facebook.com/Ana Perez', 'facebook')).toBeNull();
    });
    it('an account followed by a note links the account', () => {
        expect(socialUrl('facebook.com/ana.perez (mi perfil)', 'facebook')).toBe('https://facebook.com/ana.perez');
        expect(socialUrl('@ana.perez 🙂', 'instagram')).toBe('https://instagram.com/ana.perez');
    });
    it('plain accounts are unchanged', () => {
        expect(socialUrl('@ana.perez', 'instagram')).toBe('https://instagram.com/ana.perez');
        expect(socialUrl('https://www.facebook.com/ana.perez', 'facebook')).toBe('https://www.facebook.com/ana.perez');
    });
});
