'use server';

/**
 * Spreadsheet import, «También coincide con» for rows that are byte-for-byte an
 * existing profile (matchFingerprints): the OTHER live profiles that carry one
 * of the row's emails, phones or document ids — exactly the API's exact-mode
 * lookup (findIdentifierHitsFor, Jon 2026-11-01). Names and socials never
 * count here. A few token lookups per row instead of the fuzzy engine's ~150
 * (EM review I3), batched so one call stays far under D1's per-invocation cap.
 */

import { getDb, getUser } from './_db';
import { isRealActorEmail } from '@/lib/piiAccess';
import { findIdentifierHitsFor, ownerCountry } from '@/lib/api/profiles';
import { logger } from '@/lib/logger';
import type { DuplicateMatch } from './types';

/** Rows per call: at most ~5 identifiers × 3 tokens + 2 profile reads each. */
const MAX_ROWS = 50;
const MAX_PER_TYPE = 5;
/** «También coincide con» lists up to 2 (the identical profile is the third). */
const MAX_OTHERS = 2;

export interface IdenticalRowIdentifiers {
    /** The caller's key for the row (its fingerprint). */
    key: string;
    /** The identical profile: never listed as «también coincide». */
    identicalId: string;
    phones: string[];
    emails: string[];
    ids: string[];
}

export type IdenticalRowsOtherMatchesResult =
    | { ok: true; others: Record<string, DuplicateMatch[]>; failed: string[] }
    | { ok: false; errorId: string };

const FIELD_TYPE = { email: 'email', phone: 'phone', documentId: 'id_number' } as const;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, MAX_PER_TYPE) : []);

export async function findIdenticalRowsOtherMatches(rows: IdenticalRowIdentifiers[]): Promise<IdenticalRowsOtherMatchesResult> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous: refused below */ }
    if (!isRealActorEmail(actor)) return { ok: false, errorId: 'unauth' };
    const list = Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [];
    // Identifiers are contacts: only counts are logged.
    const ctx = { actor, rows: list.length };
    if (list.length === 0) return { ok: true, others: {}, failed: [] };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const requestId = `sheet-${crypto.randomUUID().slice(0, 8)}`;
        // Phones are read with the rescuer's country, as the API reads them with the key owner's.
        const needsCountry = list.some(r => strings(r?.phones).length > 0);
        const country = needsCountry ? await ownerCountry(db, actor, requestId) : null;
        const others: Record<string, DuplicateMatch[]> = {};
        const failed: string[] = [];
        await Promise.all(list.map(async (r) => {
            const key = typeof r?.key === 'string' ? r.key : '';
            if (!key) return;
            const set = { phones: strings(r.phones), emails: strings(r.emails), documentIds: strings(r.ids) };
            if (!set.phones.length && !set.emails.length && !set.documentIds.length) { others[key] = []; return; }
            try {
                const hits = await findIdentifierHitsFor(db, set, requestId, country);
                others[key] = hits.candidates
                    .filter(c => c.profileId !== r.identicalId)
                    .slice(0, MAX_OTHERS)
                    .map(c => {
                        const on = hits.matchedOn.get(c.profileId) ?? [];
                        return { adopterId: c.profileId, adopterName: c.name, relevancePercent: 100, matchTypes: on.map(f => FIELD_TYPE[f]), matchValues: [], source: 'token' as const };
                    });
            } catch (e) {
                logger.warn('findIdenticalRowsOtherMatches: row lookup failed, «también coincide» missing for it', { ...ctx, requestId, error: e instanceof Error ? e.message : String(e) });
                failed.push(key);
            }
        }));
        return { ok: true, others, failed };
    } catch (e) {
        const errorId = logger.error('findIdenticalRowsOtherMatches failed', e, ctx);
        return { ok: false, errorId };
    }
}
