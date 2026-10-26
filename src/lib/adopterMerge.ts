/**
 * Adopter merge / unmerge mechanics. A plain server module, NOT 'use server':
 * these take ids and an actor email and check NO session or ownership — "auth
 * is the caller's responsibility". As exports of src/app/actions/duplicates.ts
 * they were browser-callable endpoints (and PendingDedup shipped mergeAdopters'
 * id to every browser), so anyone could merge any two profiles. Callers:
 *   - /api/admin/duplicates/merge, /unmerge — admin-checked routes;
 *   - linkFormToExistingAdopter, attachContractToExistingAdopter — their own
 *     ownership + recorded-match checks;
 *   - mergePendingDedupPair — the session-checked action PendingDedup uses.
 */

import { adopters, adoptions, adopterImages, adopterFlags, adopterHistory, adopterStats, duplicateTokens, duplicateCandidates, auditLog, placements, adopterEvents, formSubmissions, piiAccessGrants } from '@/db/schema';
import { eq, or, and, gt, ne, sql, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getDb } from '@/lib/db';
import { reassignAdopterRecords } from '@/app/actions/_recordWrite';
import { normalizeText } from '@/lib/tokenizer';
import { deserializeContactEntries, mergeContactEntries } from '@/lib/contactEntries';
import { deserializeHouseholdMembers, serializeHouseholdMembers, mergeHouseholdMembers, mergeHouseholdMembersTracked, undoHouseholdMerge } from '@/lib/householdMembers';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { casAdopterLists } from '@/lib/adopterListCas';
import { MERGED_FLAG_DETAILS_PREFIX } from '@/domain/dedupPair';
import { closeRequestsForAdopter } from '@/lib/mergeRequestClose';
import { mergeSideParams } from '@/lib/mergeNotificationSides';
import { notificationContent } from '@/domain/notificationTemplates';
import { rowsAffected } from '@/lib/interviews/rowsAffected';
import { moveHouseholdLinksOnMerge, notifyDisputesAfterMerge, relinkRestoredHost, restoreHouseholdLinks, type MovedHouseholdLink, type MovedHouseholdLinkCorrection } from '@/lib/householdLinks';

export interface MergeAdoptersResult {
    success: boolean;
    error?: string;
    mergeDetails?: Record<string, number>;
    primaryName?: string;
    secondaryName?: string;
    /** Who registered each profile (for the optional owner notification). */
    primaryAddedBy?: string | null;
    secondaryAddedBy?: string | null;
    /** audit_log row id of this merge — the handle unmergeAdopters takes. */
    auditId?: string;
}

/**
 * Merge two adopter profiles: re-point all related records (adoptions, images, flags,
 * history, stats) from the secondary onto the primary, append text fields with separators,
 * soft-delete the secondary, clean up its duplicate_tokens, and write an audit_log entry.
 *
 * Shared by:
 *  - /api/admin/duplicates/merge (admin-triggered merge of any two profiles)
 *  - attachContractToExistingAdopter (rescuer-triggered merge of contract orphan into matched profile)
 *
 * Auth is the caller's responsibility — this function only runs the merge mechanics.
 */
export async function mergeAdopters(
    primaryId: string,
    secondaryId: string,
    actorEmail: string,
): Promise<MergeAdoptersResult> {
    // Set once this merge has claimed the pair (soft-deleted the secondary), until
    // its audit row exists: a failure in between gives the secondary back.
    let restoreSecondary: (() => Promise<void>) | null = null;
    // Likewise for the household links / corrections step 6d moved (D51).
    let revertHouseholdLinks: (() => Promise<void>) | null = null;
    try {
        if (!primaryId || !secondaryId || primaryId === secondaryId) {
            return { success: false, error: 'Invalid merge request' };
        }

        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available' };

        const [primary, secondary] = await Promise.all([
            db.select().from(adopters).where(eq(adopters.id, primaryId)).get(),
            db.select().from(adopters).where(eq(adopters.id, secondaryId)).get(),
        ]);

        if (!primary || !secondary) {
            return { success: false, error: 'One or both adopters not found' };
        }
        if (primary.deletedAt || secondary.deletedAt) {
            return { success: false, error: 'Cannot merge already-deleted profiles' };
        }

        // 0. Claim the pair before moving anything: ONE statement soft-deletes
        // the secondary only while it AND the primary are still live. Two merges
        // of the same pair at once (two answers to two requests, an admin and a
        // rescuer, opposite survivors) can both pass the reads above; only one
        // claim lands, the other moves nothing (`pair_changed`). This is the
        // same soft-delete unmergeAdopters reverses.
        const claim = await db.update(adopters).set({ deletedAt: new Date(), tokenHash: 'MERGED' }).where(and(
            eq(adopters.id, secondaryId),
            isNull(adopters.deletedAt),
            sql`(SELECT p.deleted_at FROM adopters p WHERE p.id = ${primaryId}) IS NULL`,
        )).run();
        let claimed = rowsAffected(claim);
        if (claimed === null) {
            // The driver reported no count: re-read whether the pair is in the state our claim leaves.
            const [p, s2] = await Promise.all([primaryId, secondaryId].map(id =>
                db.select({ deletedAt: adopters.deletedAt, tokenHash: adopters.tokenHash }).from(adopters).where(eq(adopters.id, id)).get()));
            claimed = !p?.deletedAt && !!s2?.deletedAt && s2.tokenHash === 'MERGED' ? 1 : 0;
        }
        if (claimed !== 1) {
            logger.warn('mergeAdopters: pair changed before the claim, nothing moved', { primaryId, secondaryId, actor: actorEmail });
            return { success: false, error: 'pair_changed' };
        }
        restoreSecondary = async () => {
            // tokenHash null, then a fresh tokenize: step 8 may already have
            // deleted its duplicate_tokens, so the old hash would claim tokens
            // that are no longer there.
            await db.update(adopters).set({ deletedAt: null, tokenHash: null }).where(eq(adopters.id, secondaryId));
            await tokenizeAdopter(secondaryId);
            logger.info('mergeAdopters: absorbed profile given back after a failed merge (re-tokenize ran; its own errors log separately)', { primaryId, secondaryId, actor: actorEmail });
        };

        const mergeDetails: Record<string, number> = {};

        // Every re-point below records the moved row ids into `undo`, and the
        // survivor's pre-merge fields are snapshotted before they're rewritten
        // — together they make the merge reversible (see unmergeAdopters).
        const undo: MergeUndoPayload = {
            primarySnapshot: {
                contactInfo: primary.contactInfo,
                contactEntries: primary.contactEntries,
                addressInfo: primary.addressInfo,
                familyMembers: primary.familyMembers,
                sourceUrl: primary.sourceUrl,
                isPublic: primary.isPublic,
            },
            placementIds: [],
            adopterEventIds: [],
            imageIds: [],
            flagIds: [],
            historyIds: [],
            statsIds: [],
            formSubmissionIds: [],
            candidates: [],
            annotatedFlags: [],
        };

        // 6. (Runs first after the claim, so a merge that can't land its survivor
        // write moves nothing — the failure path gives the secondary back.) Append text fields (preserve secondary data with separators).
        // Computed from the survivor as it is NOW and written with a
        // compare-and-swap (src/lib/adopterListCas.ts): a teammate's contact or
        // household edit landing mid-merge is merged in, never overwritten. The
        // undo snapshot is the row this write actually replaced.
        // The absorbed profile's household members, re-id'd ONCE (outside the
        // CAS retry loop) so the ids this merge adds are known and can never
        // collide with the survivor's — undo removes exactly these.
        // Their contacts too: one may be carried onto a survivor's same-named
        // member, and undo removes it by id.
        // Old id → new id, so the absorbed profile's household links can follow their member (D51).
        // A member that IS the survivor is not carried: the survivor would list
        // itself as its own conviviente. It stays on the absorbed profile (with
        // its link), so undo finds it where it was.
        const newMemberIds = new Map<string, string>();
        const absorbedMembers = deserializeHouseholdMembers(secondary.householdMembers).filter(m => m.profileId !== primaryId).map(m => {
            const id = crypto.randomUUID();
            newMemberIds.set(m.id, id);
            return { ...m, id, contactEntries: m.contactEntries.map(c => ({ ...c, id: crypto.randomUUID() })) };
        });
        const mergedFields = (p: typeof primary) => {
            const updates: Partial<typeof adopters.$inferInsert> = {};

            if (secondary.contactInfo) {
                updates.contactInfo = p.contactInfo
                    ? `${p.contactInfo}\n--- Merged from ${secondary.name} ---\n${secondary.contactInfo}`
                    : secondary.contactInfo;
            }

            if (secondary.addressInfo && !p.addressInfo) {
                updates.addressInfo = secondary.addressInfo;
            } else if (secondary.addressInfo && p.addressInfo) {
                updates.addressInfo = `${p.addressInfo}\n--- Merged ---\n${secondary.addressInfo}`;
            }

            if (secondary.familyMembers) {
                updates.familyMembers = p.familyMembers
                    ? `${p.familyMembers}\n${secondary.familyMembers}`
                    : secondary.familyMembers;
            }

            if (secondary.sourceUrl && !p.sourceUrl) {
                updates.sourceUrl = secondary.sourceUrl;
            }

            // Public status travels with the evidence: if EITHER side was marked
            // publicly known, the merged profile stays public — the survivor just
            // absorbed the publicly-sourced record. Silently dropping this (as
            // merges did before v2.55.10) re-protected 4 prod profiles whose
            // absorbed twin carried links to public sources.
            if (secondary.isPublic && !p.isPublic) {
                updates.isPublic = 1;
            }

            // 6b. Merge structured contact entries, and carry the secondary's name
            // over as an alias. Merge does NOT merge the `name` field, so without
            // this the absorbed record's name stops being a NAME token — a person
            // recorded under that spelling elsewhere would silently stop matching
            // the survivor (aliases tokenize as name_words; see extractTokens).
            const mergedEntries = mergeContactEntries(
                deserializeContactEntries(p.contactEntries),
                deserializeContactEntries(secondary.contactEntries),
            );
            const secondaryName = (secondary.name || '').trim();
            const knownNames = new Set(
                [p.name || '', ...mergedEntries.filter(e => e.type === 'alias').map(e => e.value)]
                    .map(n => normalizeText(n)),
            );
            if (secondaryName && !knownNames.has(normalizeText(secondaryName))) {
                mergedEntries.push({ id: crypto.randomUUID(), type: 'alias', value: secondaryName, addedBy: actorEmail });
            }
            if (mergedEntries.length > 0) {
                updates.contactEntries = JSON.stringify(mergedEntries);
            }

            // 6c. Carry the absorbed profile's household members (an adoption
            // form can put people on the auto-created profile — spec
            // 2026-10-04 §3). Without this, "Es la misma persona" dropped them.
            // Read from `p`, the fresh row, like every field here (CAS-guarded).
            if (absorbedMembers.length) {
                updates.householdMembers = serializeHouseholdMembers(
                    mergeHouseholdMembers(deserializeHouseholdMembers(p.householdMembers), absorbedMembers),
                );
            }

            // Force re-tokenization on next save
            updates.tokenHash = null;
            updates.updatedAt = new Date();
            return updates;
        };
        // requireLive: if another merge absorbed the survivor since the claim
        // (S→P while P→Q), nothing is written onto the dead row — this merge
        // fails and gives the secondary back.
        const written = await casAdopterLists(db, primaryId, (row) => ({ write: mergedFields(row as typeof primary), result: null }), { op: 'mergeAdopters', secondaryId }, { requireLive: true });
        if (written.status === 'missing') throw new Error('Primary adopter was deleted or merged away during the merge');
        if (written.status === 'busy') throw new Error(`Merge collided with concurrent edits (Error ID: ${written.errorId})`);
        undo.primarySnapshot = {
            contactInfo: written.row.contactInfo,
            contactEntries: written.row.contactEntries,
            addressInfo: written.row.addressInfo,
            familyMembers: written.row.familyMembers,
            sourceUrl: written.row.sourceUrl,
            isPublic: written.row.isPublic,
        };
        if (absorbedMembers.length) {
            // Same computation the write used, on the same row: the absorbed
            // members that actually landed, and what a repeat added to the
            // survivor's own copy (gift mark, contacts it lacked).
            const { added } = mergeHouseholdMembersTracked(deserializeHouseholdMembers(written.row.householdMembers), absorbedMembers);
            undo.addedHouseholdMemberIds = added.memberIds;
            if (added.enriched.length) undo.enrichedHouseholdMembers = added.enriched;
        }

        // 6d. «Convive con» links and «No convive» corrections follow the
        // merge (D51): those the absorbed profile hosted move with the members
        // that landed on the survivor, those naming it now name the survivor.
        // Undo puts them back; so does a failure before the audit row.
        const landed = new Set(undo.addedHouseholdMemberIds ?? []);
        const movedLinks = await moveHouseholdLinksOnMerge(db, {
            survivorId: primaryId,
            absorbedId: secondaryId,
            landedMemberIds: new Map([...newMemberIds].filter(([, id]) => landed.has(id))),
        });
        undo.householdLinks = movedLinks.links;
        undo.householdLinkCorrections = movedLinks.corrections;
        revertHouseholdLinks = () => restoreHouseholdLinks(db, movedLinks);

        // 1. Re-point adoptions (placements + adopter_events → normalized tables)
        const moved = await reassignAdopterRecords(db, secondaryId, primaryId);
        mergeDetails.adoptions = moved.count;
        undo.placementIds = moved.placementIds;
        undo.adopterEventIds = moved.adopterEventIds;

        // 2. Re-point images
        const movedImages = await db.update(adopterImages)
            .set({ adopterId: primaryId })
            .where(eq(adopterImages.adopterId, secondaryId))
            .returning({ id: adopterImages.id });
        undo.imageIds = movedImages.map((r: { id: string }) => r.id);
        mergeDetails.images = undo.imageIds.length;

        // 3. Re-point flags
        const movedFlags = await db.update(adopterFlags)
            .set({ adopterId: primaryId })
            .where(eq(adopterFlags.adopterId, secondaryId))
            .returning({ id: adopterFlags.id });
        undo.flagIds = movedFlags.map((r: { id: string }) => r.id);

        // 4. Re-point history
        const movedHistory = await db.update(adopterHistory)
            .set({ adopterId: primaryId })
            .where(eq(adopterHistory.adopterId, secondaryId))
            .returning({ id: adopterHistory.id });
        undo.historyIds = movedHistory.map((r: { id: string }) => r.id);

        // 5. Re-point stats
        const movedStats = await db.update(adopterStats)
            .set({ adopterId: primaryId })
            .where(eq(adopterStats.adopterId, secondaryId))
            .returning({ id: adopterStats.id });
        undo.statsIds = movedStats.map((r: { id: string }) => r.id);

        // 5b. Re-point adoption forms. Without this a form stays linked to the
        // absorbed (soft-deleted) profile: form-results and the animal's
        // applicant list keep pointing at a profile nobody can open.
        // `auto_adopter_id` is deliberately left alone — it records which
        // profile the form created, not where it lives now.
        const movedForms = await db.update(formSubmissions)
            .set({ linkedAdopterId: primaryId })
            .where(eq(formSubmissions.linkedAdopterId, secondaryId))
            .returning({ id: formSubmissions.id });
        const movedFormIds = movedForms.map((r: { id: string }) => r.id);
        undo.formSubmissionIds = movedFormIds;
        mergeDetails.forms = movedFormIds.length;

        // 7. The secondary was soft-deleted by the claim (step 0).

        // 8. Clean up tokens for secondary
        await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, secondaryId));

        // 9. Resolve the pair between these two, plus EVERY other pending
        // candidate that references the absorbed record. Leaving those behind
        // creates ghost rows in the review queue: a pair naming the (now
        // soft-deleted) secondary renders like a live duplicate, but merging it
        // is refused by the already-deleted guard above. No evidence is lost —
        // the survivor absorbed the contacts and name (as an alias), so the
        // next scan resurfaces any still-real match against the primary.
        const candidateConditions = or(
            and(eq(duplicateCandidates.adopter1Id, primaryId), eq(duplicateCandidates.adopter2Id, secondaryId)),
            and(eq(duplicateCandidates.adopter1Id, secondaryId), eq(duplicateCandidates.adopter2Id, primaryId)),
            and(
                eq(duplicateCandidates.status, 'pending'),
                or(eq(duplicateCandidates.adopter1Id, secondaryId), eq(duplicateCandidates.adopter2Id, secondaryId)),
            ),
        );
        if (candidateConditions) {
            // Remember each pair's pre-merge status so undo can put it back
            // exactly (a ghost pair was 'pending'; the direct pair may not be).
            const touched = await db.select({ id: duplicateCandidates.id, status: duplicateCandidates.status })
                .from(duplicateCandidates)
                .where(candidateConditions) as Array<{ id: string; status: string }>;
            undo.candidates = touched.map(c => ({ id: c.id, status: c.status }));
            await db.update(duplicateCandidates).set({
                status: 'merged',
                resolvedAt: new Date(),
                resolvedBy: actorEmail,
            }).where(candidateConditions);
        }

        // 10. Annotate any existing duplicate-flag pairs between these two
        const flagPairCond = and(
            eq(adopterFlags.reason, 'duplicate'),
            or(
                and(eq(adopterFlags.adopterId, primaryId), eq(adopterFlags.targetAdopterId, secondaryId)),
                and(eq(adopterFlags.adopterId, secondaryId), eq(adopterFlags.targetAdopterId, primaryId)),
            )
        );
        const annotated = await db.select({ id: adopterFlags.id, details: adopterFlags.details })
            .from(adopterFlags)
            .where(flagPairCond) as Array<{ id: string; details: string | null }>;
        undo.annotatedFlags = annotated.map(f => ({ id: f.id, details: f.details }));
        await db.update(adopterFlags).set({
            details: `${MERGED_FLAG_DETAILS_PREFIX}${primaryId} by ${actorEmail}`,
        }).where(flagPairCond);

        // 11. Audit log — caller may also write its own context-specific entry.
        // The `undo` payload makes this row the single source for unmergeAdopters.
        const auditId = crypto.randomUUID();
        await db.insert(auditLog).values({
            id: auditId,
            userId: actorEmail,
            userEmail: actorEmail,
            action: 'adopter_merge',
            target: primaryId,
            details: JSON.stringify({
                primaryId,
                secondaryId,
                secondaryName: secondary.name,
                mergeDetails,
                undo,
            }),
            createdAt: new Date(),
        });
        // From here the merge stands (and undo can reverse it): no more giving back.
        restoreSecondary = null;
        revertHouseholdLinks = null;

        // 11a. A link this merge carried onto a host whose link to that person
        // was corrected («No convive») is a dispute: the admins decide (D48).
        await notifyDisputesAfterMerge(movedLinks.disputedPairs, actorEmail).catch((e: unknown) => {
            logger.warn('mergeAdopters: household dispute notice not sent', { primaryId, secondaryId, actor: actorEmail, error: e instanceof Error ? e.message : String(e) });
        });

        // 11b. The survivor's own history says it absorbed a profile (2026-10-19,
        // Jon): the audit log alone was invisible on the profile. Best-effort —
        // the merge already happened; a missing line must not fail it.
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId: primaryId,
            changedBy: actorEmail,
            changes: JSON.stringify({ profiles_merged: { fromId: secondaryId, fromName: secondary.name, fromAddedBy: secondary.addedBy ?? null } }),
            changedAt: new Date(),
            kind: 'edit',
        }).catch((e: unknown) => {
            logger.warn('mergeAdopters: history line not written', { primaryId, secondaryId, actor: actorEmail, error: e instanceof Error ? e.message : String(e) });
        });

        // 12. Re-tokenize the survivor NOW instead of leaving it stale until
        // the next scan — the absorbed phones/emails and the new alias become
        // searchable/dedup-matchable immediately. tokenizeAdopter logs its own
        // failure and never throws, so a hiccup here can't fail the merge; the
        // null tokenHash set above means the next scan retries it anyway.
        await tokenizeAdopter(primaryId);

        // 13. Any open merge request naming the ABSORBED profile is now stale:
        // the pair it asked about is gone. The survivor's requests with other
        // profiles stay valid — it is still live. Best-effort — the merge
        // already happened; a request left open is refused later
        // (profiles_changed).
        await closeRequestsForAdopter(db, secondaryId)
            .catch((e: unknown) => {
                logger.warn('mergeAdopters: open merge requests not closed', { primaryId, secondaryId, actor: actorEmail, error: e instanceof Error ? e.message : String(e) });
            });

        logger.info('Adopter merge complete', {
            primaryId,
            secondaryId,
            actor: actorEmail,
            mergeDetails,
        });

        return {
            success: true,
            mergeDetails,
            primaryName: primary.name,
            secondaryName: secondary.name,
            primaryAddedBy: primary.addedBy ?? null,
            secondaryAddedBy: secondary.addedBy ?? null,
            auditId,
        };
    } catch (error) {
        const errorId = logger.error('mergeAdopters failed', error, { primaryId, secondaryId, actor: actorEmail });
        if (revertHouseholdLinks) {
            try {
                await revertHouseholdLinks();
            } catch (e) {
                logger.error('mergeAdopters: household links not put back after a failed merge', e, { primaryId, secondaryId, actor: actorEmail, errorId });
            }
        }
        if (restoreSecondary) {
            // A failed merge leaves both profiles live (rows already re-pointed
            // stay on the survivor, as before the claim moved first).
            try {
                await restoreSecondary();
            } catch (e) {
                logger.error('mergeAdopters: absorbed profile not restored after a failed merge', e, { primaryId, secondaryId, actor: actorEmail, errorId });
            }
        }
        return { success: false, error: `Merge failed (Error ID: ${errorId})` };
    }
}

/** Rows per undo UPDATE statement: 40 id params + the SET values stays well
 *  under D1's ~100-bound-parameter cap. */
const UNDO_CHUNK = 40;

/** Re-point rows back to an adopter by primary key, in chunked OR-batches. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- one helper over six differently-typed tables; each call site passes a real table + its id column
async function repointRows(db: any, table: any, idCol: any, ids: string[], adopterId: string): Promise<void> {
    for (let i = 0; i < ids.length; i += UNDO_CHUNK) {
        const chunk = ids.slice(i, i + UNDO_CHUNK);
        await db.update(table).set({ adopterId }).where(or(...chunk.map(id => eq(idCol, id))));
    }
}

/**
 * Merge one PENDING candidate pair, picking the survivor automatically:
 * more activity records wins; tie → more contact entries; tie → older record.
 * The loser is absorbed via the shared mergeAdopters mechanics (alias
 * carry-over, candidate cleanup, undo payload).
 *
 * `skipped: true` (with success) means the pair no longer needs merging —
 * already resolved (typically by an earlier merge in the same batch that
 * absorbed one of its records) or referencing a soft-deleted profile. That is
 * the EXPECTED outcome when a user batch-selects overlapping pairs, not an
 * error; any still-real match resurfaces against the survivor on next scan.
 */
export async function mergeCandidatePair(candidateId: string, actorEmail: string): Promise<MergeAdoptersResult & {
    skipped?: boolean; primaryId?: string; secondaryId?: string;
}> {
    try {
        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available' };

        const cand = await db.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).get();
        if (!cand) return { success: false, error: `Candidate ${candidateId} not found` };
        if (cand.status !== 'pending') return { success: true, skipped: true };

        const [a1, a2] = await Promise.all([
            db.select().from(adopters).where(eq(adopters.id, cand.adopter1Id)).get(),
            db.select().from(adopters).where(eq(adopters.id, cand.adopter2Id)).get(),
        ]);
        if (!a1 || !a2 || a1.deletedAt || a2.deletedAt) return { success: true, skipped: true };

        const [acts1, acts2] = await Promise.all([
            db.select({ count: sql<number>`COUNT(*)` }).from(adoptions).where(eq(adoptions.adopterId, a1.id)),
            db.select({ count: sql<number>`COUNT(*)` }).from(adoptions).where(eq(adoptions.adopterId, a2.id)),
        ]);
        const n1 = acts1[0]?.count || 0;
        const n2 = acts2[0]?.count || 0;
        const e1 = deserializeContactEntries(a1.contactEntries).length;
        const e2 = deserializeContactEntries(a2.contactEntries).length;
        const t1 = a1.createdAt ? a1.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
        const t2 = a2.createdAt ? a2.createdAt.getTime() : Number.MAX_SAFE_INTEGER;

        // Most activity → most contact data → oldest. a1 wins ties beyond that.
        let primary = a1;
        if (n2 !== n1) primary = n2 > n1 ? a2 : a1;
        else if (e2 !== e1) primary = e2 > e1 ? a2 : a1;
        else if (t2 < t1) primary = a2;
        const secondary = primary.id === a1.id ? a2 : a1;

        const result = await mergeAdopters(primary.id, secondary.id, actorEmail);
        return { ...result, primaryId: primary.id, secondaryId: secondary.id };
    } catch (error) {
        const errorId = logger.error('mergeCandidatePair failed', error, { candidateId, actor: actorEmail });
        return { success: false, error: `Pair merge failed (Error ID: ${errorId})` };
    }
}

/** Everything unmergeAdopters needs to reverse one merge, stored in the merge's audit_log row. */
interface MergeUndoPayload {
    primarySnapshot: {
        contactInfo: string | null;
        contactEntries: string | null;
        addressInfo: string | null;
        familyMembers: string | null;
        sourceUrl: string | null;
        /** Absent in payloads written before v2.55.10 — undo leaves the flag as-is then. */
        isPublic?: number;
    };
    /**
     * Household members this merge appended to the survivor (fresh ids). Undo
     * removes exactly these, so a teammate's later household edit survives —
     * restoring a whole-list snapshot would erase it. Absent before 2026-10-04.
     */
    addedHouseholdMemberIds?: string[];
    /**
     * The survivor's own members a merge added to (a same-named repeat's gift
     * mark or contacts) — undo takes back exactly those. Absent before 2026-10-13.
     */
    enrichedHouseholdMembers?: Array<{ memberId: string; contactIds: string[]; giftRecipient: boolean }>;
    placementIds: string[];
    adopterEventIds: string[];
    imageIds: string[];
    flagIds: string[];
    historyIds: string[];
    statsIds: string[];
    /** Absent in payloads written before v2.56.129 — those merges never moved forms. */
    formSubmissionIds?: string[];
    /** Household links this merge moved, as they were before (D51). Absent before 2.57.1. */
    householdLinks?: MovedHouseholdLink[];
    /** «No convive» corrections this merge moved, as they were before (D48/D51). Absent before 2.57.1. */
    householdLinkCorrections?: MovedHouseholdLinkCorrection[];
    candidates: Array<{ id: string; status: string }>;
    annotatedFlags: Array<{ id: string; details: string | null }>;
}

/**
 * Reverse a merge recorded by mergeAdopters, using the undo payload in its
 * audit_log row: restore the absorbed profile (clear soft-delete), re-point
 * the moved rows back to it, restore the survivor's pre-merge fields, put the
 * touched duplicate candidates back to their prior status, and re-tokenize
 * both profiles. Auth is the caller's responsibility (admin route).
 *
 * Refused when the target rows have visibly moved on since the merge: the
 * secondary was edited back to life or hard-deleted, the merge predates the
 * undo payload, or a LATER merge absorbed more data into the same survivor
 * (undoing an older merge would wipe the newer one's absorbed fields — undo
 * newest-first instead; the mass-merge undo path does exactly that).
 */
export async function unmergeAdopters(auditId: string, actorEmail: string): Promise<{ success: boolean; error?: string; secondaryName?: string }> {
    try {
        if (!auditId) return { success: false, error: 'Invalid unmerge request' };
        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available' };

        const auditRow = await db.select().from(auditLog).where(eq(auditLog.id, auditId)).get();
        if (!auditRow || auditRow.action !== 'adopter_merge') {
            return { success: false, error: 'Merge record not found' };
        }
        let details: { primaryId?: string; secondaryId?: string; secondaryName?: string; undo?: MergeUndoPayload; undoneAt?: number; undoStartedAt?: number; grantIds?: string[] };
        try {
            details = JSON.parse(auditRow.details || '{}');
        } catch {
            return { success: false, error: 'Merge record is unreadable' };
        }
        const { primaryId, secondaryId, undo } = details;
        if (!primaryId || !secondaryId || !undo) {
            return { success: false, error: 'This merge predates undo support' };
        }
        if (details.undoneAt) {
            return { success: false, error: 'This merge was already undone' };
        }
        // A started-but-unfinished undo (a prior attempt died mid-reversal)
        // is retried, not refused: every reversal step below writes fixed
        // values, so re-running from the top converges on the same end state.
        const isRetry = !!details.undoStartedAt;

        const [primary, secondary] = await Promise.all([
            db.select().from(adopters).where(eq(adopters.id, primaryId)).get(),
            db.select().from(adopters).where(eq(adopters.id, secondaryId)).get(),
        ]);
        if (!primary || !secondary) return { success: false, error: 'One of the merged profiles no longer exists' };
        // The pristine-secondary check only applies to a FIRST attempt: a
        // retry's earlier attempt may already have revived the secondary, and
        // refusing here would strand the half-reversed state permanently.
        if (!isRetry && (!secondary.deletedAt || secondary.tokenHash !== 'MERGED')) {
            return { success: false, error: 'The absorbed profile changed since the merge — cannot undo safely' };
        }

        // A later not-yet-undone merge into the same survivor means our
        // snapshot is stale — restoring it would erase that merge's data.
        // gt() (not a raw sql fragment) so the Date is mapped to the column's
        // epoch-seconds driver value — D1 cannot bind a raw Date object.
        // If createdAt is somehow missing, fall back to treating EVERY other
        // merge into this survivor as potentially later (conservative).
        const laterMerges = await db.select({ id: auditLog.id, details: auditLog.details })
            .from(auditLog)
            .where(and(
                eq(auditLog.action, 'adopter_merge'),
                eq(auditLog.target, primaryId),
                ne(auditLog.id, auditId),
                ...(auditRow.createdAt ? [gt(auditLog.createdAt, auditRow.createdAt)] : []),
            )) as Array<{ id: string; details: string | null }>;
        for (const later of laterMerges) {
            try {
                if (!JSON.parse(later.details || '{}').undoneAt) {
                    return { success: false, error: 'A newer merge into this profile exists — undo that one first' };
                }
            } catch { /* unreadable later row: be conservative */
                return { success: false, error: 'A newer merge into this profile exists — undo that one first' };
            }
        }

        // 0. Mark the undo as started BEFORE mutating anything, so a crash
        //    mid-reversal leaves a retryable record instead of a stranded one
        //    (the isRetry path above keys off this marker).
        if (!isRetry) {
            details = { ...details, undoStartedAt: Date.now() };
            await db.update(auditLog)
                .set({ details: JSON.stringify(details) })
                .where(eq(auditLog.id, auditId));
        }

        // 1. Restore the absorbed profile.
        await db.update(adopters).set({ deletedAt: null, tokenHash: null, updatedAt: new Date() })
            .where(eq(adopters.id, secondaryId));

        // 2. Re-point the moved rows back. Chunked OR-batches, not one query
        //    per row: a long-lived profile can own hundreds of history rows,
        //    and per-id fan-out would blow the Workers subrequest ceiling
        //    mid-undo. (D1 can't expand IN-arrays; explicit ORs are safe.)
        await repointRows(db, placements, placements.id, undo.placementIds, secondaryId);
        await repointRows(db, adopterEvents, adopterEvents.id, undo.adopterEventIds, secondaryId);
        await repointRows(db, adopterImages, adopterImages.id, undo.imageIds, secondaryId);
        await repointRows(db, adopterFlags, adopterFlags.id, undo.flagIds, secondaryId);
        await repointRows(db, adopterHistory, adopterHistory.id, undo.historyIds, secondaryId);
        await repointRows(db, adopterStats, adopterStats.id, undo.statsIds, secondaryId);
        // Not repointRows: the form's column is linked_adopter_id, not adopter_id.
        const formIds = undo.formSubmissionIds ?? [];
        for (let i = 0; i < formIds.length; i += UNDO_CHUNK) {
            const chunk = formIds.slice(i, i + UNDO_CHUNK);
            await db.update(formSubmissions)
                .set({ linkedAdopterId: secondaryId })
                .where(or(...chunk.map(id => eq(formSubmissions.id, id))));
        }

        // 3. Restore the survivor's pre-merge fields (drops the appended
        //    contact blob, the merged entries and the auto-alias in one go).
        await db.update(adopters).set({
            contactInfo: undo.primarySnapshot.contactInfo,
            contactEntries: undo.primarySnapshot.contactEntries,
            addressInfo: undo.primarySnapshot.addressInfo,
            familyMembers: undo.primarySnapshot.familyMembers,
            sourceUrl: undo.primarySnapshot.sourceUrl,
            // Pre-v2.55.10 payloads have no isPublic — leave the flag alone then.
            ...(undo.primarySnapshot.isPublic !== undefined ? { isPublic: undo.primarySnapshot.isPublic } : {}),
            tokenHash: null,
            updatedAt: new Date(),
        }).where(eq(adopters.id, primaryId));

        // 3b. Take back only the household members the merge added — never the
        //     survivor's own list, which may have been edited since.
        const householdAdded = { memberIds: undo.addedHouseholdMemberIds ?? [], enriched: undo.enrichedHouseholdMembers ?? [] };
        if (householdAdded.memberIds.length || householdAdded.enriched.length) {
            const out = await casAdopterLists(db, primaryId, (row) => {
                const before = serializeHouseholdMembers(deserializeHouseholdMembers(row.householdMembers));
                const after = serializeHouseholdMembers(undoHouseholdMerge(deserializeHouseholdMembers(row.householdMembers), householdAdded));
                return after === before ? { result: null } : { write: { householdMembers: after }, result: null };
            }, { op: 'unmergeAdopters.household', auditId });
            if (out.status === 'busy') throw new Error(`Undo collided with concurrent household edits (Error ID: ${out.errorId})`);
        }

        // 3c. The household links and corrections this merge moved go back where
        //     they were (D51); a correction made after the merge stays on the survivor.
        const movedLinks = Array.isArray(undo.householdLinks) ? undo.householdLinks : [];
        await restoreHouseholdLinks(db, {
            links: movedLinks,
            corrections: Array.isArray(undo.householdLinkCorrections) ? undo.householdLinkCorrections : [],
        });
        // 3d. A link this merge moved off the absorbed host and that was removed
        //     on the survivor since («No convive», or the survivor's team removed
        //     the member) did not come back above; the absorbed host still lists
        //     that person, so the link is written again (I1).
        await relinkRestoredHost(db, secondaryId, movedLinks, { auditId, actor: actorEmail });

        // 4. Put the touched duplicate candidates back to their prior status —
        //    grouped by target status so each group is a few chunked updates.
        const byStatus = new Map<string, string[]>();
        for (const c of undo.candidates) {
            const list = byStatus.get(c.status);
            if (list) list.push(c.id);
            else byStatus.set(c.status, [c.id]);
        }
        for (const [status, ids] of byStatus) {
            for (let i = 0; i < ids.length; i += UNDO_CHUNK) {
                const chunk = ids.slice(i, i + UNDO_CHUNK);
                await db.update(duplicateCandidates)
                    .set({ status, resolvedAt: null, resolvedBy: null })
                    .where(or(...chunk.map(id => eq(duplicateCandidates.id, id))));
            }
        }

        // 5. Restore the annotated duplicate-flag details.
        await Promise.all(undo.annotatedFlags.map(f =>
            db.update(adopterFlags).set({ details: f.details }).where(eq(adopterFlags.id, f.id)),
        ));

        // 5b. Revoke the contact-access grants THIS merge gave the absorbed
        //     profile's owner team (D40, grantAccessAfterFold) — only those:
        //     a grant someone held before the merge stays.
        const grantIds = Array.isArray(details.grantIds) ? details.grantIds.filter((id): id is string => typeof id === 'string') : [];
        for (let i = 0; i < grantIds.length; i += UNDO_CHUNK) {
            const chunk = grantIds.slice(i, i + UNDO_CHUNK);
            await db.update(piiAccessGrants)
                .set({ revokedAt: new Date(), revokedByEmail: actorEmail })
                .where(and(or(...chunk.map(id => eq(piiAccessGrants.id, id))), isNull(piiAccessGrants.revokedAt)));
        }

        // 6. Mark the merge as undone (so a second undo is refused) + audit.
        await db.update(auditLog)
            .set({ details: JSON.stringify({ ...details, undoneAt: Date.now() }) })
            .where(eq(auditLog.id, auditId));
        await db.insert(auditLog).values({
            id: crypto.randomUUID(),
            userId: actorEmail,
            userEmail: actorEmail,
            action: 'adopter_unmerge',
            target: primaryId,
            details: JSON.stringify({ primaryId, secondaryId, mergeAuditId: auditId }),
            createdAt: new Date(),
        });

        // 6b. Both profiles' histories say they were separated again.
        await Promise.all([primaryId, secondaryId].map(id => db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId: id,
            changedBy: actorEmail,
            changes: JSON.stringify({ profiles_unmerged: { otherId: id === primaryId ? secondaryId : primaryId, otherName: id === primaryId ? (details.secondaryName ?? null) : null } }),
            changedAt: new Date(),
            kind: 'edit',
        }).catch((e: unknown) => {
            logger.warn('unmergeAdopters: history line not written', { adopterId: id, mergeAuditId: auditId, actor: actorEmail, error: e instanceof Error ? e.message : String(e) });
        })));

        // 7. Fresh tokens for both, so search/dedup reflect the split at once.
        await tokenizeAdopter(primaryId);
        await tokenizeAdopter(secondaryId);

        logger.info('Adopter unmerge complete', { primaryId, secondaryId, mergeAuditId: auditId, actor: actorEmail });
        return { success: true, secondaryName: details.secondaryName };
    } catch (error) {
        const errorId = logger.error('unmergeAdopters failed', error, { auditId, actor: actorEmail });
        return { success: false, error: `Undo failed (Error ID: ${errorId})` };
    }
}

/**
 * Optional, admin-chosen (2026-10-19): tell whoever registered each of the two
 * profiles that they are now one. Never the admin who merged; one notice per
 * person even when they registered both. Best-effort, logged.
 * With the merge's `auditId` the notice links to «¿No es la misma persona?»
 * on the profile (D50, src/lib/mergeDisputes.ts).
 */
export async function notifyMergeOwners(
    merge: { primaryId: string; secondaryId?: string; primaryName?: string; secondaryName?: string; primaryAddedBy?: string | null; secondaryAddedBy?: string | null; auditId?: string },
    actorEmail: string,
    /** People told some other way (e.g. the requester of an approved request), never sent this notice. */
    opts: { skip?: readonly string[] } = {},
): Promise<number> {
    // Normalized: notifications are keyed (bell, email) by the lowercased
    // email, and `added_by` keeps whatever case it was written with.
    const norm = (e: string) => e.trim().toLowerCase();
    const skip = new Set([actorEmail ?? '', ...(opts.skip ?? [])].map(norm));
    const owners = [...new Set([merge.primaryAddedBy, merge.secondaryAddedBy]
        .filter((e): e is string => !!e && e.includes('@'))
        .map(norm))]
        .filter(e => !skip.has(e));
    if (!owners.length) return 0;
    const { createNotification } = await import('@/app/actions/notifications');
    // D31: each side's owner and date, when the absorbed profile is known.
    let content: ReturnType<typeof notificationContent>;
    try {
        const known = { survivorName: merge.primaryName, absorbedName: merge.secondaryName };
        const db = merge.secondaryId ? await getDb() : null;
        const sides = db && merge.secondaryId
            ? await mergeSideParams(db, { survivorId: merge.primaryId, absorbedId: merge.secondaryId }, known)
            : { survivorName: merge.primaryName ?? '', absorbedName: merge.secondaryName ?? '' };
        content = notificationContent({ key: 'adopter_merged_by_admin', params: { ...sides, ...(merge.auditId ? { disputable: '1' } : {}) } });
    } catch (e) {
        logger.warn('notifyMergeOwners: notice not built, nobody notified', { primaryId: merge.primaryId, actor: actorEmail, error: e instanceof Error ? e.message : String(e) });
        return 0;
    }
    let sent = 0;
    for (const owner of owners) {
        try {
            await createNotification({
                userId: owner,
                type: 'adopter_merged',
                ...content,
                // «¿No es la misma persona?» opens from here when the merge can be found again (D50).
                url: merge.auditId ? `/adopter/${merge.primaryId}?dispute=${encodeURIComponent(merge.auditId)}` : `/adopter/${merge.primaryId}`,
                icon: '🔗',
                // Never the admin's email: the bell (and its metadata) is the owner's.
                metadata: { primaryId: merge.primaryId, secondaryId: merge.secondaryId ?? null, auditId: merge.auditId ?? null },
            });
            sent++;
        } catch (e) {
            logger.warn('notifyMergeOwners: notification failed', { primaryId: merge.primaryId, actor: actorEmail, error: e instanceof Error ? e.message : String(e) });
        }
    }
    return sent;
}
