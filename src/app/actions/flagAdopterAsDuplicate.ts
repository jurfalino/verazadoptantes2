'use server';

import { getUser } from './_db';
import { flagAdopter } from './flags';
import { FLAG_REASONS } from '@/domain/constants';
import { logger } from '@/lib/logger';

/**
 * Public server action invoked from <DuplicateHint>'s "Marcar como
 * duplicados" button. Open to any authenticated user (matches the
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
 * writes to adopter_history, audit-logs, and notifies admins via push.
 */
export async function flagAdopterAsDuplicate(input: {
    currentAdopterId: string;
    matchedAdopterId: string;
    matchedAdopterName: string;
}): Promise<{ ok: true; flagId: string } | { ok: false; error: string }> {
    const user = await getUser();
    if (!user) return { ok: false, error: 'unauthenticated' };

    const currentAdopterId = (input.currentAdopterId ?? '').trim();
    const matchedAdopterId = (input.matchedAdopterId ?? '').trim();
    if (!currentAdopterId || !matchedAdopterId) return { ok: false, error: 'invalid_input' };
    if (currentAdopterId === matchedAdopterId) return { ok: false, error: 'same_adopter' };

    try {
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
