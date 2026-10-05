/**
 * Candidate summaries for the interview UI. Built ONLY from the masked
 * DiscoveryMatch that findFormDuplicates / hydrateDuplicateMatches return,
 * so a protected value never reaches the browser (spec §4.4). A masked
 * blob is never parsed (it would look like real values).
 */
import type { DiscoveryMatch } from '@/app/actions/types';
import { deserializeContactEntries, parseBlobToContactEntries, type ContactEntry } from '@/lib/contactEntries';
import type { CandidateSummary, VerifiableFact } from '@/domain/interview/types';

const ENTRY_FACT: Partial<Record<ContactEntry['type'], VerifiableFact>> = { phone: 'phones', email: 'emails', social: 'socials', address: 'address' };

export function toCandidateSummary(m: DiscoveryMatch, opts: { viewerIsAdmin: boolean }): CandidateSummary {
    const a = m.adopter;
    let entries = deserializeContactEntries(a.contactEntries);
    if (!entries.length && !m.contactProtected && a.contactInfo) entries = parseBlobToContactEntries(a.contactInfo);

    const stored = new Set<VerifiableFact>();
    const visible: Partial<Record<VerifiableFact, string[]>> = {};
    for (const e of entries) {
        const f = ENTRY_FACT[e.type];
        if (!f) continue;
        stored.add(f);
        if (!e.masked && !(f === 'address' && m.contactProtected)) (visible[f] ??= []).push(e.value);
    }
    if (a.addressInfo && a.addressInfo.trim()) {
        stored.add('address');
        if (!m.contactProtected) (visible.address ??= []).push(a.addressInfo.trim());
    }

    return {
        adopterId: m.adopterId,
        displayName: a.name || '',
        relevancePercent: m.relevancePercent,
        avgRating: m.avgRating,
        adoptionCount: m.stats?.adoptions ?? 0,
        canEdit: opts.viewerIsAdmin || m.ownership === 'mine' || m.ownership === 'team',
        stored: [...stored].sort(),
        visible,
    };
}

/** Raw profile values for a fact. SERVER-ONLY: the result must never be returned to a client. */
export function storedFactValues(
    row: { contactEntries: string | null; contactInfo: string | null; addressInfo: string | null },
    fact: VerifiableFact,
): string[] {
    let entries = deserializeContactEntries(row.contactEntries);
    if (!entries.length && row.contactInfo) entries = parseBlobToContactEntries(row.contactInfo);
    const values = entries.filter(e => ENTRY_FACT[e.type] === fact).map(e => e.value);
    if (fact === 'address' && row.addressInfo?.trim()) values.push(row.addressInfo.trim());
    return values;
}
