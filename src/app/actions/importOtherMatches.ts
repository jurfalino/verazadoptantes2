'use server';

/**
 * Spreadsheet import, «También coincide con» for rows that are byte-for-byte an
 * existing profile (matchFingerprints): the OTHER live profiles that carry one
 * of the row's emails, phones or document ids — exactly the API's exact-mode
 * lookup (findIdentifierHitsFor, Jon 2026-11-01). Names and socials never
 * count here. A few token lookups per row instead of the fuzzy engine's ~150
 * (EM review I3). One call stays under QUERY_BUDGET D1 queries (Workers allow
 * 1,000 per invocation): rows that don't fit come back as `deferred`, and the
 * caller sends them again.
 */

import { getDb, getUser } from './_db';
import { isRealActorEmail } from '@/lib/piiAccess';
import { findIdentifierHitsFor, identifierQueryCount, ownerCountry } from '@/lib/api/profiles';
import { logger } from '@/lib/logger';
import type { DuplicateMatch } from './types';

const MAX_ROWS = 50;
const MAX_PER_TYPE = 3;
/** D1 queries one call may issue: token lookups plus profile reads, counted before each row runs. */
const QUERY_BUDGET = 400;
/** Hit profiles read per row (the best-matched first): the identical one, the 2 listed, and spares for deleted ones. */
const MAX_PROFILES_PER_ROW = 6;
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
    /** `deferred`: rows over this call's query budget, not checked — send them again. */
    | { ok: true; others: Record<string, DuplicateMatch[]>; failed: string[]; deferred: string[] }
    | { ok: false; errorId: string };

const FIELD_TYPE = { email: 'email', phone: 'phone', documentId: 'id_number', social: 'social_handle' } as const;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, MAX_PER_TYPE) : []);

export async function findIdenticalRowsOtherMatches(rows: IdenticalRowIdentifiers[]): Promise<IdenticalRowsOtherMatchesResult> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous: refused below (getUser logs its own failures) */ }
    if (!isRealActorEmail(actor)) return { ok: false, errorId: 'unauth' };
    const list = Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [];
    // Identifiers are contacts: only counts are logged.
    const ctx = { actor, rows: list.length };
    if (list.length === 0) return { ok: true, others: {}, failed: [], deferred: [] };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const requestId = `sheet-${crypto.randomUUID().slice(0, 8)}`;
        // Phones are read with the rescuer's country, as the API reads them with the key owner's.
        const needsCountry = list.some(r => strings(r?.phones).length > 0);
        const country = needsCountry ? await ownerCountry(db, actor, requestId) : null;
        const others: Record<string, DuplicateMatch[]> = {};
        const failed: string[] = [];
        const deferred: string[] = [];
        // Budget first, then run what fits in parallel: each row's cost is bounded before it runs.
        const run: Array<{ key: string; identicalId: string; set: { phones: string[]; emails: string[]; documentIds: string[] } }> = [];
        let budget = QUERY_BUDGET;
        for (const r of list) {
            const key = typeof r?.key === 'string' ? r.key : '';
            if (!key) continue;
            const set = { phones: strings(r.phones), emails: strings(r.emails), documentIds: strings(r.ids) };
            if (!set.phones.length && !set.emails.length && !set.documentIds.length) { others[key] = []; continue; }
            const cost = identifierQueryCount(set, country, MAX_PROFILES_PER_ROW);
            if (cost > budget && run.length > 0) { deferred.push(key); continue; }
            budget -= cost;
            run.push({ key, identicalId: typeof r.identicalId === 'string' ? r.identicalId : '', set });
        }
        await Promise.all(run.map(async ({ key, identicalId, set }) => {
            try {
                const hits = await findIdentifierHitsFor(db, set, requestId, country, { maxProfiles: MAX_PROFILES_PER_ROW });
                const strength = (id: string) => hits.matchedOn.get(id)?.length ?? 0;
                others[key] = hits.candidates
                    .filter(c => c.profileId !== identicalId)
                    .sort((a, b) => strength(b.profileId) - strength(a.profileId))
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
        if (deferred.length) logger.info('findIdenticalRowsOtherMatches: over the query budget, rows deferred', { ...ctx, requestId, deferred: deferred.length });
        return { ok: true, others, failed, deferred };
    } catch (e) {
        const errorId = logger.error('findIdenticalRowsOtherMatches failed', e, ctx);
        return { ok: false, errorId };
    }
}
