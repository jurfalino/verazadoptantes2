'use server';

import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';
import { isRealActorEmail } from '@/lib/piiAccess';
import { answerNotSamePersonFor, type AnswerNotSamePersonResult } from '@/lib/notSamePerson';

const id64 = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 64) : '');
const TYPED = new Set(['phone', 'email', 'social', 'id']);


/**
 * «No es esta persona» on the contact window, the post import and the new-profile
 * form (spec 2026-11-06, consistency rule): the same answer as «Mantener separados».
 *
 * Safe with arguments a stranger chooses: a session is required; `adopterId` must
 * be a live profile; the server re-runs the duplicate search for the given input —
 * the profile's own data, or the contact being `typed` on it — and only ids that
 * search offers count. That proves the other profile looks like the INPUT, not
 * necessarily like `adopterId`, so with `typed` only whoever loaded `adopterId` (or
 * an admin) settles; anyone else only opens the pair for the owners, which is no
 * more than «Marcar como posible duplicado» already allows. Without `typed`, whoever
 * loaded either profile settles (settleNotSamePerson).
 */
export async function answerNotSamePerson(input: {
    adopterId: string;
    rejectedIds: string[];
    typed?: { type: 'phone' | 'email' | 'social' | 'id'; value: string };
}): Promise<AnswerNotSamePersonResult> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous: refused below */ }
    if (!isRealActorEmail(actor)) return { ok: false, error: 'not_authenticated' };
    const adopterId = id64(input?.adopterId);
    if (!adopterId || !Array.isArray(input?.rejectedIds)) return { ok: false, error: 'invalid' };
    const rejectedIds = [...new Set(input.rejectedIds.map(id64).filter(id => id && id !== adopterId))].slice(0, 10);
    const typed = input.typed && TYPED.has(input.typed.type) && typeof input.typed.value === 'string' && input.typed.value.trim()
        ? { type: input.typed.type, value: input.typed.value.trim().slice(0, 200) } : null;
    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'failed', errorId: logger.error('answerNotSamePerson: no database', new Error('no db'), { actor, adopterId }) };
        return await answerNotSamePersonFor(db, actor, { adopterId, rejectedIds, typed });
    } catch (e) {
        return { ok: false, error: 'failed', errorId: logger.error('answerNotSamePerson failed', e, { actor, adopterId }) };
    }
}
