/**
 * «Ya está en otro perfil» (DuplicateHint) — what the window may offer for a
 * match, read from the database. One reader for the hint
 * (getDuplicateHintMatches) and for every action the window leads to
 * (continueWithMatchedProfile, askAdminsToReviewPair, flagAdopterAsDuplicate's
 * «already»), so the window and the server can't disagree. The rule itself is
 * pure: decideDupHintAction / dupHintMergePlan (src/domain/dupHint.ts).
 *
 * - `loadDupHintViewer`: once per call — the viewer's admin standing and
 *   team, and the profile being edited (CURRENT) with whether it is the
 *   team's (isOwnerOrOrgMate, as mergePendingDedupPair decides it).
 * - `decideDupHintMatch`: per match — what has been said about the pair
 *   (loadPairVerdict), whether it is already up for review (pairUnderReview),
 *   whether the match is the team's.
 * - `ratingsOf`: a profile's record ratings (the `adoptions` rows the rating
 *   averages over), for the rating after a merge.
 *
 * A plain server module, NOT 'use server'. Every read throws on a DB error:
 * the caller logs it with its context and decides.
 */
import { eq } from 'drizzle-orm';
import { adopters, adoptions } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { isAdminAsync } from '@/config/admins';
import { isOwnerOrOrgMate } from '@/lib/orgMembership';
import { loadPairVerdict, pairUnderReview, teamOf } from '@/lib/pairVerdict';
import { realOwner } from '@/domain/dedupPair';
import { decideDupHintAction, type DupHintAction } from '@/domain/dupHint';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type DupHintProfileRow = {
    id: string;
    name: string | null;
    addedBy: string | null;
    deletedAt: Date | null;
    contactEntries: string | null;
    contactInfo: string | null;
};

export interface DupHintViewer {
    actor: string;
    isAdmin: boolean;
    team: string[];
    /** The profile being edited; null when it doesn't exist or was merged away. */
    current: DupHintProfileRow | null;
    currentTeamOwned: boolean;
}

export async function profileRow(db: Db, id: string): Promise<DupHintProfileRow | null> {
    const row = await db.select({
        id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, deletedAt: adopters.deletedAt,
        contactEntries: adopters.contactEntries, contactInfo: adopters.contactInfo,
    }).from(adopters).where(eq(adopters.id, id)).get() as DupHintProfileRow | undefined;
    return row ?? null;
}

export async function loadDupHintViewer(db: Db, actor: string, currentId: string): Promise<DupHintViewer> {
    const [isAdmin, team, row] = await Promise.all([
        isAdminAsync(actor),
        teamOf(actor),
        currentId ? profileRow(db, currentId) : Promise.resolve(null),
    ]);
    const current = row && !row.deletedAt ? row : null;
    const currentTeamOwned = !!current && await isOwnerOrOrgMate(actor, current.addedBy);
    return { actor, isAdmin, team, current, currentTeamOwned };
}

export interface DupHintMatchDecision {
    action: DupHintAction;
    /** An open duplicate flag or a pending request already covers the pair («Ya está marcado para revisar.»). */
    alreadyPending: boolean;
    /** The open duplicate flag on the pair, if any. */
    flagId: string | null;
    matchTeamOwned: boolean;
}

/** What the window offers for this match (needs a saved CURRENT). */
export async function decideDupHintMatch(
    db: Db,
    viewer: DupHintViewer & { current: DupHintProfileRow },
    match: { id: string; addedBy: string | null },
): Promise<DupHintMatchDecision> {
    const [verdict, review, matchTeamOwned] = await Promise.all([
        loadPairVerdict(db, viewer.current.id, match.id, viewer.team),
        pairUnderReview(db, viewer.current.id, match.id),
        isOwnerOrOrgMate(viewer.actor, match.addedBy),
    ]);
    const pending = !!review.flagId || review.requestPending;
    const action = decideDupHintAction({
        isAdmin: viewer.isAdmin,
        currentTeamOwned: viewer.currentTeamOwned,
        matchHasOwner: !!realOwner(match.addedBy),
        declinedForTeam: verdict.declinedForTeam,
        adminRuledSeparate: verdict.adminRuledSeparate,
        pending,
    });
    return { action, alreadyPending: pending, flagId: review.flagId, matchTeamOwned };
}

/** Every record's rating on this profile (null = not rated): what the profile's average is computed from. */
export async function ratingsOf(db: Db, adopterId: string): Promise<Array<{ rating: number | null }>> {
    return await db.select({ rating: adoptions.rating }).from(adoptions).where(eq(adoptions.adopterId, adopterId)).all() as Array<{ rating: number | null }>;
}
