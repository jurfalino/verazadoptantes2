'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';
import { isRealActorEmail } from '@/lib/piiAccess';
import { searchFormDuplicates } from '@/lib/formDuplicates';
import { settleNotSamePerson } from '@/lib/notSamePerson';

const id64 = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 64) : '');
const TYPED = new Set(['phone', 'email', 'social', 'id']);

export type AnswerNotSamePersonResult =
    | { ok: true; recorded: number; asked: Array<{ otherName: string; ownerLabels: string[] }> }
    | { ok: false; error: 'not_authenticated' | 'invalid' | 'not_found' | 'failed'; errorId?: string };

/**
 * «No es esta persona» on the contact window, the post import and the new-profile
 * form (spec 2026-11-06, consistency rule): the same answer as «Mantener separados».
 *
 * Safe with arguments a stranger chooses: a session is required; `adopterId` must
 * be a live profile; the server re-runs the duplicate search for that profile (or
 * for the contact being `typed` on it) and only ids it offers count. Whether the
 * answer settles the pair or opens it for the owners is settleNotSamePerson's rule
 * (the person who loaded either profile, or an admin).
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
    const ctx = { actor, adopterId, rejected: rejectedIds.length, typed: typed?.type ?? null };
    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'failed', errorId: logger.error('answerNotSamePerson: no database', new Error('no db'), ctx) };
        const self = await db.select({ name: adopters.name, contactEntries: adopters.contactEntries })
            .from(adopters).where(and(eq(adopters.id, adopterId), isNull(adopters.deletedAt))).get() as { name: string; contactEntries: string | null } | undefined;
        if (!self) return { ok: false, error: 'not_found' };
        if (rejectedIds.length === 0) return { ok: true, recorded: 0, asked: [] };

        // What the screen searched with: the typed contact (the contact window), else the profile itself.
        let entries: Array<{ type: string; value: string }> = [];
        if (typed) entries = [typed];
        else {
            try { entries = JSON.parse(self.contactEntries || '[]'); } catch (e) {
                logger.warn('answerNotSamePerson: unreadable contact entries, searching by name only', { ...ctx, error: e instanceof Error ? e.message : String(e) });
            }
        }
        const of = (t: string) => entries.filter(e => e && e.type === t && typeof e.value === 'string').map(e => e.value);
        const offered = await searchFormDuplicates(
            { name: typed ? '' : self.name, phones: of('phone'), emails: of('email'), socials: of('social'), documentIds: of('id'), excludeAdopterId: adopterId },
            { limit: 20, allowContactOnly: true },
            async () => actor,
        );
        if (offered.failed) {
            return { ok: false, error: 'failed', errorId: logger.error('answerNotSamePerson: duplicate search failed, answer not saved', new Error('search failed'), ctx) };
        }
        const settled = await settleNotSamePerson(db, {
            actor, adopterId, rejectedIds,
            offered: offered.results.map(r => ({ adopterId: r.adopterId, matchTypes: r.matchTypes })), ctx,
        });
        logger.info('answerNotSamePerson: answered', { ...ctx, recorded: settled.recorded.length, asked: settled.asked.length, dropped: settled.dropped });
        return { ok: true, recorded: settled.recorded.length, asked: settled.asked.map(a => ({ otherName: a.otherName, ownerLabels: a.ownerLabels })) };
    } catch (e) {
        return { ok: false, error: 'failed', errorId: logger.error('answerNotSamePerson failed', e, ctx) };
    }
}
