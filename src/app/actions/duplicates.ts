'use server';

import { adopters, adoptions, adopterImages, adopterFlags, adopterHistory, adopterStats, duplicateTokens, duplicateCandidates, auditLog } from '@/db/schema';
import { eq, or, and, inArray } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { extractTokens, computeTokenHash, normalizeText, extractPhones, extractEmails, extractSocials, type Token } from '@/lib/tokenizer';
import { normalizeConfidence, confidenceBand, fuzzyNameScore, PRACTICAL_MAX_DUPLICATE } from '@/lib/scoring';
import { deserializeContactEntries } from '@/lib/contactEntries';

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
        if (!adopter || adopter.deletedAt) return;

        // Check if tokens are fresh via hash
        const newHash = computeTokenHash(adopter);
        if (adopter.tokenHash === newHash) return; // Already up to date

        // Fetch this adopter's adoptions (for onBehalfOf tokens)
        const adopterAdoptions = await db.select({
            onBehalfOf: adoptions.onBehalfOf,
        }).from(adoptions).where(eq(adoptions.adopterId, adopterId));

        // Aliases (contactEntries with type='alias') tokenize as name_words so
        // searching for an alternate name finds the adopter.
        const aliases = deserializeContactEntries(adopter.contactEntries)
            .filter(e => e.type === 'alias')
            .map(e => e.value);

        // Extract tokens
        const tokens: Token[] = extractTokens(adopter, adopterAdoptions, aliases);

        // Delete old tokens for this adopter
        await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopterId));

        // Insert new tokens
        if (tokens.length > 0) {
            for (const token of tokens) {
                await db.insert(duplicateTokens).values({
                    id: crypto.randomUUID(),
                    adopterId,
                    tokenType: token.type,
                    tokenValue: token.value,
                });
            }
        }

        // Update the hash
        await db.update(adopters).set({ tokenHash: newHash }).where(eq(adopters.id, adopterId));

    } catch (error) {
        // Fire-and-forget: log but don't throw
        logger.warn('Tokenize adopter failed', {
            adopterId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export interface MergeAdoptersResult {
    success: boolean;
    error?: string;
    mergeDetails?: Record<string, number>;
    primaryName?: string;
    secondaryName?: string;
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

        // 1. Re-point adoptions
        const movedAdoptions = await db.update(adoptions)
            .set({ adopterId: primaryId })
            .where(eq(adoptions.adopterId, secondaryId));
        mergeDetails.adoptions = movedAdoptions?.rowsAffected || 0;

        // 2. Re-point images
        const movedImages = await db.update(adopterImages)
            .set({ adopterId: primaryId })
            .where(eq(adopterImages.adopterId, secondaryId));
        mergeDetails.images = movedImages?.rowsAffected || 0;

        // 3. Re-point flags
        await db.update(adopterFlags)
            .set({ adopterId: primaryId })
            .where(eq(adopterFlags.adopterId, secondaryId));

        // 4. Re-point history
        await db.update(adopterHistory)
            .set({ adopterId: primaryId })
            .where(eq(adopterHistory.adopterId, secondaryId));

        // 5. Re-point stats
        await db.update(adopterStats)
            .set({ adopterId: primaryId })
            .where(eq(adopterStats.adopterId, secondaryId));

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

        // 9. Mark any pending duplicate candidates between these two as resolved
        const candidateConditions = or(
            and(eq(duplicateCandidates.adopter1Id, primaryId), eq(duplicateCandidates.adopter2Id, secondaryId)),
            and(eq(duplicateCandidates.adopter1Id, secondaryId), eq(duplicateCandidates.adopter2Id, primaryId)),
        );
        if (candidateConditions) {
            await db.update(duplicateCandidates).set({
                status: 'merged',
                resolvedAt: new Date(),
                resolvedBy: actorEmail,
            }).where(candidateConditions);
        }

        // 10. Annotate any existing duplicate-flag pairs between these two
        await db.update(adopterFlags).set({
            details: `Merged into ${primaryId} by ${actorEmail}`,
        }).where(and(
            eq(adopterFlags.reason, 'duplicate'),
            or(
                and(eq(adopterFlags.adopterId, primaryId), eq(adopterFlags.targetAdopterId, secondaryId)),
                and(eq(adopterFlags.adopterId, secondaryId), eq(adopterFlags.targetAdopterId, primaryId)),
            )
        ));

        // 11. Audit log — caller may also write its own context-specific entry
        await db.insert(auditLog).values({
            id: crypto.randomUUID(),
            userId: actorEmail,
            userEmail: actorEmail,
            action: 'adopter_merge',
            target: primaryId,
            details: JSON.stringify({
                primaryId,
                secondaryId,
                secondaryName: secondary.name,
                mergeDetails,
            }),
            createdAt: new Date(),
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
        };
    } catch (error) {
        const errorId = logger.error('mergeAdopters failed', error, { primaryId, secondaryId, actor: actorEmail });
        return { success: false, error: `Merge failed (Error ID: ${errorId})` };
    }
}

/**
 * Permission-gated wrapper around `mergeAdopters` for the DuplicateHint
 * surface (user types an identifier that matches another adopter, clicks
 * "Fusionar"). Caller must own at least one of the two profiles OR be
 * admin — same gate `dismissDuplicateCandidate` enforces. Other merge
 * surfaces (admin route, contract-attach) have their own gates and call
 * `mergeAdopters` directly.
 */
export async function mergeAdoptersFromHint(
    primaryId: string,
    secondaryId: string,
): Promise<MergeAdoptersResult> {
    try {
        const { getUser } = await import('./_db');
        const { isAdminAsync } = await import('@/config/admins');
        const actorEmail = await getUser();
        if (!actorEmail) return { success: false, error: 'Not authenticated' };

        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available' };

        const [a, b] = await Promise.all([
            db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, primaryId)).get(),
            db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, secondaryId)).get(),
        ]);
        if (!a || !b) return { success: false, error: 'One or both adopters not found' };

        const isOwner = a.addedBy === actorEmail || b.addedBy === actorEmail;
        const isAdminUser = await isAdminAsync(actorEmail);
        if (!isOwner && !isAdminUser) {
            return { success: false, error: 'Not authorized — you must own one of the two profiles or be an admin' };
        }

        return await mergeAdopters(primaryId, secondaryId, actorEmail);
    } catch (error) {
        const errorId = logger.error('mergeAdoptersFromHint failed', error, { primaryId, secondaryId });
        return { success: false, error: `Merge failed (Error ID: ${errorId})` };
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
            tokens.push({ type: 'social', value: social.toLowerCase().trim() });
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
