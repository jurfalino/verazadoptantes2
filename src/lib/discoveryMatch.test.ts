import { describe, it, expect } from 'vitest';
import { assembleDiscoveryMatch, type MatchEnrichment, type MatchMeta } from './discoveryMatch';
import { NO_ACCESS_VISIBILITY, type Visibility } from './piiAccess';
import type { adopters } from '@/db/schema';

type AdopterRow = typeof adopters.$inferSelect;

const row = {
    id: 'a1', name: 'María García', contactInfo: 'Tel: +54 11 4567-8901',
    contactEntries: JSON.stringify([{ type: 'phone', value: '+54 11 4567-8901' }]),
    addressInfo: null, familyMembers: '2 niños', notes: null,
    createdAt: null, updatedAt: null, status: '5', addedBy: 'x@y.com',
    sourceUrl: null, country: 'AR', tokenHash: null, deletedAt: null,
    source: 'manual', isPublic: 0, isDemo: 0,
} as AdopterRow;

const enrichment: MatchEnrichment = {
    avgRating: 4, thumbnail: null,
    stats: { searchHits: 0, profileViews: 1, requests: 2, adoptions: 3 },
    flags: { inaccurate: false, duplicate: false, systemDuplicate: false, verified_identity: false, verified_address: false, tooManyAdoptions: null, tooManyRequests: null },
};
const meta = (snippetField?: 'contact' | 'history'): MatchMeta => ({
    relevancePercent: 90, matchTypes: ['name'], matchValues: [], source: 'like',
    matchSnippet: snippetField ? { field: snippetField, snippet: 'secret', highlights: [{ start: 0, end: 6 }] } : null,
});
const nothingMasked: Visibility = { ...NO_ACCESS_VISIBILITY, tier: 'full', nothingMasked: true };

describe('assembleDiscoveryMatch', () => {
    it('does not mask when visibility is undefined (gating off)', () => {
        const m = assembleDiscoveryMatch(row, enrichment, meta());
        expect(m.adopter.contactInfo).toContain('4567-8901');
        expect(m.adopter.familyMembers).toBe('2 niños');
        expect(m.avgRating).toBe(4);
        expect(m.stats.adoptions).toBe(3);
    });

    it('does not mask a nothing-masked (privileged) viewer', () => {
        expect(assembleDiscoveryMatch(row, enrichment, meta(), nothingMasked).adopter.contactInfo).toContain('4567-8901');
    });

    it('does not mask when adopterIsPublic is set', () => {
        const m = assembleDiscoveryMatch(row, enrichment, meta(), NO_ACCESS_VISIBILITY, undefined, { adopterIsPublic: true });
        expect(m.adopter.contactInfo).toContain('4567-8901');
    });

    it('masks contact + hides family for a no-access viewer (name stays full)', () => {
        const m = assembleDiscoveryMatch(row, enrichment, meta(), NO_ACCESS_VISIBILITY);
        expect(m.adopter.contactInfo).toContain('•');
        expect(m.adopter.contactInfo).not.toContain('4567-8901');
        expect(m.adopter.familyMembers).toBeNull();
        expect(m.adopter.name).toBe('María García'); // names are not gated
        expect(m.adopterName).toBe('María García');
    });

    it('scrubs a contact/address/adoption snippet once masked, keeps others', () => {
        expect(assembleDiscoveryMatch(row, enrichment, meta('contact'), NO_ACCESS_VISIBILITY).matchSnippet?.snippet).toBe('');
        expect(assembleDiscoveryMatch(row, enrichment, meta('history'), NO_ACCESS_VISIBILITY).matchSnippet?.snippet).toBe('secret');
    });
});
