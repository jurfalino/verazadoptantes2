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

describe('assembleDiscoveryMatch — public record, logged-out viewer', () => {
    // Regression for the prod report "protected label but data unmasked" on a
    // public record. The search used to derive the public-profiles flag from
    // `piiGatingOn`, which is forced false for a logged-out viewer, so `isPublic`
    // was never consulted on that path and every card came back "Protegido".
    // The assembler itself is correct given the right maskOpts; this pins that
    // NO_ACCESS_VISIBILITY + adopterIsPublic yields Público, contact in the open.
    const publicRow = { ...row, isPublic: 1 } as AdopterRow;

    it('is Público with contact in the open when the record is public', () => {
        const m = assembleDiscoveryMatch(publicRow, enrichment, meta(), NO_ACCESS_VISIBILITY, 'maría', { adopterIsPublic: true });
        expect(m.visibilityBadge).toBe('public');
        expect(m.adopter.contactInfo).toContain('4567-8901');
    });

    it('stays Protegido and masked when the public flag is NOT honored', () => {
        // What the logged-out search produced before the fix: the record IS
        // public but maskOpts said otherwise, so the badge and the data disagreed
        // with the profile page, which reads the flag unconditionally.
        const m = assembleDiscoveryMatch(publicRow, enrichment, meta(), NO_ACCESS_VISIBILITY, 'maría', { adopterIsPublic: false });
        expect(m.visibilityBadge).toBe('protected-locked');
        expect(m.adopter.contactInfo).not.toContain('4567-8901');
    });

    it('a protected record stays Protegido for a logged-out viewer', () => {
        // The fix must not widen anything: honoring the flag only matters when
        // the row itself is public.
        const m = assembleDiscoveryMatch(row, enrichment, meta(), NO_ACCESS_VISIBILITY, 'maría', { adopterIsPublic: false });
        expect(m.visibilityBadge).toBe('protected-locked');
        expect(m.adopter.contactInfo).not.toContain('4567-8901');
    });
});
