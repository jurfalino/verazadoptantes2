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

import { adopters, adoptions, adopterImages, adopterFlags, adopterHistory, adopterStats, duplicateTokens, duplicateCandidates, auditLog, placements, adopterEvents, formSubmissions } from '@/db/schema';
import { eq, or, and, gt, ne, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getDb } from '@/lib/db';
import { reassignAdopterRecords } from '@/app/actions/_recordWrite';
import { normalizeText } from '@/lib/tokenizer';
import { deserializeContactEntries, mergeContactEntries } from '@/lib/contactEntries';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { MERGED_FLAG_DETAILS_PREFIX } from '@/domain/dedupPair';

export interface MergeAdoptersResult {
    success: boolean;
    error?: string;
    mergeDetails?: Record<string, number>;
    primaryName?: string;
    secondaryName?: string;
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

        // 6. Append text fields (preserve secondary data with separators)
        const updates: Partial<typeof adopters.$inferInsert> = {};

        if (secondary.contactInfo) {
            updates.contactInfo = primary.contactInfo
                ? `${primary.contactInfo}\n--- Merged from ${secondary.name} ---\n${secondary.contactInfo}`
                : secondary.contactInfo;
        }

        if (secondary.addressInfo && !primary.addressInfo) {
            updates.addressInfo = secondary.addressInfo;
        } else if (secondary.addressInfo && primary.addressInfo) {
            updates.addressInfo = `${primary.addressInfo}\n--- Merged ---\n${secondary.addressInfo}`;
        }

        if (secondary.familyMembers) {
            updates.familyMembers = primary.familyMembers
                ? `${primary.familyMembers}\n${secondary.familyMembers}`
                : secondary.familyMembers;
        }

        if (secondary.sourceUrl && !primary.sourceUrl) {
            updates.sourceUrl = secondary.sourceUrl;
        }

        // Public status travels with the evidence: if EITHER side was marked
        // publicly known, the merged profile stays public — the survivor just
        // absorbed the publicly-sourced record. Silently dropping this (as
        // merges did before v2.55.10) re-protected 4 prod profiles whose
        // absorbed twin carried links to public sources.
        if (secondary.isPublic && !primary.isPublic) {
            updates.isPublic = 1;
        }

        // 6b. Merge structured contact entries, and carry the secondary's name
        // over as an alias. Merge does NOT merge the `name` field, so without
        // this the absorbed record's name stops being a NAME token — a person
        // recorded under that spelling elsewhere would silently stop matching
        // the survivor (aliases tokenize as name_words; see extractTokens).
        const mergedEntries = mergeContactEntries(
            deserializeContactEntries(primary.contactEntries),
            deserializeContactEntries(secondary.contactEntries),
        );
        const secondaryName = (secondary.name || '').trim();
        const knownNames = new Set(
            [primary.name || '', ...mergedEntries.filter(e => e.type === 'alias').map(e => e.value)]
                .map(n => normalizeText(n)),
        );
        if (secondaryName && !knownNames.has(normalizeText(secondaryName))) {
            mergedEntries.push({ id: crypto.randomUUID(), type: 'alias', value: secondaryName, addedBy: actorEmail });
        }
        if (mergedEntries.length > 0) {
            updates.contactEntries = JSON.stringify(mergedEntries);
        }

        // Force re-tokenization on next save
        updates.tokenHash = null;
        updates.updatedAt = new Date();

        if (Object.keys(updates).length > 0) {
            await db.update(adopters).set(updates).where(eq(adopters.id, primaryId));
        }

        // 7. Soft-delete secondary
        await db.update(adopters).set({
            deletedAt: new Date(),
            tokenHash: 'MERGED',
        }).where(eq(adopters.id, secondaryId));

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

        // 12. Re-tokenize the survivor NOW instead of leaving it stale until
        // the next scan — the absorbed phones/emails and the new alias become
        // searchable/dedup-matchable immediately. tokenizeAdopter logs its own
        // failure and never throws, so a hiccup here can't fail the merge; the
        // null tokenHash set above means the next scan retries it anyway.
        await tokenizeAdopter(primaryId);

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
            auditId,
        };
    } catch (error) {
        const errorId = logger.error('mergeAdopters failed', error, { primaryId, secondaryId, actor: actorEmail });
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
export async function mergeCandidatePair(candidateId: string, actorEmail: string): Promise<{
    success: boolean; skipped?: boolean; error?: string; auditId?: string; primaryId?: string; secondaryId?: string;
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
    placementIds: string[];
    adopterEventIds: string[];
    imageIds: string[];
    flagIds: string[];
    historyIds: string[];
    statsIds: string[];
    /** Absent in payloads written before v2.56.129 — those merges never moved forms. */
    formSubmissionIds?: string[];
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
        let details: { primaryId?: string; secondaryId?: string; secondaryName?: string; undo?: MergeUndoPayload; undoneAt?: number; undoStartedAt?: number };
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
