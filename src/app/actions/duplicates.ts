'use server';

import { adopters, adoptions, adopterImages, adopterFlags, adopterHistory, adopterStats, duplicateTokens, duplicateCandidates, auditLog, placements, adopterEvents } from '@/db/schema';
import { eq, or, and, gt, ne, inArray, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { reassignAdopterRecords } from './_recordWrite';
import { extractTokens, computeTokenHash, normalizeText, extractPhones, extractEmails, extractSocials, normalizeSocialHandle, detectSocialPlatformFromValue, type Token } from '@/lib/tokenizer';
import { deserializeHouseholdMembers } from '@/lib/householdMembers';
import { normalizeConfidence, confidenceBand, fuzzyNameScore, PRACTICAL_MAX_DUPLICATE } from '@/lib/scoring';
import { deserializeContactEntries, mergeContactEntries } from '@/lib/contactEntries';

/**
 * Tokenize an adopter for duplicate detection.
 * Computes tokens from all fields, compares hash to skip if fresh,
 * then replaces old tokens with new ones.
 * 
 * Designed to be called fire-and-forget after every save/update.
 */
export async function tokenizeAdopter(adopterId: string): Promise<void> {
    try {
        const db = await getDb();
        if (!db) return;

        // Fetch adopter
        const adopter = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        // Skip soft-deleted and walkthrough-demo rows — neither belongs in the
        // duplicate index. (Demo rows are also soft-deleted, so the first check
        // already covers them; the isDemo guard is defensive.)
        if (!adopter || adopter.deletedAt || adopter.isDemo) return;

        // Check if tokens are fresh via hash
        const newHash = computeTokenHash(adopter);
        if (adopter.tokenHash === newHash) return; // Already up to date

        // Fetch this adopter's adoptions (for onBehalfOf tokens)
        const adopterAdoptions = await db.select({
            onBehalfOf: adoptions.onBehalfOf,
        }).from(adoptions).where(eq(adoptions.adopterId, adopterId));

        // Aliases (contactEntries with type='alias') tokenize as name_words so
        // searching for an alternate name finds the adopter.
        const entries = deserializeContactEntries(adopter.contactEntries);
        const aliases = entries.filter(e => e.type === 'alias').map(e => e.value);
        // Structured socials carry `platform` → the tokenizer emits the precise
        // `social`=`platform|handle` token, not just the handle. Mirror the aliases
        // pattern (caller deserializes to avoid the tokenizer→contactEntries cycle).
        const socials = entries.filter(e => e.type === 'social').map(e => ({ value: e.value, platform: e.platform ?? null }));
        // Household members: names + their contacts feed name/phone/email/social/id tokens.
        const household = deserializeHouseholdMembers(adopter.householdMembers).map(m => ({ name: m.name, contactEntries: m.contactEntries }));

        // Extract tokens
        const tokens: Token[] = extractTokens(adopter, adopterAdoptions, aliases, socials, household);

        // Delete old tokens for this adopter
        await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopterId));

        // Insert new tokens in ONE multi-row insert instead of N sequential
        // round-trips (an adopter has 5–15 tokens; this was the dominant cost of
        // bulk import). Chunked to stay under SQLite/D1's bound-parameter limit.
        if (tokens.length > 0) {
            const rows = tokens.map(token => ({
                id: crypto.randomUUID(),
                adopterId,
                tokenType: token.type,
                tokenValue: token.value,
            }));
            // ≤24 rows/insert: 4 columns × 24 = 96 bound params, under D1's ~100-per-
            // query limit. (100 rows = 400 params would fail for records with >25
            // tokens — compound names + many contacts — silently dropping their tokens.)
            for (let i = 0; i < rows.length; i += 24) {
                await db.insert(duplicateTokens).values(rows.slice(i, i + 24));
            }
        }

        // Update the hash
        await db.update(adopters).set({ tokenHash: newHash }).where(eq(adopters.id, adopterId));

    } catch (error) {
        // v2.19.44: tokenize failure is silent data corruption — the
        // surrounding op succeeded but search/dedup will be wrong until
        // the next save. logger.error generates an id so an operator can
        // correlate Axiom entries with user-reported sightings.
        logger.error('Tokenize adopter failed', error, { adopterId });
    }
}

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
            },
            placementIds: [],
            adopterEventIds: [],
            imageIds: [],
            flagIds: [],
            historyIds: [],
            statsIds: [],
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
            details: `Merged into ${primaryId} by ${actorEmail}`,
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

/** Everything unmergeAdopters needs to reverse one merge, stored in the merge's audit_log row. */
interface MergeUndoPayload {
    primarySnapshot: {
        contactInfo: string | null;
        contactEntries: string | null;
        addressInfo: string | null;
        familyMembers: string | null;
        sourceUrl: string | null;
    };
    placementIds: string[];
    adopterEventIds: string[];
    imageIds: string[];
    flagIds: string[];
    historyIds: string[];
    statsIds: string[];
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

        // 3. Restore the survivor's pre-merge fields (drops the appended
        //    contact blob, the merged entries and the auto-alias in one go).
        await db.update(adopters).set({
            contactInfo: undo.primarySnapshot.contactInfo,
            contactEntries: undo.primarySnapshot.contactEntries,
            addressInfo: undo.primarySnapshot.addressInfo,
            familyMembers: undo.primarySnapshot.familyMembers,
            sourceUrl: undo.primarySnapshot.sourceUrl,
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

/**
 * Attach a just-signed contract's adoption to an existing matched adopter profile,
 * removing the auto-created orphan adopter. Self-service merge for the rescuer who
 * received the contract-result notification.
 *
 * Auth: caller must be the notification recipient. Cross-creator merge is allowed
 * (the matched profile may be owned by a different rescuer); the original creator
 * is notified so they can review.
 *
 * Mechanics: validates notification ownership + that the notification's recorded
 * orphan-adopterId matches the secondary, re-checks match.deletedAt server-side
 * (defense against race between page render and click), runs the shared merge,
 * writes a context-specific audit_log entry, and fires a notification to the
 * matched profile's original creator (skipped when actor is the creator or admin).
 */
export async function attachContractToExistingAdopter(
    notificationId: string,
    matchAdopterId: string,
): Promise<{ success: boolean; error?: string; primaryName?: string; matchedProfileUrl?: string }> {
    let actorEmail = 'unknown';
    try {
        const { getUser } = await import('./_db');
        actorEmail = await getUser();
        if (!actorEmail || actorEmail === 'unknown') {
            return { success: false, error: 'Not authenticated' };
        }

        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available' };

        const { notifications } = await import('@/db/schema');

        // Fetch notification and validate ownership + shape
        const notification = await db.select().from(notifications).where(eq(notifications.id, notificationId)).get();
        if (!notification) return { success: false, error: 'Notification not found' };
        if (notification.userId !== actorEmail) return { success: false, error: 'Not authorized for this notification' };
        if (notification.type !== 'contract_result') return { success: false, error: 'Notification is not a contract result' };

        const metadata = notification.metadata ? JSON.parse(notification.metadata) : {};
        const orphanAdopterId: string | undefined = metadata.adopterId;
        const animalId: string | undefined = metadata.animalId;
        const animalName: string | undefined = metadata.animalName;
        if (!orphanAdopterId) return { success: false, error: 'Notification missing orphan adopter id' };

        // Validate the requested merge target is one of the recorded matches —
        // prevents using this action to merge into arbitrary profiles.
        const recordedMatchIds = new Set<string>(
            (metadata.matchedAdopters || []).map((m: { id: string }) => m.id),
        );
        if (!recordedMatchIds.has(matchAdopterId)) {
            return { success: false, error: 'Adopter is not a recorded match for this notification' };
        }

        // Re-fetch match server-side and verify still live (defense against race
        // between page render and button click — the matched profile may have been
        // soft-deleted by another action in the meantime).
        const match = await db.select().from(adopters).where(eq(adopters.id, matchAdopterId)).get();
        if (!match) return { success: false, error: 'Matched adopter not found' };
        if (match.deletedAt) return { success: false, error: 'Matched adopter has been deleted' };

        // Run merge — match becomes primary, orphan becomes secondary
        const mergeResult = await mergeAdopters(matchAdopterId, orphanAdopterId, actorEmail);
        if (!mergeResult.success) {
            return { success: false, error: mergeResult.error };
        }

        // Context-specific audit entry on top of the generic one written by mergeAdopters
        try {
            await db.insert(auditLog).values({
                id: crypto.randomUUID(),
                userId: actorEmail,
                userEmail: actorEmail,
                action: 'contract_link_to_existing',
                target: matchAdopterId,
                details: JSON.stringify({
                    notificationId,
                    mergedOrphanId: orphanAdopterId,
                    animalId,
                    animalName,
                    matchedProfileCreator: match.addedBy,
                }),
                createdAt: new Date(),
            });
        } catch (e) {
            logger.warn('attachContractToExistingAdopter: audit log insert failed (non-blocking)', {
                notificationId,
                matchAdopterId,
                actor: actorEmail,
                error: e instanceof Error ? e.message : String(e),
            });
        }

        // Triage analytics — mirrors the keep-new event, lets us compare merge vs keep-new outcome volumes.
        try {
            await db.insert(adopterStats).values({
                id: crypto.randomUUID(),
                adopterId: matchAdopterId,
                eventType: 'contract_merged',
                userId: actorEmail,
                createdAt: new Date(),
            });
        } catch (e) {
            // Analytics insert failure is non-blocking — the merge itself succeeded.
            logger.warn('attachContractToExistingAdopter: contract_merged analytics insert failed (non-blocking)', {
                notificationId,
                matchAdopterId,
                actor: actorEmail,
                error: e instanceof Error ? e.message : String(e),
            });
        }

        // Notify original creator (if different from actor and not an admin — admins do
        // periodic reconciliation and don't need a per-merge ping for actions in their queue).
        try {
            const { isAdmin: isAdminEmail } = await import('@/config/admins');
            if (match.addedBy && match.addedBy !== actorEmail && !isAdminEmail(match.addedBy)) {
                const { createNotification } = await import('./notifications');
                const { resolveDisplayName } = await import('./notifications');
                const actorName = await resolveDisplayName(actorEmail).catch(() => actorEmail.split('@')[0]);
                await createNotification({
                    userId: match.addedBy,
                    type: 'contract_attached',
                    title: `${actorName} adjuntó un contrato a tu perfil ${match.name}`,
                    body: animalName
                        ? `Adopción de ${animalName} atribuida a este perfil. Tocá para revisar.`
                        : 'Tocá para revisar.',
                    url: `/adopter/${matchAdopterId}`,
                    icon: '📝',
                    metadata: {
                        attachedBy: actorEmail,
                        sourceNotificationId: notificationId,
                        animalId,
                        animalName,
                    },
                });
            }
        } catch (e) {
            logger.warn('attachContractToExistingAdopter: creator notification failed (non-blocking)', {
                notificationId,
                matchAdopterId,
                actor: actorEmail,
                error: e instanceof Error ? e.message : String(e),
            });
        }

        return {
            success: true,
            primaryName: match.name,
            matchedProfileUrl: `/adopter/${matchAdopterId}`,
        };
    } catch (error) {
        const errorId = logger.error('attachContractToExistingAdopter failed', error, {
            notificationId,
            matchAdopterId,
            actor: actorEmail,
        });
        return { success: false, error: `Failed to attach contract (Error ID: ${errorId})` };
    }
}

/**
 * Record that the rescuer reviewed the contract-result matches and chose to keep
 * the auto-created adopter (the "Continuar con el perfil nuevo" path). Lightweight
 * analytics-only — does not modify the adopter, the notification, or the matches.
 *
 * Best-guess UX choice: we have no prior data on rescuer triage behavior, so this
 * event lets us measure outcome volume (merge vs keep-new) over the next 30 days
 * and decide whether the keep-new affordance should be promoted, demoted, or split
 * into more specific intents in a follow-up.
 */
export async function markContractKeepNew(adopterId: string): Promise<{ success: boolean }> {
    let actorEmail = 'unknown';
    try {
        const { getUser } = await import('./_db');
        actorEmail = await getUser().catch(() => 'unknown');

        const db = await getDb();
        if (!db) return { success: false };

        await db.insert(adopterStats).values({
            id: crypto.randomUUID(),
            adopterId,
            eventType: 'contract_kept_new',
            userId: actorEmail !== 'unknown' ? actorEmail : null,
            createdAt: new Date(),
        });
        return { success: true };
    } catch (error) {
        // Analytics-only — never propagate failures to the user
        logger.warn('markContractKeepNew failed (non-blocking)', {
            adopterId,
            actor: actorEmail,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false };
    }
}

export interface DuplicateCandidate {
    id: string;
    otherAdopterId: string;
    otherAdopterName: string;
    matchTypes: string[];
    score: number;
    confidence: string;
    /** Normalised 0–100 confidence percentage derived from score / PRACTICAL_MAX_DUPLICATE. */
    confidencePercent: number;
}

/**
 * Get pending duplicate candidates for a given adopter.
 * Used by profile banner and flagging pre-population.
 */
export async function getDuplicateCandidates(adopterId: string): Promise<DuplicateCandidate[]> {
    try {
        const db = await getDb();
        if (!db) return [];

        const candidates = await db.select({
            id: duplicateCandidates.id,
            adopter1Id: duplicateCandidates.adopter1Id,
            adopter2Id: duplicateCandidates.adopter2Id,
            matchTypes: duplicateCandidates.matchTypes,
            score: duplicateCandidates.score,
            confidence: duplicateCandidates.confidence,
        })
            .from(duplicateCandidates)
            .where(and(
                eq(duplicateCandidates.status, 'pending'),
                or(
                    eq(duplicateCandidates.adopter1Id, adopterId),
                    eq(duplicateCandidates.adopter2Id, adopterId),
                ),
            ))
            .limit(5);

        if (candidates.length === 0) return [];

        // Get names for the "other" adopter in each pair
        const otherIds = candidates.map((c: { adopter1Id: string; adopter2Id: string }) =>
            c.adopter1Id === adopterId ? c.adopter2Id : c.adopter1Id
        );
        const otherAdopters = await Promise.all(
            otherIds.map((id: string) =>
                db.select({ id: adopters.id, name: adopters.name })
                    .from(adopters)
                    .where(eq(adopters.id, id))
                    .get()
            )
        );
        const nameMap = new Map<string, string>();
        for (const a of otherAdopters) {
            if (a) nameMap.set(a.id, a.name);
        }

        return candidates
            .map((c: { id: string; adopter1Id: string; adopter2Id: string; matchTypes: string; score: number; confidence: string }) => {
                const otherId = c.adopter1Id === adopterId ? c.adopter2Id : c.adopter1Id;
                return {
                    id: c.id,
                    otherAdopterId: otherId,
                    otherAdopterName: nameMap.get(otherId) || 'Unknown',
                    matchTypes: JSON.parse(c.matchTypes || '[]') as string[],
                    score: c.score,
                    confidence: c.confidence,
                    confidencePercent: normalizeConfidence(c.score, PRACTICAL_MAX_DUPLICATE),
                };
            })
            .sort((a: DuplicateCandidate, b: DuplicateCandidate) => b.confidencePercent - a.confidencePercent);
    } catch (error) {
        logger.warn('getDuplicateCandidates failed', {
            adopterId,
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}

// ── Pending-dedup section on /my-adopters (v2.14.10-20) ─────────────────

export interface PendingDedupPair {
    candidateId: string;
    /** The "new" auto-created side — heuristically the more recent record. */
    newAdopter: {
        id: string;
        name: string;
        contactInfo: string | null;
        source: string;
        createdAt: number | null;
    };
    /** The "existing" side — older record. Use as merge primary. */
    existingAdopter: {
        id: string;
        name: string;
        contactInfo: string | null;
        source: string;
        createdAt: number | null;
    };
    matchTypes: string[];
    confidence: string;
    confidencePercent: number;
}

/**
 * Pending-dedup feed for the current user's /my-adopters section.
 * Returns up to 20 pending candidate pairs where the current rescuer is the
 * `addedBy` on either side of the pair. The newer record is presented as
 * "the new submission"; the older as "the existing profile" so the merge
 * preserves the older record as primary.
 *
 * Different from getDuplicateCandidates(adopterId): that one is single-adopter
 * + limit-5 (profile banner). This one is user-scoped + limit-20 (queue view).
 */
export async function getPendingDuplicatesForUser(): Promise<PendingDedupPair[]> {
    try {
        const { getUser } = await import('./_db');
        const actorEmail = await getUser();

        const db = await getDb();
        if (!db) return [];

        const a1 = adopters;
        const candidates = await db.select({
            candidateId: duplicateCandidates.id,
            adopter1Id: duplicateCandidates.adopter1Id,
            adopter2Id: duplicateCandidates.adopter2Id,
            matchTypes: duplicateCandidates.matchTypes,
            score: duplicateCandidates.score,
            confidence: duplicateCandidates.confidence,
            detectedAt: duplicateCandidates.detectedAt,
        })
            .from(duplicateCandidates)
            .where(eq(duplicateCandidates.status, 'pending'))
            .all() as Array<{ candidateId: string; adopter1Id: string; adopter2Id: string; matchTypes: string; score: number; confidence: string; detectedAt: Date | null }>;

        if (candidates.length === 0) return [];

        // Per CLAUDE.md: D1 has no inArray. Fan out per adopter id.
        const allIds = new Set<string>();
        for (const c of candidates) {
            allIds.add(c.adopter1Id);
            allIds.add(c.adopter2Id);
        }
        const adopterRows = await Promise.all(
            [...allIds].map(id => db.select({
                id: a1.id,
                name: a1.name,
                contactInfo: a1.contactInfo,
                source: a1.source,
                addedBy: a1.addedBy,
                createdAt: a1.createdAt,
                deletedAt: a1.deletedAt,
            }).from(a1).where(eq(a1.id, id)).get())
        );
        const byId = new Map<string, { id: string; name: string; contactInfo: string | null; source: string; addedBy: string | null; createdAt: Date | null; deletedAt: Date | null }>();
        for (const row of adopterRows) {
            if (row) byId.set(row.id, row);
        }

        const pairs: PendingDedupPair[] = [];
        for (const c of candidates) {
            const a = byId.get(c.adopter1Id);
            const b = byId.get(c.adopter2Id);
            if (!a || !b) continue;
            if (a.deletedAt || b.deletedAt) continue; // already merged elsewhere
            // Scope to current user: actor must own at least one side
            if (a.addedBy !== actorEmail && b.addedBy !== actorEmail) continue;

            // Newer record is the "new" side; older is the "existing" (merge primary).
            const aMs = a.createdAt?.getTime() ?? 0;
            const bMs = b.createdAt?.getTime() ?? 0;
            const newOne = aMs >= bMs ? a : b;
            const oldOne = aMs >= bMs ? b : a;

            pairs.push({
                candidateId: c.candidateId,
                newAdopter: {
                    id: newOne.id,
                    name: newOne.name,
                    contactInfo: newOne.contactInfo,
                    source: newOne.source,
                    createdAt: newOne.createdAt ? Math.floor(newOne.createdAt.getTime() / 1000) : null,
                },
                existingAdopter: {
                    id: oldOne.id,
                    name: oldOne.name,
                    contactInfo: oldOne.contactInfo,
                    source: oldOne.source,
                    createdAt: oldOne.createdAt ? Math.floor(oldOne.createdAt.getTime() / 1000) : null,
                },
                matchTypes: JSON.parse(c.matchTypes || '[]') as string[],
                confidence: c.confidence,
                confidencePercent: normalizeConfidence(c.score, PRACTICAL_MAX_DUPLICATE),
            });

            if (pairs.length >= 20) break;
        }

        // Most recently detected first.
        pairs.sort((p, q) => q.newAdopter.createdAt! - p.newAdopter.createdAt!);

        return pairs;
    } catch (error) {
        logger.warn('getPendingDuplicatesForUser failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}

/**
 * Dismiss a pending duplicate candidate. User-scoped variant of the admin
 * /api/admin/duplicates/dismiss route: the actor must own at least one of
 * the two adopters in the pair (admins are allowed regardless).
 */
export async function dismissDuplicateCandidate(candidateId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const { getUser } = await import('./_db');
        const { isAdminAsync } = await import('@/config/admins');
        const actorEmail = await getUser();

        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available' };

        const candidate = await db.select({
            id: duplicateCandidates.id,
            adopter1Id: duplicateCandidates.adopter1Id,
            adopter2Id: duplicateCandidates.adopter2Id,
            status: duplicateCandidates.status,
        }).from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).get();

        if (!candidate) return { success: false, error: 'Candidate not found' };
        if (candidate.status !== 'pending') return { success: false, error: 'Candidate already resolved' };

        const [a, b] = await Promise.all([
            db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, candidate.adopter1Id)).get(),
            db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, candidate.adopter2Id)).get(),
        ]);

        const isOwner = (a?.addedBy === actorEmail) || (b?.addedBy === actorEmail);
        const isAdminUser = await isAdminAsync(actorEmail);

        if (!isOwner && !isAdminUser) {
            return { success: false, error: 'Not authorized to dismiss this pair' };
        }

        await db.update(duplicateCandidates).set({
            status: 'dismissed',
            resolvedAt: new Date(),
            resolvedBy: actorEmail,
        }).where(eq(duplicateCandidates.id, candidateId));

        logger.info('Duplicate candidate dismissed by user', { candidateId, user: actorEmail });
        return { success: true };
    } catch (error) {
        logger.warn('dismissDuplicateCandidate failed', {
            candidateId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: 'Dismiss failed' };
    }
}

export interface TokenMatchResult {
    adopterId: string;
    adopterName: string;
    matchTypes: string[];
    score: number;
    confidencePercent: number;
    confidence: 'high' | 'medium' | 'low';
}

/**
 * Check for duplicate adopters using token-based matching.
 * Extracts tokens from the provided data and queries the token index.
 * Used by import wizard pre-save and real-time field hints.
 */
/**
 * @deprecated Use findAdopters({ mode: 'duplicate' }) for new call sites.
 * Kept as a rollback reference — remove after v2.12.x staging validation.
 */
export async function checkTokenDuplicates(data: {
    name?: string;
    contactInfo?: string;
    phones?: string[];
    emails?: string[];
    socials?: string[];
    addresses?: string[];
}): Promise<TokenMatchResult[]> {
    try {
        const db = await getDb();
        if (!db) {
            logger.warn('checkTokenDuplicates: DB not available');
            return [];
        }

        // Build tokens from the raw data
        const tokens: { type: string; value: string }[] = [];

        if (data.name) {
            const normalized = normalizeText(data.name);
            if (normalized.length >= 3) {
                tokens.push({ type: 'name_full', value: normalized });
                for (const word of normalized.split(/\s+/)) {
                    if (word.length >= 3) tokens.push({ type: 'name_word', value: word });
                }
            }
        }

        // Extract from contactInfo if provided
        const contactText = data.contactInfo || '';
        const phones = data.phones?.length ? data.phones : extractPhones(contactText);
        const emails = data.emails?.length ? data.emails : extractEmails(contactText);
        const socials = data.socials?.length ? data.socials : extractSocials(contactText);

        for (const phone of phones) {
            const digits = phone.replace(/\D/g, '');
            if (digits.length >= 6) {
                tokens.push({ type: 'phone', value: digits });
                tokens.push({ type: 'phone_suffix', value: digits.slice(-8) });
            }
        }
        for (const email of emails) {
            tokens.push({ type: 'email', value: email.toLowerCase().trim() });
        }
        for (const social of socials) {
            // Dual social tokens, matching the index (see tokenizer.normalizeSocialHandle):
            // platform-agnostic `social_handle` always, plus `social`=`platform|handle`
            // when the value's URL reveals the network.
            const raw = social.toLowerCase().trim();
            const platform = detectSocialPlatformFromValue(raw);
            const handle = normalizeSocialHandle(raw, platform);
            if (!handle) continue;
            tokens.push({ type: 'social_handle', value: handle });
            if (platform) tokens.push({ type: 'social', value: `${platform}|${handle}` });
        }

        if (tokens.length === 0) {
            logger.info('checkTokenDuplicates: no tokens extracted', { name: data.name, hasContactInfo: !!data.contactInfo });
            return [];
        }

        // Query the token index for matches
        // D1 doesn't support IN with large lists well, so query one at a time
        const matchMap = new Map<string, Set<string>>(); // adopterId -> Set<matchType>

        for (const token of tokens) {
            const matches = await db.select({
                adopterId: duplicateTokens.adopterId,
            })
                .from(duplicateTokens)
                .where(and(
                    eq(duplicateTokens.tokenType, token.type),
                    eq(duplicateTokens.tokenValue, token.value),
                ))
                .limit(20);

            for (const m of matches) {
                if (!matchMap.has(m.adopterId)) {
                    matchMap.set(m.adopterId, new Set());
                }
                matchMap.get(m.adopterId)!.add(token.type);
            }
        }

        if (matchMap.size === 0) {
            logger.info('checkTokenDuplicates: no matches found', { tokenCount: tokens.length, name: data.name });
            return [];
        }

        // Fetch adopter names
        const matchedIds = Array.from(matchMap.keys());
        const matchedAdopters = await Promise.all(
            matchedIds.map((id: string) =>
                db.select({ id: adopters.id, name: adopters.name })
                    .from(adopters)
                    .where(eq(adopters.id, id))
                    .get()
            )
        );

        // ── Batch-fetch all stored name_word tokens for matched adopters (E1 fix) ──
        // One single query replaces the previous per-adopter N+1 pattern.
        const allStoredWords = matchedIds.length > 0
            ? await db.select({ adopterId: duplicateTokens.adopterId, tokenValue: duplicateTokens.tokenValue })
                .from(duplicateTokens)
                .where(and(
                    inArray(duplicateTokens.adopterId, matchedIds),
                    eq(duplicateTokens.tokenType, 'name_word'),
                ))
                .all()
            : [];
        const storedWordsByAdopter = new Map<string, string[]>();
        for (const row of allStoredWords) {
            if (!storedWordsByAdopter.has(row.adopterId)) storedWordsByAdopter.set(row.adopterId, []);
            storedWordsByAdopter.get(row.adopterId)!.push(row.tokenValue);
        }

        const results: TokenMatchResult[] = [];
        for (const a of matchedAdopters) {
            if (!a) continue;
            const types = Array.from(matchMap.get(a.id) || []);

            // Base weights — phone/email/social must always be exact (no fuzzy)
            const weights: Record<string, number> = {
                phone: 3, phone_suffix: 2, email: 3, social: 3,
                name_full: 2, name_phonetic: 1.5,
                name_word: 1, address_word: 1, source_url: 3,
            };
            let score = types.reduce((s, t) => s + (weights[t] || 1), 0);

            // ── Levenshtein fuzzy bonus for name_word tokens ──────────────
            // For each input token, find the single best fuzzy match among stored tokens.
            // Capped at 1.0 total per input token to prevent score inflation
            // from profiles that happen to have many stored name words (E4 fix).
            const inputNameWords = tokens
                .filter(t => t.type === 'name_word')
                .map(t => t.value);
            const storedNameWords = storedWordsByAdopter.get(a.id) || [];

            for (const input of inputNameWords) {
                // Find the best (highest) fuzzy score across all stored words
                let bestFuzzy = 0;
                for (const stored of storedNameWords) {
                    if (input === stored) continue; // exact match already counted
                    const fuzzy = fuzzyNameScore(input, stored);
                    if (fuzzy > bestFuzzy) bestFuzzy = fuzzy;
                }
                if (bestFuzzy > 0) {
                    score += bestFuzzy;
                    if (!types.includes('name_word_fuzzy')) types.push('name_word_fuzzy');
                }
            }

            // ── Normalise to 0–100% and classify band ────────────────────
            const confidencePercent = normalizeConfidence(score, PRACTICAL_MAX_DUPLICATE);
            const band = confidenceBand(confidencePercent);

            // Skip results too weak to surface — they'll never warrant a warning
            if (band === 'none') continue;

            results.push({
                adopterId: a.id,
                adopterName: a.name,
                matchTypes: types,
                score,
                confidencePercent,
                confidence: band as 'high' | 'medium' | 'low',
            });
        }

        return results.sort((a, b) => b.score - a.score).slice(0, 5);
    } catch (error) {
        logger.warn('checkTokenDuplicates failed', {
            name: data.name,
            hasContactInfo: !!data.contactInfo,
            hasAddresses: Array.isArray(data.addresses) && data.addresses.length > 0,
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}


/**
 * Count how many distinct adopters carry a given social handle (via the
 * `social_handle` token index). Used by the composer's DuplicateHint to warn
 * when a handle is on MANY records — usually a rescuer's own contact mis-entered
 * on adopters, not a real duplicate (dedup spec §4, #3-revised). Advisory:
 * returns 0 on any failure (never blocks the composer).
 */
export async function countAdoptersBySocialHandle(value: string): Promise<number> {
    try {
        const handle = normalizeSocialHandle(value, detectSocialPlatformFromValue(value));
        if (!handle) return 0;
        const db = await getDb();
        if (!db) return 0;
        const rows = await db.select({ n: sql<number>`COUNT(DISTINCT ${duplicateTokens.adopterId})` })
            .from(duplicateTokens)
            .where(and(eq(duplicateTokens.tokenType, 'social_handle'), eq(duplicateTokens.tokenValue, handle)));
        return rows[0]?.n ?? 0;
    } catch (e) {
        logger.warn('countAdoptersBySocialHandle: query failed', { error: e instanceof Error ? e.message : String(e) });
        return 0;
    }
}
