'use server';

/**
 * Spreadsheet import: the identity verdict for ONE sheet row — which existing
 * profiles are the same person (`same`) or may be (`possible`), judged by the
 * shared domain rules (src/domain/identityVerdict.ts) over the candidates
 * src/lib/identityCandidates.ts retrieves. Spec:
 * docs/superpowers/specs/2026-11-02-identity-verdict-design.md.
 */

import { getDb, getUser } from './_db';
import { isRealActorEmail } from '@/lib/piiAccess';
import { ownerCountry } from '@/lib/api/profiles';
import { judgeCandidates } from '@/lib/identityCandidates';
import { logger } from '@/lib/logger';
import type { PersonFacts, VerdictReason } from '@/domain/identityVerdict';
import type { DuplicateMatch } from './types';

const MAX_VALUES = 5;
const MAX_CHARS = 200;
const MAX_MATCHES = 3;

export interface ImportRowIdentity { name: string; phones: string[]; emails: string[]; socials: string[]; documentIds: string[] }
export interface JudgedMatch extends DuplicateMatch { verdict: 'same' | 'possible'; reason: VerdictReason | null }

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, MAX_CHARS) : '');
const list = (v: unknown): string[] =>
    (Array.isArray(v) ? v.map(clean).filter(Boolean).slice(0, MAX_VALUES) : []);

export async function matchImportRow(row: ImportRowIdentity): Promise<{ ok: true; matches: JudgedMatch[] } | { ok: false; errorId: string }> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous: refused below (getUser logs its own failures) */ }
    if (!isRealActorEmail(actor)) return { ok: false, errorId: 'unauth' };
    // Names and contacts are never logged.
    const ctx = { actor };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const facts: PersonFacts = {
            name: clean(row?.name),
            aliases: [],
            phones: list(row?.phones),
            emails: list(row?.emails),
            socials: list(row?.socials),
            documentIds: list(row?.documentIds),
            country: null,
        };
        if (facts.phones.length > 0) {
            // Phones are read with the rescuer's country, as the sibling lookup does.
            try {
                facts.country = await ownerCountry(db, actor, `sheet-${crypto.randomUUID().slice(0, 8)}`);
            } catch (e) {
                logger.warn('matchImportRow: country lookup failed, phones read without country', { actor, error: e instanceof Error ? e.message : String(e) });
            }
        }
        const judged = await judgeCandidates(db, facts, ctx);
        const matches: JudgedMatch[] = [];
        for (const j of judged) {
            if (j.verdict !== 'same' && j.verdict !== 'possible') continue;
            const c = j.candidate;
            matches.push({
                adopterId: c.adopterId, adopterName: c.name, relevancePercent: c.relevancePercent,
                matchTypes: c.matchTypes, matchValues: c.matchValues, source: c.source,
                verdict: j.verdict, reason: j.reason,
            });
            if (matches.length >= MAX_MATCHES) break;
        }
        return { ok: true, matches };
    } catch (e) {
        const errorId = logger.error('matchImportRow failed', e, ctx);
        return { ok: false, errorId };
    }
}
