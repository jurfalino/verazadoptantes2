import { describe, it, expect } from 'vitest';
import {
    ACCENTS, DEFAULT_THEME, DEFAULT_ACCENT_ID, normalizeSocialLink, sanitizeBrandingInput, hasBranding, pickBrandingOrgId, brandingFromOrgRow, ORG_IMAGE_MAX_DATA_URL,
    type SocialKind,
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

    // Final review I1: real-world links that used to be stored truncated.
    const ok = (url: string) => ({ ok: true, url });
    it('facebook: /people/<name>/<id> keeps the full path (the URL Facebook gives most new Pages)', () => {
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/people/Refugio-Gatitos/100083123456789/'))
            .toEqual(ok('https://facebook.com/people/Refugio-Gatitos/100083123456789'));
        expect(normalizeSocialLink('facebook', 'facebook.com/people/Refugio-Gat%C3%ADtos/100083123456789?mibextid=abc'))
            .toEqual(ok('https://facebook.com/people/Refugio-Gat%C3%ADtos/100083123456789'));
        // Accented name typed raw → the parser percent-encodes it; still a working link.
        expect(normalizeSocialLink('facebook', 'https://facebook.com/people/Refugio-Gatítos/100083123456789'))
            .toEqual(ok('https://facebook.com/people/Refugio-Gat%C3%ADtos/100083123456789'));
        // Without the numeric id it is not a page link.
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/people/Refugio-Gatitos/')).toEqual({ ok: false });
    });
    it('facebook: /pages/…, /groups/<g>, /share/<code> and /share/g/<code> keep the full path', () => {
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/pages/Refugio/123456')).toEqual(ok('https://facebook.com/pages/Refugio/123456'));
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/pages/category/Nonprofit/Refugio-123456/'))
            .toEqual(ok('https://facebook.com/pages/category/Nonprofit/Refugio-123456'));
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/groups/refugiogatitos')).toEqual(ok('https://facebook.com/groups/refugiogatitos'));
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/groups/1234567890/?ref=share')).toEqual(ok('https://facebook.com/groups/1234567890'));
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/share/1AbCdEf/')).toEqual(ok('https://facebook.com/share/1AbCdEf'));
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/share/g/1AbCdEf/?mibextid=K35XfP')).toEqual(ok('https://facebook.com/share/g/1AbCdEf'));
        for (const t of ['p', 'r', 'v'])
            expect(normalizeSocialLink('facebook', `https://www.facebook.com/share/${t}/1AbCdEf/`)).toEqual(ok(`https://facebook.com/share/${t}/1AbCdEf`));
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/groups/refugiogatitos/posts/123456/'))
            .toEqual(ok('https://facebook.com/groups/refugiogatitos/posts/123456'));
    });
    it('facebook: profile.php?id=N keeps the id', () => {
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/profile.php?id=100083123456789&mibextid=x'))
            .toEqual(ok('https://facebook.com/profile.php?id=100083123456789'));
        expect(normalizeSocialLink('facebook', 'https://www.facebook.com/profile.php')).toEqual({ ok: false });
    });
    it('facebook: a post, photo, video or event first segment (or a malformed path) is refused, never truncated', () => {
        for (const raw of [
            'https://www.facebook.com/share/xy/1AbCdEf/', 'https://www.facebook.com/share/p/1AbCdEf/extra',
            'https://www.facebook.com/watch/?v=123', 'https://www.facebook.com/events/123/', 'https://www.facebook.com/photo/?fbid=1',
            'https://www.facebook.com/story.php?story_fbid=1&id=2', 'https://www.facebook.com/permalink.php?story_fbid=1',
            'https://www.facebook.com/groups/', 'https://www.facebook.com/share/', 'https://www.facebook.com/pages/',
            'people', 'groups', 'profile.php',
        ]) expect(normalizeSocialLink('facebook', raw), raw).toEqual({ ok: false });
    });
    it('instagram: a post/reel link is not the group profile → invalid', () => {
        for (const raw of [
            'https://www.instagram.com/p/Cxyz123/', 'https://www.instagram.com/reel/Cxyz123/', 'instagram.com/reels/Cxyz123',
            'https://www.instagram.com/tv/Cxyz123', 'https://www.instagram.com/stories/refugio/123', 'https://www.instagram.com/explore/tags/gatos/',
            'p', 'reel',
        ]) expect(normalizeSocialLink('instagram', raw), raw).toEqual({ ok: false });
    });
    it('a bare network host is refused, never stored as instagram.com/instagram.com', () => {
        for (const raw of ['instagram.com', 'Instagram.com', '@instagram.com', 'www.instagram.com', 'https://instagram.com', 'https://www.instagram.com/', 'facebook.com', 'fb.com'])
            expect(normalizeSocialLink('instagram', raw), raw).toEqual({ ok: false });
        for (const raw of ['facebook.com', 'Facebook.com', '@facebook.com', 'www.facebook.com', 'fb.com', 'https://facebook.com', 'https://www.facebook.com/', 'm.facebook.com/', 'instagram.com'])
            expect(normalizeSocialLink('facebook', raw), raw).toEqual({ ok: false });
    });
    it('a facebook path longer than the cap is refused', () => {
        expect(normalizeSocialLink('facebook', `https://facebook.com/pages/${'a'.repeat(100)}/${'b'.repeat(100)}`)).toEqual({ ok: false });
    });
    it('every stored URL normalises to itself (the dashboard re-saves untouched fields)', () => {
        const inputs: Array<[SocialKind, string]> = [
            ['instagram', '@michisdeltren'], ['instagram', 'https://www.instagram.com/michis.del_tren/?hl=es'],
            ['facebook', 'michis.del.tren'], ['facebook', 'https://fb.com/profile.php?id=123'],
            ['facebook', 'https://www.facebook.com/people/Refugio-Gatítos/100083123456789/'], ['facebook', 'https://www.facebook.com/pages/Refugio/123456'],
            ['facebook', 'https://www.facebook.com/groups/refugiogatitos'], ['facebook', 'https://www.facebook.com/share/1AbCdEf/'],
            ['facebook', 'https://www.facebook.com/share/g/1AbCdEf/'], ['facebook', 'https://www.facebook.com/share/p/1AbCdEf/'],
            ['facebook', 'https://www.facebook.com/groups/refugiogatitos/posts/123456/'],
            ['website', 'michisdeltren.org'], ['website', 'https://a.org/b/'], ['website', 'http://michisdeltren.org/adopta?x=1#y'],
        ];
        for (const [kind, raw] of inputs) {
            const first = normalizeSocialLink(kind, raw);
            expect(first.ok, raw).toBe(true);
            const stored = (first as { ok: true; url: string }).url;
            expect(stored.startsWith('https://'), raw).toBe(true);
            expect(normalizeSocialLink(kind, stored), raw).toEqual(ok(stored));
        }
    });
    it('website: http:// is stored as https:// (public pages only render https), keeping path and query', () => {
        expect(normalizeSocialLink('website', 'http://michisdeltren.org')).toEqual(ok('https://michisdeltren.org'));
        expect(normalizeSocialLink('website', 'HTTP://michisdeltren.org/adopta?x=1')).toEqual(ok('https://michisdeltren.org/adopta?x=1'));
        expect(normalizeSocialLink('website', 'www.michisdeltren.org/adopta')).toEqual(ok('https://www.michisdeltren.org/adopta'));
        expect(normalizeSocialLink('website', 'https://michisdeltren.org/')).toEqual(ok('https://michisdeltren.org'));
        expect(normalizeSocialLink('website', 'ftp://michisdeltren.org')).toEqual({ ok: false });
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

describe('brandingFromOrgRow', () => {
    const row = {
        name: 'Refugio', slug: 'refugio', logoUrl: null, bannerUrl: null, brandTheme: null, brandAccent: null,
        instagramUrl: null, facebookUrl: null, websiteUrl: null,
    };
    it('NULL theme/accent read as the defaults (today\'s look)', () => {
        expect(brandingFromOrgRow(row)).toEqual({
            orgName: 'Refugio', orgSlug: 'refugio', theme: 'dark', accentId: 'violeta',
            logoUrl: null, bannerUrl: null, instagramUrl: null, facebookUrl: null, websiteUrl: null,
        });
    });
    it('keeps valid stored values', () => {
        const b = brandingFromOrgRow({ ...row, brandTheme: 'light', brandAccent: 'naranja', logoUrl: 'https://r2/l.png', instagramUrl: 'https://instagram.com/x' });
        expect(b).toMatchObject({ theme: 'light', accentId: 'naranja', logoUrl: 'https://r2/l.png', instagramUrl: 'https://instagram.com/x' });
    });
    it('an unknown stored theme/accent falls back to the defaults, never reaches a page', () => {
        expect(brandingFromOrgRow({ ...row, brandTheme: 'neon', brandAccent: '#ff0000' })).toMatchObject({ theme: 'dark', accentId: 'violeta' });
    });
    it('a missing slug is null', () => {
        expect(brandingFromOrgRow({ ...row, slug: null }).orgSlug).toBeNull();
    });
});

describe('ORG_IMAGE_MAX_DATA_URL', () => {
    it('fits under the default 1 MB server-action body limit (setGroupImage sends it through an action)', () => {
        expect(ORG_IMAGE_MAX_DATA_URL).toBe(750_000);
    });
});
