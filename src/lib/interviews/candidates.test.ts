import { describe, it, expect } from 'vitest';
import { toCandidateSummary, storedFactValues } from './candidates';
import type { DiscoveryMatch } from '@/app/actions/types';

function match(over: Partial<Omit<DiscoveryMatch, 'adopter'>> & { adopter?: Partial<DiscoveryMatch['adopter']> } = {}): DiscoveryMatch {
    const { adopter, ...rest } = over;
    return {
        adopterId: 'a1', adopterName: 'Juan Pérez (raw)', relevancePercent: 72, matchTypes: ['name'], matchValues: [], source: 'token',
        ownership: undefined, matchSnippet: null, contactProtected: false, visibilityBadge: null, avgRating: 4,
        thumbnail: null, stats: { searchHits: 0, profileViews: 0, requests: 0, adoptions: 2 }, flags: {} as DiscoveryMatch['flags'],
        adopter: { id: 'a1', name: 'Juan Pérez', contactInfo: null, contactEntries: null, addressInfo: null, ...adopter } as DiscoveryMatch['adopter'],
        ...rest,
    } as DiscoveryMatch;
}

describe('toCandidateSummary', () => {
    it('an unprotected profile exposes its values to the viewer', () => {
        const s = toCandidateSummary(match({ adopter: {
            contactEntries: JSON.stringify([{ type: 'phone', value: '+5491165851333' }, { type: 'email', value: 'j@x.com' }]),
            addressInfo: 'Rivadavia 4500',
        } }), { viewerIsAdmin: false });
        expect(s.stored.sort()).toEqual(['address', 'emails', 'phones']);
        expect(s.visible.phones).toEqual(['+5491165851333']);
        expect(s.visible.address).toEqual(['Rivadavia 4500']);
        expect(s.displayName).toBe('Juan Pérez');
        expect(s.adoptionCount).toBe(2);
    });

    it('a protected profile: masked entries are stored-but-invisible, the masked address is never visible', () => {
        const s = toCandidateSummary(match({ contactProtected: true, adopter: {
            contactEntries: JSON.stringify([{ type: 'phone', value: '11••••1333', masked: true }, { type: 'social', value: '@juanp' }]),
            addressInfo: 'Riv••••',
        } }), { viewerIsAdmin: false });
        expect(s.stored.sort()).toEqual(['address', 'phones', 'socials']);
        expect(s.visible.phones).toBeUndefined();
        expect(s.visible.address).toBeUndefined();
        expect(s.visible.socials).toEqual(['@juanp']); // unlocked entry (not masked)
    });

    it('a protected profile never falls back to parsing the masked contactInfo blob', () => {
        const s = toCandidateSummary(match({ contactProtected: true, adopter: { contactEntries: null, contactInfo: 'Tel: 11••••1333' } }), { viewerIsAdmin: false });
        expect(s.visible).toEqual({});
    });

    it('canEdit for own/team profiles and admins only', () => {
        expect(toCandidateSummary(match({ ownership: 'mine' }), { viewerIsAdmin: false }).canEdit).toBe(true);
        expect(toCandidateSummary(match({ ownership: 'team' }), { viewerIsAdmin: false }).canEdit).toBe(true);
        expect(toCandidateSummary(match(), { viewerIsAdmin: true }).canEdit).toBe(true);
        expect(toCandidateSummary(match(), { viewerIsAdmin: false }).canEdit).toBe(false);
    });
});

describe('storedFactValues (raw row, server-only)', () => {
    it('reads structured entries, falling back to the blob, plus addressInfo', () => {
        const row = { contactEntries: null, contactInfo: 'Tel: 11 6585-1333', addressInfo: 'Rivadavia 4500' };
        expect(storedFactValues(row, 'phones')).toHaveLength(1); // parsed from the blob
        expect(storedFactValues(row, 'address')).toEqual(['Rivadavia 4500']);
    });
});
