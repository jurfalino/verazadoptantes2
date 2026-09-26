import { describe, it, expect } from 'vitest';
import { toGuestMatch } from './guestMatch';
import type { DiscoveryMatch } from '@/app/actions/types';

const raw = {
    id: 'a1',
    name: 'María Paula Garibotto Otto',
    contactInfo: 'Tel: 1155443322 Redes: MARÍA OTTO EN FACEBOOK Conocido/a como: Pauli Garibotto',
    contactEntries: JSON.stringify([
        { type: 'phone', value: '1155443322' },
        { type: 'alias', value: 'Pauli Garibotto' },
    ]),
    addressInfo: 'Calle Falsa 123',
    familyMembers: 'Hermano: Juan Garibotto',
    householdMembers: '[{"name":"Juan Garibotto"}]',
    notes: 'Paula dijo que…',
    sourceUrl: 'https://facebook.com/paula.garibotto',
    addedBy: 'rescatista@example.com',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
} as unknown as DiscoveryMatch['adopter'];

// What assembleDiscoveryMatch hands over for a logged-out viewer: contact
// already partly masked, name in full.
const match = {
    adopterId: 'a1',
    adopterName: raw.name,
    relevancePercent: 90,
    matchTypes: ['name'],
    matchValues: [{ type: 'name', value: 'maria paula garibotto otto' }],
    source: 'like',
    adopter: { ...raw, contactInfo: 'Tel: 1155•••••• Redes: MARÍA OTTO EN FACEBOOK Conocido/a como: Pauli Garibotto' },
    matchSnippet: { field: 'name', snippet: 'María Paula Garibotto Otto', highlights: [{ start: 0, end: 5 }] },
    contactProtected: true,
    visibilityBadge: 'protected-locked',
    avgRating: 1,
    thumbnail: null,
    stats: { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 },
    flags: {},
} as unknown as DiscoveryMatch;

describe('toGuestMatch', () => {
    const out = toGuestMatch(match, raw as never, 'maria');

    it('masks the name everywhere it is carried', () => {
        expect(out.adopter.name).toBe('María P•••• G•••• O••••');
        expect(out.adopterName).toBe('María P•••• G•••• O••••');
    });

    it('masks name and alias words in the contact line, keeping the rest', () => {
        expect(out.adopter.contactInfo)
            .toBe('Tel: 1155•••••• Redes: MARÍA O•••• EN FACEBOOK Conocido/a como: P•••• G••••');
    });

    it('sends no untyped name word anywhere in the result', () => {
        const json = JSON.stringify(out);
        for (const word of ['Paula', 'Garibotto', 'Otto', 'OTTO', 'Pauli', 'Juan', 'rescatista@example.com']) {
            expect(json, word).not.toContain(word);
        }
    });

    it('drops the fields the card does not show and blanks the snippet value', () => {
        expect(out.adopter.contactEntries).toBeNull();
        expect(out.adopter.familyMembers).toBeNull();
        expect(out.adopter.householdMembers).toBeNull();
        expect(out.adopter.notes).toBeNull();
        expect(out.adopter.sourceUrl).toBeNull();
        expect(out.matchValues).toEqual([]);
        expect(out.matchSnippet).toEqual({ field: 'name', snippet: '', highlights: [] });
    });

    it('keeps what the card shows', () => {
        expect(out.avgRating).toBe(1);
        expect(out.visibilityBadge).toBe('protected-locked');
        expect(out.adopter.createdAt).toEqual(raw.createdAt);
    });
});
