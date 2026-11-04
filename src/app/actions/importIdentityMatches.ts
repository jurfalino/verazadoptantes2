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
import { findPersonMatches } from '@/lib/identityMatch';
import { redactedError } from '@/lib/identityCandidates';
import { logger } from '@/lib/logger';
import type { VerdictReason } from '@/domain/identityVerdict';
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
        // Retrieval stays at the helper's default (5); the cap below is on what remains after filtering.
        const found = await findPersonMatches(db, {
            name: clean(row?.name),
            phones: list(row?.phones),
            emails: list(row?.emails),
            socials: list(row?.socials),
            documentIds: list(row?.documentIds),
        }, { actor, ctx });
        const matches: JudgedMatch[] = found.slice(0, MAX_MATCHES);
        return { ok: true, matches };
    } catch (e) {
        // Redacted: a query error escaping retrieval carries the row's phone / email / DNI in "params:".
        const errorId = logger.error('matchImportRow failed', redactedError(e), ctx);
        return { ok: false, errorId };
    }
}
