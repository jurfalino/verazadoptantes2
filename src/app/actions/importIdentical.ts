'use server';

/**
 * On-the-fly exact-duplicate detection for import: given the content fingerprints
 * of the rows to import, scan existing adopters, fingerprint each, and return
 * which incoming fingerprints match an existing record. One call per import — no
 * stored fingerprint column, no migration, no backfill. Catches identical records
 * regardless of which fields they carry (address-only included), because it scans
 * everything rather than relying on the fuzzy token index.
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters } from '@/db/schema';
import { isRealActorEmail } from '@/lib/piiAccess';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { computeContentFingerprint } from '@/domain/contentFingerprint';
import { logger } from '@/lib/logger';

const SCAN_LIMIT = 20000;

function groupContacts(contactEntriesJson: string | null | undefined) {
    const g: { phones: string[]; emails: string[]; socials: string[]; ids: string[]; addresses: string[] } =
        { phones: [], emails: [], socials: [], ids: [], addresses: [] };
    for (const e of deserializeContactEntries(contactEntriesJson)) {
        const v = e.value?.trim();
        if (!v) continue;
        if (e.type === 'phone') g.phones.push(v);
        else if (e.type === 'email') g.emails.push(v);
        else if (e.type === 'social') g.socials.push(v);
        else if (e.type === 'id') g.ids.push(v);
        else if (e.type === 'address') g.addresses.push(v);
    }
    return g;
}

/** Map: incoming fingerprint → the existing adopter that has identical content.
 *  Only fingerprints that matched are present. */
export type MatchFingerprintsResult =
    | { ok: true; map: Record<string, { adopterId: string; adopterName: string | null }> }
    | { ok: false; errorId: string };

export async function matchFingerprints(fingerprints: string[]): Promise<MatchFingerprintsResult> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return { ok: false, errorId: 'unauth' };
    const wanted = new Set(fingerprints.filter(Boolean));
    if (wanted.size === 0) return { ok: true, map: {} };
    try {
        const db = await getDb();
        if (!db) return { ok: false, errorId: 'nodb' };
        const rows = await db.select({ id: adopters.id, name: adopters.name, contactEntries: adopters.contactEntries })
            .from(adopters)
            .where(and(isNull(adopters.deletedAt), or(isNull(adopters.isDemo), eq(adopters.isDemo, 0))))
            .limit(SCAN_LIMIT);
        if (rows.length >= SCAN_LIMIT) {
            logger.warn('matchFingerprints: scan hit the cap — identical-detection may be incomplete', { scanned: rows.length, cap: SCAN_LIMIT });
        }
        const map: Record<string, { adopterId: string; adopterName: string | null }> = {};
        for (const r of rows) {
            const fp = computeContentFingerprint({ name: r.name, ...groupContacts(r.contactEntries) });
            if (fp && wanted.has(fp) && !map[fp]) map[fp] = { adopterId: r.id, adopterName: r.name };
        }
        return { ok: true, map };
    } catch (e) {
        const errorId = logger.error('matchFingerprints failed', e, { fingerprintCount: wanted.size });
        return { ok: false, errorId };
    }
}
