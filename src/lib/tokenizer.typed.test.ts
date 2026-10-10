import { describe, it, expect } from 'vitest';
import { extractTokens, normalizeSocialHandle, extractSocials, type TokenEntry } from './tokenizer';
import { tokenInputsFor } from './adopterTokenize';
import { categorizeContactText } from './contactEntries';

/**
 * Wrong-type indexing audit (2026-10-10): contact tokens must come from typed
 * entries only, each through its own type's rules. Every case below was a real
 * production failure; values are invented with the same shapes.
 */
const adopter = { name: 'Lorena Núñez', addressInfo: null, familyMembers: null, sourceUrl: null, country: 'AR' };
const of = (entries: TokenEntry[], household: Array<{ name: string; contactEntries: TokenEntry[] }> = []) =>
    extractTokens(adopter, [], entries, household).map(t => `${t.type}:${t.value}`);

describe('a Facebook profile link never becomes a phone', () => {
    // The reported record: three real phones and a profile.php link.
    const tokens = of([
        { type: 'phone', value: '4864-8245' },
        { type: 'phone', value: '156-1013599' },
        { type: 'phone', value: '1164723109' },
        { type: 'social', value: 'https://www.facebook.com/profile.php?id=1300000006', platform: 'facebook' },
        { type: 'address', value: 'Mario Bravo 64, Dpto. 7, Almagro, C.A.B.A.' },
    ]);

    it('indexes the three real numbers, read by country', () => {
        expect(tokens).toContain('phone:48648245');            // landline, no area code
        expect(tokens).toContain('phone:61013599');            // "156-…" = old mobile prefix
        expect(tokens).toContain('phone:541164723109');        // complete
    });
    it('does not index the profile id as a phone', () => {
        expect(tokens.filter(t => t.startsWith('phone') && t.includes('1300000006'))).toEqual([]);
    });
    it('indexes the profile as a social id', () => {
        expect(tokens).toContain('social_handle:id:1300000006');
    });
    it('indexes the address entry by its words, and its numbers as nothing else', () => {
        expect(tokens).toContain('address_word:bravo');
        expect(tokens).toContain('address_word:almagro');
        // The only phone tokens are the three real numbers (and the complete one's ending).
        expect(tokens.filter(t => t.startsWith('phone')).sort()).toEqual(
            ['phone:48648245', 'phone:541164723109', 'phone:61013599', 'phone_suffix:64723109'].sort(),
        );
    });
});

describe('Facebook / Instagram / TikTok links that are not profiles', () => {
    it.each([
        'https://www.facebook.com/photo.php?fbid=123456789&set=a.111.222',
        'https://www.facebook.com/share/abc123XYZ',
        'https://www.facebook.com/groups/rescate',
        'https://www.instagram.com/p/Cx1y2z3/',
        'https://www.instagram.com/reel/Cx1y2z3/',
    ])('%s carries no handle', (url) => {
        expect(normalizeSocialHandle(url)).toBeNull();
    });

    it('a TikTok video link yields the user, not the video id', () => {
        expect(normalizeSocialHandle('https://www.tiktok.com/@ana.rescate/video/7300000000000000000')).toBe('ana.rescate');
    });
    it('an X status link yields the user', () => {
        expect(normalizeSocialHandle('https://x.com/ana_rescate/status/1700000000000000000')).toBe('ana_rescate');
    });
    it('real profiles still resolve', () => {
        expect(normalizeSocialHandle('https://www.facebook.com/ana.perez.123')).toBe('ana.perez.123');
        expect(normalizeSocialHandle('https://www.instagram.com/ana.rescate/')).toBe('ana.rescate');
        expect(normalizeSocialHandle('https://www.facebook.com/people/Ana-Perez/100012345678901/')).toBe('id:100012345678901');
    });
});

describe('household members are indexed entry by entry', () => {
    const tokens = of([], [{ name: 'Carlos Núñez', contactEntries: [
        { type: 'phone', value: '11 2345-6789' },
        { type: 'id', value: '30.123.456' },
    ] }]);
    it('the phone and the DNI are not merged into one number', () => {
        expect(tokens).toContain('phone:541123456789');
        expect(tokens).toContain('id_number:30123456');
        expect(tokens.filter(t => t.startsWith('phone') && t.includes('30123456'))).toEqual([]);
    });
});

describe('ids, emails and the rest keep their own type', () => {
    it('an id entry needs no "DNI" label', () => {
        expect(of([{ type: 'id', value: '25.999.890' }])).toContain('id_number:25999890');
    });
    it('a DNI is never indexed as a phone', () => {
        expect(of([{ type: 'id', value: '25999890' }]).some(t => t.startsWith('phone'))).toBe(false);
    });
    it('digits inside an email are not a phone', () => {
        expect(of([{ type: 'email', value: 'ana12345678@example.com' }]).some(t => t.startsWith('phone'))).toBe(false);
    });
    it('an email ending in "_" before the @ does not yield the domain as a handle', () => {
        expect(extractSocials('ana_@gmail.com')).toEqual([]);
    });
});

describe('legacy rows without entries are parsed into typed entries first', () => {
    it('a blob link line produces no phone', () => {
        const { entries } = tokenInputsFor({
            contactEntries: null,
            contactInfo: 'Tel: 1164723109\nRedes: https://www.facebook.com/profile.php?id=1300000006',
        });
        expect(entries.filter(e => e.type === 'phone').map(e => e.value)).toEqual(['1164723109']);
    });
});

describe('categorizeContactText', () => {
    it('reads a keyword-less street address as an address', () => {
        const entries = categorizeContactText('Belgrano 1234, Quilmes');
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ type: 'address', value: 'Belgrano 1234, Quilmes' });
    });
    it('keeps short prose with a number as a note', () => {
        expect(categorizeContactText('edad 25')[0].type).toBe('other');
        expect(categorizeContactText('llamar después de las 1800')[0].type).toBe('other');
    });
    it('never turns digits inside a link into a phone', () => {
        const entries = categorizeContactText('https://www.facebook.com/profile.php?id=1300000006');
        expect(entries.some(e => e.type === 'phone')).toBe(false);
        expect(entries.some(e => e.type === 'social')).toBe(true);
    });
});
