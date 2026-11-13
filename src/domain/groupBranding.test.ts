import { describe, it, expect } from 'vitest';
import {
    ACCENTS, DEFAULT_THEME, DEFAULT_ACCENT_ID, normalizeSocialLink, sanitizeBrandingInput, hasBranding, pickBrandingOrgId,
} from './groupBranding';

describe('palette', () => {
    it('has the 8 accents and the defaults are among them', () => {
        expect(ACCENTS.map(a => a.id)).toEqual(['violeta', 'azul', 'turquesa', 'verde', 'naranja', 'rosa', 'ambar', 'grafito']);
        expect(DEFAULT_THEME).toBe('dark');
        expect(ACCENTS.some(a => a.id === DEFAULT_ACCENT_ID)).toBe(true);
        expect(ACCENTS[0]).toMatchObject({ d: '#818cf8', dStrong: '#a5b4fc', dHover: '#6366f1', l: '#4f46e5', lStrong: '#4338ca', lHover: '#3730a3' });
    });
});

describe('normalizeSocialLink', () => {
    it('instagram: handle, @handle and profile URL all become the canonical URL', () => {
        for (const raw of ['michisdeltren', '@michisdeltren', 'https://www.instagram.com/michisdeltren/?hl=es'])
            expect(normalizeSocialLink('instagram', raw)).toEqual({ ok: true, url: 'https://instagram.com/michisdeltren' });
    });
    it('empty means no link', () => expect(normalizeSocialLink('website', '  ')).toEqual({ ok: true, url: null }));
    it('rejects a facebook URL in the instagram box', () => expect(normalizeSocialLink('instagram', 'https://facebook.com/x')).toEqual({ ok: false }));
    it('facebook: handle and fb.com/m. URLs normalise to facebook.com', () => {
        expect(normalizeSocialLink('facebook', 'michis.del.tren')).toEqual({ ok: true, url: 'https://facebook.com/michis.del.tren' });
        expect(normalizeSocialLink('facebook', 'https://m.facebook.com/michis.del.tren?ref=x')).toEqual({ ok: true, url: 'https://facebook.com/michis.del.tren' });
        expect(normalizeSocialLink('facebook', 'https://fb.com/profile.php?id=123&x=1')).toEqual({ ok: true, url: 'https://facebook.com/profile.php?id=123' });
    });
    it('website: adds https, rejects other schemes and hostless text', () => {
        expect(normalizeSocialLink('website', 'michisdeltren.org')).toEqual({ ok: true, url: 'https://michisdeltren.org' });
        expect(normalizeSocialLink('website', 'javascript:alert(1)')).toEqual({ ok: false });
        expect(normalizeSocialLink('website', 'hola')).toEqual({ ok: false });
        expect(normalizeSocialLink('website', 'https://a.org/' + 'x'.repeat(300))).toEqual({ ok: false });
    });
    it('instagram: rejects a bad handle and a 500-char string', () => {
        expect(normalizeSocialLink('instagram', 'a b')).toEqual({ ok: false });
        expect(normalizeSocialLink('instagram', 'x'.repeat(500))).toEqual({ ok: false });
    });
});

describe('sanitizeBrandingInput', () => {
    const base = { theme: 'light', accentId: 'azul', instagram: '', facebook: '', website: '' };
    it('names the bad field', () => {
        expect(sanitizeBrandingInput({ ...base, theme: 'pink' })).toEqual({ ok: false, field: 'theme' });
        expect(sanitizeBrandingInput({ ...base, accentId: 'oro' })).toEqual({ ok: false, field: 'accent' });
        expect(sanitizeBrandingInput({ ...base, facebook: 'https://instagram.com/x' })).toEqual({ ok: false, field: 'facebook' });
        expect(sanitizeBrandingInput(null)).toEqual({ ok: false, field: 'theme' });
    });
    it('returns normalised fields', () => {
        expect(sanitizeBrandingInput({ ...base, instagram: '@michis' })).toEqual({
            ok: true,
            value: { theme: 'light', accentId: 'azul', instagramUrl: 'https://instagram.com/michis', facebookUrl: null, websiteUrl: null },
        });
    });
});

describe('hasBranding', () => {
    const none = { theme: 'dark', accentId: 'violeta', instagramUrl: null, facebookUrl: null, websiteUrl: null, logoUrl: null, bannerUrl: null } as const;
    it('is false for the defaults with nothing uploaded', () => expect(hasBranding(none)).toBe(false));
    it('is true when anything differs', () => {
        expect(hasBranding({ ...none, theme: 'light' })).toBe(true);
        expect(hasBranding({ ...none, accentId: 'rosa' })).toBe(true);
        expect(hasBranding({ ...none, logoUrl: 'https://x/y.png' })).toBe(true);
        expect(hasBranding({ ...none, websiteUrl: 'https://a.org' })).toBe(true);
    });
});

describe('pickBrandingOrgId', () => {
    it('a hint is used only for a member', () => {
        expect(pickBrandingOrgId({ hintOrgId: 'A', memberOrgIds: ['A', 'B'], source: { type: 'org', orgId: 'B' } })).toBe('A');
        expect(pickBrandingOrgId({ hintOrgId: 'X', memberOrgIds: ['A', 'B'], source: { type: 'org', orgId: 'B' } })).toBe('B');
        expect(pickBrandingOrgId({ hintOrgId: null, memberOrgIds: ['A'], source: { type: 'self' } })).toBe(null);
        expect(pickBrandingOrgId({ hintOrgId: null, memberOrgIds: [], source: { type: 'org', orgId: 'B' } })).toBe(null);
    });
});
