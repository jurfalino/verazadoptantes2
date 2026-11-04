/**
 * Who stands behind a profile, and what kind of history row their writes make.
 *
 * "Privileged" on a profile = its owner (case-insensitive) ∨ a teammate of the
 * owner (org-mate) ∨ an admin ∨ a moderator — the same set the visibility
 * resolver treats as fully privileged, `loadApprovers` counts as editors and the
 * household actions let edit anything.
 *
 * A privileged write is an `adopter_history` kind='edit'; anyone else's is a
 * kind='contribution'. Old deployments still running beside a new one (deploy
 * skew: forwarded tabs, direct *.pages.dev URLs) count ANY kind='edit' writer as
 * an approver of the profile — so every path open to a non-privileged actor
 * (flagging, logging or editing their own activity record, deleting their own
 * image, a merge into someone else's profile, voiding an API record) must write
 * 'contribution' for them. Kept out of a 'use server' file: these are helpers,
 * never browser-callable endpoints.
 */
import { eq } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { isRealActorEmail } from '@/lib/piiAccess';
import { isOrgMate } from '@/lib/orgMembership';
import { isModeratorOrAdminAsync } from '@/config/admins';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type HistoryKind = 'edit' | 'contribution';

const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/** Owner ∨ org-mate of the owner ∨ admin ∨ moderator. Sentinels and empty actors never are. */
export async function isPrivilegedOnProfile(actor: string | null | undefined, ownerEmail: string | null | undefined): Promise<boolean> {
    if (!isRealActorEmail(actor)) return false;
    if (isRealActorEmail(ownerEmail) && norm(actor) === norm(ownerEmail)) return true;
    const [team, staff] = await Promise.all([
        ownerEmail ? isOrgMate(actor, ownerEmail) : Promise.resolve(false),
        isModeratorOrAdminAsync(actor),
    ]);
    return team || staff;
}

/** The one rule: a privileged writer edits, anyone else contributes. */
export function historyKind(privileged: boolean): HistoryKind {
    return privileged ? 'edit' : 'contribution';
}

/**
 * The history kind for `actor` writing on profile `adopterId`, for callers that
 * have not loaded the profile. Fails toward 'contribution' (logged): a
 * contribution row grants nothing, an 'edit' row on an old build would.
 */
export async function historyKindFor(db: Db, adopterId: string, actor: string | null | undefined): Promise<HistoryKind> {
    try {
        const row = await db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!row) return 'contribution';
        return historyKind(await isPrivilegedOnProfile(actor, row.addedBy));
    } catch (e) {
        logger.warn('historyKindFor: privilege check failed, written as a contribution', {
            adopterId, actor, error: e instanceof Error ? e.message : String(e),
        });
        return 'contribution';
    }
}

/** Same, when the caller already has the owner's email. Never throws. */
export async function historyKindForOwner(actor: string | null | undefined, ownerEmail: string | null | undefined, ctx: Record<string, unknown> = {}): Promise<HistoryKind> {
    try {
        return historyKind(await isPrivilegedOnProfile(actor, ownerEmail));
    } catch (e) {
        logger.warn('historyKindForOwner: privilege check failed, written as a contribution', {
            ...ctx, actor, error: e instanceof Error ? e.message : String(e),
        });
        return 'contribution';
    }
}
