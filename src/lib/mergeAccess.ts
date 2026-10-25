/**
 * Access after a fold (spec 2026-10-25-pendientes-d D40). When a rescuer's
 * profile folds into another rescuer's, the absorbed profile's owner and their
 * team keep seeing what they had. How much depends on whether the survivor's
 * owner agreed:
 *   - `all_contact` — a consented fold: a request the owner team accepted or
 *     flipped, or an admin's merge / approval. The same fact an approved
 *     access request writes (src/app/actions/piiAccess.ts).
 *   - `absorbed_entries` — an immediate fold nobody on the survivor's team
 *     agreed to (a rescuer keeping the OTHER rescuer's profile, D24/D41/D43):
 *     only the contact values the absorbed profile itself brought, one
 *     `scope='entry'` grant each, keyed like verifyKnownInfo's grants by
 *     hashEntryValue — so the survivor's own contacts stay masked. Never
 *     `all_contact`: otherwise a throwaway profile flagged as a "duplicate"
 *     of anyone's would buy its owner full contact access to theirs.
 * Origin is 'merge' either way. A plain server module, NOT 'use server'.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { adopters, auditLog, piiAccessGrants } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getTeamEmails, normEmail } from '@/lib/orgMembership';
import { deserializeContactEntries, parseBlobToContactEntries } from '@/lib/contactEntries';
import { hashEntryValue } from '@/lib/piiAccess';
import { realOwner } from '@/domain/dedupPair';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type FoldAccess =
    | { scope: 'all_contact' }
    | { scope: 'absorbed_entries'; absorbedId: string };

/**
 * The entry hashes a profile's own contact values unlock: the same entries
 * maskAdopterContact masks (structured entries, else the legacy blob parsed),
 * minus the ones it never masks (aliases, notes, per-entry public ones).
 */
async function absorbedEntryHashes(db: Db, absorbedId: string): Promise<string[]> {
    const row = await db.select({ contactEntries: adopters.contactEntries, contactInfo: adopters.contactInfo })
        .from(adopters).where(eq(adopters.id, absorbedId)).get();
    if (!row) throw new Error('absorbed profile not found');
    const parsed = deserializeContactEntries(row.contactEntries);
    const entries = parsed.length > 0 ? parsed : parseBlobToContactEntries(row.contactInfo);
    return [...new Set(entries
        .filter(e => e.type !== 'alias' && e.type !== 'other' && !e.isPublic)
        .map(e => hashEntryValue(e.type, e.value)))];
}

/**
 * Grant the absorbed profile's owner and each teammate access to the survivor
 * (`access`: how much, see the module comment — every caller must choose).
 * Nobody already on the survivor owner's team (they see it anyway), and no
 * grant a grantee already holds live (an `all_contact`, or the same entry).
 * Best-effort: the merge already happened, so a failure is logged and never
 * thrown. Returns how many grants were written and kept.
 *
 * `mergeAuditId` (the merge's audit_log row, MergeAdoptersResult.auditId):
 * the ids written are appended to that row's details as `grantIds`, so
 * undoing the merge (unmergeAdopters) revokes exactly these grants — never one
 * that existed before the merge. A failure part-way (or while recording) never
 * leaves a live grant undo can't find: the ids written so far are recorded,
 * and if even that fails they are revoked.
 */
export async function grantAccessAfterFold(db: Db, input: {
    survivorId: string;
    absorbedOwnerEmail: string | null;
    actor: string;
    access: FoldAccess;
    mergeAuditId?: string | null;
}): Promise<number> {
    const { survivorId, actor, mergeAuditId, access } = input;
    const absorbedOwner = realOwner(input.absorbedOwnerEmail) ? normEmail(input.absorbedOwnerEmail) : null;
    if (!absorbedOwner) return 0;
    const ctx = { survivorId, absorbedOwnerEmail: absorbedOwner, actor, mergeAuditId, scope: access.scope };
    const grantIds: string[] = [];
    try {
        const survivor = await db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, survivorId)).get();
        const survivorOwner = realOwner(survivor?.addedBy) ? normEmail(survivor!.addedBy) : null;
        if (survivorOwner === absorbedOwner) return 0;

        const [absorbedTeam, survivorTeam, entryHashes] = await Promise.all([
            getTeamEmails(absorbedOwner),
            survivorOwner ? getTeamEmails(survivorOwner) : Promise.resolve([] as string[]),
            access.scope === 'absorbed_entries' ? absorbedEntryHashes(db, access.absorbedId) : Promise.resolve([] as string[]),
        ]);
        const alreadySees = new Set(survivorTeam.map(normEmail));
        const grantees = [...new Set([absorbedOwner, ...absorbedTeam.map(normEmail)])].filter(e => e && !alreadySees.has(e));
        // What to write per grantee: one all_contact, or one entry grant per hash.
        const wanted: Array<{ scope: 'all_contact' | 'entry'; entryRef: string | null }> = access.scope === 'all_contact'
            ? [{ scope: 'all_contact', entryRef: null }]
            : entryHashes.map(h => ({ scope: 'entry' as const, entryRef: h }));
        if (wanted.length === 0) return 0;

        for (const granteeEmail of grantees) {
            const live = await db.select({ scope: piiAccessGrants.scope, entryRef: piiAccessGrants.entryRef }).from(piiAccessGrants).where(and(
                eq(piiAccessGrants.adopterId, survivorId),
                eq(piiAccessGrants.granteeEmail, granteeEmail),
                isNull(piiAccessGrants.revokedAt),
            )).all() as Array<{ scope: string; entryRef: string | null }>;
            if (live.some(g => g.scope === 'all_contact')) continue;
            const heldEntries = new Set(live.filter(g => g.scope === 'entry' && g.entryRef).map(g => g.entryRef));
            for (const w of wanted) {
                if (w.scope === 'entry' && heldEntries.has(w.entryRef)) continue;
                const id = crypto.randomUUID();
                await db.insert(piiAccessGrants).values({
                    id,
                    adopterId: survivorId,
                    granteeEmail,
                    scope: w.scope,
                    entryRef: w.entryRef,
                    origin: 'merge',
                    requestId: null,
                    grantedByEmail: actor,
                    createdAt: new Date(),
                });
                grantIds.push(id);
            }
        }
        if (grantIds.length) logger.info('grantAccessAfterFold: granted', { ...ctx, grants: grantIds.length });
        if (mergeAuditId && grantIds.length) await recordGrantsOnMerge(db, mergeAuditId, grantIds);
        return grantIds.length;
    } catch (e) {
        logger.warn('grantAccessAfterFold: access not granted', {
            ...ctx, grantsWritten: grantIds.length, grantIds, error: e instanceof Error ? e.message : String(e),
        });
        if (!grantIds.length) return 0;
        return await keepOrRevokeWritten(db, grantIds, { ...ctx, mergeAuditId: mergeAuditId ?? null });
    }
}

/**
 * After a failure part-way: the grants already written stay only if the merge's
 * undo can find them (recorded on its audit row); otherwise each is revoked.
 * Returns how many stay live.
 */
async function keepOrRevokeWritten(db: Db, grantIds: string[], ctx: Record<string, unknown> & { mergeAuditId: string | null; actor: string }): Promise<number> {
    if (ctx.mergeAuditId) {
        try {
            await recordGrantsOnMerge(db, ctx.mergeAuditId, grantIds);
            return grantIds.length;
        } catch (e) {
            logger.warn('grantAccessAfterFold: written grants not recorded for undo — revoking them', {
                ...ctx, grantIds, error: e instanceof Error ? e.message : String(e),
            });
        }
    } else {
        // No audit row to record on: nothing could ever undo them.
        logger.warn('grantAccessAfterFold: no merge audit id — revoking the grants written', { ...ctx, grantIds });
    }
    let left = 0;
    for (const id of grantIds) {
        try {
            await db.update(piiAccessGrants).set({ revokedAt: new Date(), revokedByEmail: ctx.actor }).where(eq(piiAccessGrants.id, id));
        } catch (e) {
            left++;
            logger.error('grantAccessAfterFold: a written grant could not be revoked', e, { ...ctx, grantId: id });
        }
    }
    return left;
}

/** Append the grant ids to the merge's audit details (`grantIds`), for its undo. Throws on a DB error. */
async function recordGrantsOnMerge(db: Db, mergeAuditId: string, grantIds: string[]): Promise<void> {
    const row = await db.select({ details: auditLog.details }).from(auditLog).where(eq(auditLog.id, mergeAuditId)).get();
    if (!row) throw new Error('merge audit row not found');
    const details = JSON.parse(row.details || '{}') as { grantIds?: string[] };
    const next = { ...details, grantIds: [...(details.grantIds ?? []), ...grantIds] };
    await db.update(auditLog).set({ details: JSON.stringify(next) }).where(eq(auditLog.id, mergeAuditId));
}
