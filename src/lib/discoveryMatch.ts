/**
 * Shared assembly for a discovery search result. Both `findAdopters` (real
 * search) and the guided-walkthrough demo build a `DiscoveryMatch` by combining
 * an adopter row + enrichment (rating/flags/stats) + match metadata, then
 * applying the partial-reveal contact mask for the viewer. Centralizing it here
 * means the masking + object shape can't drift between the two paths.
 *
 * The legitimate difference between the two callers is only the ENRICHMENT
 * SOURCE — real search computes it from child tables via `enrichAdopters`; the
 * demo supplies an overlay (its records have no child rows). The assembly and
 * masking are identical, so they live here.
 */

import type { adopters } from '@/db/schema';
import type { AdopterFlags } from '@/types/adopter';
import type { DiscoveryMatch, MatchSnippet } from '@/app/actions/types';
import { maskAdopterContact, renderName, type Visibility, type MaskContactOptions } from './piiAccess';
import { computeVisibilityBadge } from '@/domain/visibilityBadge';

type AdopterRow = typeof adopters.$inferSelect;

export interface MatchEnrichment {
    avgRating: number | null;
    thumbnail: string | null;
    stats: { searchHits: number; profileViews: number; requests: number; adoptions: number };
    flags: AdopterFlags;
}

export interface MatchMeta {
    relevancePercent: number;
    matchTypes: string[];
    matchValues: Array<{ type: string; value: string }>;
    source: 'token' | 'like' | 'both';
    matchSnippet: MatchSnippet | null;
}

/**
 * Build a `DiscoveryMatch`, applying the contact mask when the viewer is
 * non-privileged. `visibility` undefined ⇒ no masking (PII gating off, or a
 * record the caller chose not to gate). Once masked, a contact/address/adoption
 * snippet is scrubbed (those are windows into the now-hidden blob). Names are
 * never masked (v2.22.x) — `renderName` returns them in full.
 */
export function assembleDiscoveryMatch(
    adopter: AdopterRow,
    enrichment: MatchEnrichment,
    meta: MatchMeta,
    visibility?: Visibility,
    query?: string,
    maskOpts: MaskContactOptions = {},
): DiscoveryMatch {
    let finalAdopter = adopter;
    let snippet = meta.matchSnippet;

    // The viewer has no access to this contact exactly when we mask it. Compute once
    // so the "Protegido" badge can't drift from what's actually hidden.
    const contactProtected = !!(visibility && !visibility.nothingMasked && !maskOpts.adopterIsPublic);
    // Mask computed once when protected — reused for the field-count check (badge)
    // AND the data scrub below, so we never call maskAdopterContact twice.
    const maskResult = contactProtected ? maskAdopterContact(adopter, visibility as Visibility, maskOpts) : null;

    // Tri-state visibility badge via the shared domain resolver, so the search
    // card mirrors the profile exactly. `visibility` undefined ⇒ gating off for
    // this record ⇒ no badge (same as the profile). Keyed on the positive
    // `nothingMasked` full-access signal: full access ⇒ green, any protected
    // record without full access ⇒ gray (a search-match unlock is partial, not
    // full, so it stays "Protegido"). Same inputs as the profile.
    const visibilityBadge = computeVisibilityBadge({
        isPublic: maskOpts.adopterIsPublic,
        gatingOn: !!visibility,
        hasFullAccess: visibility?.nothingMasked,
    });

    if (contactProtected && maskResult) {
        finalAdopter = {
            ...adopter,
            name: renderName(adopter.name, visibility, query, maskOpts),
            contactInfo: maskResult.contactInfo,
            contactEntries: maskResult.contactEntries,
            addressInfo: maskResult.addressInfo,
            householdMembers: maskResult.householdMembers, // masked household (was leaking raw)
            familyMembers: null, // PII — hidden from non-privileged viewers
        };
        if (snippet && (snippet.field === 'contact' || snippet.field === 'address' || snippet.field === 'adoption')) {
            snippet = { ...snippet, snippet: '', highlights: [] };
        }
    }

    return {
        adopterId: adopter.id,
        adopterName: adopter.name,
        relevancePercent: meta.relevancePercent,
        matchTypes: meta.matchTypes,
        matchValues: meta.matchValues,
        source: meta.source,
        adopter: finalAdopter,
        matchSnippet: snippet,
        contactProtected,
        visibilityBadge,
        avgRating: enrichment.avgRating,
        thumbnail: enrichment.thumbnail,
        stats: enrichment.stats,
        flags: enrichment.flags,
    };
}
