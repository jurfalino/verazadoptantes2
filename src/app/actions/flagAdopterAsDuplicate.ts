'use server';

import { getDb, getUser } from './_db';
import { flagAdopter } from './flags';
import { pairUnderReview } from '@/lib/pairVerdict';
import { FLAG_REASONS } from '@/domain/constants';
import { logger } from '@/lib/logger';

/**
 * Public server action invoked from <DuplicateHint>'s «Es la misma persona»
 * (in its «Ver perfil» window). Open to any authenticated user (matches the
 * "adds are open" collaborative model — flagging is contribution, not
 * mutation). The flag lands in `/admin/duplicates` under the
 * `userFlagged` feed for admin triage; admin can then dismiss or
 * merge from there.
 *
 * Segregation-of-duties rationale: non-admins should not be able to
 * unilaterally merge two profiles (the merge soft-deletes the
 * secondary record, possibly owned by another rescuer, without their
 * consent). Flagging surfaces the candidate without taking the
 * destructive action — the admin then weighs context the contributor
 * may not have.
 *
 * Thin wrapper over `flagAdopter` (reason=DUPLICATE, target=matched
 * adopter id). `flagAdopter` already inserts an adopter_flags row,
 * writes to adopter_history, audit-logs, and notifies admins and whoever
 * added each profile.
 *
 * Once per pair (case 5, «Ya está marcado para revisar»): when an open
 * duplicate flag (either direction) or a pending merge request already covers
 * the pair, nothing is written and nobody is told again — `already: true`
 * (with the open flag's id when there is one).
 */
export async function flagAdopterAsDuplicate(input: {
    currentAdopterId: string;
    matchedAdopterId: string;
    matchedAdopterName: string;
}): Promise<{ ok: true; flagId: string; already?: true } | { ok: false; error: string }> {
    const user = await getUser();
    if (!user) return { ok: false, error: 'unauthenticated' };

    const currentAdopterId = (input.currentAdopterId ?? '').trim();
    const matchedAdopterId = (input.matchedAdopterId ?? '').trim();
    if (!currentAdopterId || !matchedAdopterId) return { ok: false, error: 'invalid_input' };
    if (currentAdopterId === matchedAdopterId) return { ok: false, error: 'same_adopter' };

    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const review = await pairUnderReview(db, currentAdopterId, matchedAdopterId);
        if (review.flagId || review.requestPending) {
            logger.info('flagAdopterAsDuplicate: the pair is already up for review, no second flag', {
                currentAdopterId, matchedAdopterId, user, openFlag: !!review.flagId, requestPending: review.requestPending,
            });
            return { ok: true, flagId: review.flagId ?? '', already: true };
        }
        // Details payload captures provenance for admin review: which rescuer
        // raised the flag and what name the match had. Match values aren't
        // included to avoid re-logging PII the flag-bearer already knows.
        const details = `Marcado desde la búsqueda de duplicados — coincide con "${input.matchedAdopterName}"`;
        const res = await flagAdopter(currentAdopterId, FLAG_REASONS.DUPLICATE, details, matchedAdopterId);
        return { ok: true, flagId: res.id };
    } catch (e) {
        const errorId = logger.error('flagAdopterAsDuplicate failed', e instanceof Error ? e : new Error(String(e)), {
            currentAdopterId, matchedAdopterId, user,
        });
        return { ok: false, error: `internal_error:${errorId}` };
    }
}
