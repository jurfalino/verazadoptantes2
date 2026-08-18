/**
 * Content fingerprint for exact-duplicate detection on import (design:
 * identical-record-dedup). A normalized, order-independent digest of an
 * adopter's IDENTIFYING content — name + every contact value. Two records that
 * hold the SAME information (regardless of which fields, formatting, accents,
 * case, or order) produce the SAME fingerprint, so the import can treat one as a
 * duplicate of the other and update instead of creating a copy.
 *
 * Computed on the fly (no stored column): the import builds it for each row and
 * for every existing candidate, so there's nothing to migrate or backfill and no
 * stale fingerprints. Pure — no DB/lib imports.
 *
 * NOT included: the activity (rating/date/motivo). Two rows for the SAME person
 * with DIFFERENT activities share a fingerprint on purpose — they're the same
 * person, and the merge adds the new activity rather than duplicating the person.
 */

function norm(s: string | null | undefined): string {
    return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
/** Phone → its digits (formatting-independent). */
function phoneDigits(s: string): string {
    return (s.match(/\d/g) ?? []).join('');
}
function uniqSorted(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean))).sort();
}

export interface FingerprintInput {
    name?: string | null;
    phones?: string[];
    emails?: string[];
    socials?: string[];
    ids?: string[];        // DNI / document numbers
    addresses?: string[];
}

/**
 * Canonical fingerprint string. Empty (`''`) when there's no content at all, OR
 * when there's a name but no contact identifier (phone/email/social/id/address) —
 * callers must treat an empty fingerprint as "no match" so two content-less rows,
 * or two same-named homonyms with no contact info, never collide.
 */
export function computeContentFingerprint(input: FingerprintInput): string {
    const name = norm(input.name);
    const phones = uniqSorted((input.phones ?? []).map(phoneDigits));
    const emails = uniqSorted((input.emails ?? []).map(norm));
    const socials = uniqSorted((input.socials ?? []).map(norm));
    const ids = uniqSorted((input.ids ?? []).map(v => v.replace(/\D/g, '') || norm(v)));
    const addresses = uniqSorted((input.addresses ?? []).map(norm));

    // A name alone is NOT enough to claim two records are "identical" (homonyms). Require at
    // least one contact identifier; a name-only record returns '' → treated as "no match" →
    // routed to review/create instead of auto-upsert into a possibly-different person.
    const hasContact = phones.length || emails.length || socials.length || ids.length || addresses.length;
    if (!hasContact) return '';

    return [
        `n:${name}`,
        `ph:${phones.join(',')}`,
        `em:${emails.join(',')}`,
        `so:${socials.join(',')}`,
        `id:${ids.join(',')}`,
        `ad:${addresses.join(',')}`,
    ].join('|');
}
