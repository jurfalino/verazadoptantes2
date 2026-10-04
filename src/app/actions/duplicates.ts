'use server';

import { adopters, adopterFlags, adopterStats, duplicateTokens, duplicateCandidates, auditLog } from '@/db/schema';
import { eq, or, and, inArray, sql, isNull } from 'drizzle-orm';
import { logger, generateErrorId } from '@/lib/logger';
import { getDb, getUser } from './_db';
import { decideDedupMerge, type DedupSide } from '@/domain/dedupPair';
import { normalizeText, extractPhones, extractEmails, extractSocials, normalizeSocialHandle, detectSocialPlatformFromValue } from '@/lib/tokenizer';
import { normalizeConfidence, confidenceBand, fuzzyNameScore, storedScoreToPercent, PRACTICAL_MAX_DUPLICATE } from '@/lib/scoring';

import { mergeAdopters } from '@/lib/adopterMerge';

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
        // Signed-in, and only for a profile of the caller's (or her team's):
        // the keep-new button sits on her own contract-results page, whose
        // orphan profile was auto-created under her name. Anything else would
        // let anyone write unlimited analytics rows for any adopter.
        try { actorEmail = await getUser(); } catch {
            logger.warn('markContractKeepNew: refused — no session', { adopterId });
            return { success: false };
        }

        const db = await getDb();
        if (!db) return { success: false };

        const target = await db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, adopterId)).get();
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        if (!target || !(await isOwnerOrOrgMate(actorEmail, target.addedBy))) {
            logger.warn('markContractKeepNew: refused — not the caller\'s profile', { adopterId, actor: actorEmail });
            return { success: false };
        }

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
            // Strongest first, so weak pairs can't crowd a strong one out of the cap.
            .orderBy(sql`${duplicateCandidates.score} DESC`)
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
                    confidencePercent: storedScoreToPercent(c.score),
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

/**
 * Match types whose agreement is EXACT. Their value is present in both records,
 * so showing it to someone who owns one side discloses nothing they did not
 * already supply — which is why matched values are not masked.
 *
 * `phone_suffix` (last 8 digits) and `name_word_fuzzy` (Levenshtein) are
 * deliberately absent: those agree on part of a value, so the other record's
 * full value contains characters the viewer does not have.
 */
const EXACT_MATCH_TYPES = new Set([
    'phone', 'email', 'social', 'social_handle', 'name_full', 'name_word', 'source_url', 'id_number', 'address_word',
]);

/** Reduce an inexact match to the portion that actually matched. */
function redactInexactValue(type: string, value: string): string {
    if (EXACT_MATCH_TYPES.has(type)) return value;
    if (type === 'phone_suffix') return `••••${value.slice(-4)}`;
    // name_word_fuzzy and anything unrecognised: show the shape, not the value.
    return `${value.slice(0, 1)}…`;
}

/**
 * Build one side of a pair, masking contact detail the viewer has no right to.
 *
 * A pair qualifies for the feed when EITHER side belongs to the viewer, so the
 * other side is routinely someone else's record. Every other surface routes
 * contact through `resolveAdopterVisibility`; this one selected `contactInfo`
 * raw, which — with PII gating enabled in production — made the dedup card the
 * one place another rescuer's adopter contact was fully exposed.
 *
 * The MATCHED values stay visible (see EXACT_MATCH_TYPES): those are already in
 * the viewer's own record, so showing them discloses nothing. It is the rest of
 * the blob that gets masked.
 */
/** The adopter columns the pair builder needs before visibility is applied. */
type PairRow = { id: string; name: string; contactInfo: string | null; source: string; addedBy: string | null; createdAt: Date | null };

async function buildPairSide(
    viewerEmail: string | null | undefined,
    row: PairRow,
): Promise<PendingDedupPair['newAdopter']> {
    let contactInfo = row.contactInfo;
    let canSeeContact = true;
    try {
        const { resolveAdopterVisibility } = await import('@/lib/piiAccessServer');
        const { maskAdopterContact } = await import('@/lib/piiAccess');
        const visibility = await resolveAdopterVisibility(viewerEmail, { id: row.id, addedBy: row.addedBy });
        if (!visibility.nothingMasked) {
            const masked = maskAdopterContact({ contactInfo: row.contactInfo, contactEntries: null, addressInfo: null }, visibility);
            contactInfo = masked.contactInfo;
            canSeeContact = masked.maskedFieldCount === 0;
        }
    } catch (e) {
        // Fail CLOSED: an unresolvable visibility must hide the contact, never
        // reveal it. The pair still renders so the merge decision survives.
        logger.warn('buildPairSide: visibility resolve failed, masking', {
            adopterId: row.id, error: e instanceof Error ? e.message : String(e),
        });
        contactInfo = null;
        canSeeContact = false;
    }
    return {
        id: row.id,
        name: row.name,
        contactInfo,
        source: row.source,
        createdAt: row.createdAt ? Math.floor(row.createdAt.getTime() / 1000) : null,
        canSeeContact,
    };
}


/** Tolerant parse of `duplicate_candidates.match_values`. Null (per-save path)
 *  or malformed JSON both degrade to "no values", never to a thrown render. */
function safeParseMatchValues(raw: string | null): Record<string, string[]> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
        }
        return out;
    } catch {
        return {};
    }
}

export interface PendingDedupPair {
    candidateId: string;
    /**
     * Where the pair came from. 'detected' is the engine (duplicate_candidates);
     * 'flagged' is a person who marked one profile a duplicate of another
     * (adopter_flags, reason='duplicate'). Those were visible only on the admin
     * screen — the one place the rescuer who raised the flag cannot go.
     *
     * Dismiss is offered only for 'detected': it writes to duplicate_candidates,
     * and a flag has no row there to update.
     */
    source: 'detected' | 'flagged';
    /** The "new" auto-created side — heuristically the more recent record. */
    newAdopter: {
        id: string;
        name: string;
        contactInfo: string | null;
        source: string;
        createdAt: number | null;
        /** False ⇒ contactInfo is masked and the card offers "ask the owner". */
        canSeeContact: boolean;
    };
    /** The "existing" side — older record. Use as merge primary. */
    existingAdopter: {
        id: string;
        name: string;
        contactInfo: string | null;
        source: string;
        createdAt: number | null;
        /** False ⇒ contactInfo is masked and the card offers "ask the owner". */
        canSeeContact: boolean;
    };
    matchTypes: string[];
    /**
     * The values that actually matched, keyed by token type — e.g.
     * `{ phone: ['5119-2702'] }`. Written by the batch rebuild; the per-save
     * path stores null, so treat an empty object as "we know the types but not
     * the values" and fall back to showing the type labels alone.
     */
    matchValues: Record<string, string[]>;
    confidence: string;
    confidencePercent: number;
}

/**
 * «Combinar perfiles» on /my-adopters (PendingDedup). The ONLY browser door to
 * a merge: the actor comes from the session, never from the caller. The pair
 * must be one getPendingDuplicatesForUser lists for them (a pending
 * duplicate_candidates row, or a manual duplicate flag — the feed uses the
 * flag's id as the candidate id — where the caller created a live side), AND
 * the absorbed record must be the caller's own or a teammate's; a flag needs
 * both sides in the team (decideDedupMerge, src/domain/dedupPair.ts). The
 * older record survives, as the card shows. The merge itself is the shared
 * mergeAdopters (src/lib/adopterMerge.ts).
 */
export async function mergePendingDedupPair(candidateId: string): Promise<{ success: boolean; error?: string; errorId?: string }> {
    let actorEmail: string | null = null;
    try {
        try { actorEmail = await getUser(); } catch { actorEmail = null; }
        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available', errorId: generateErrorId() };

        let pair: { a: string; b: string; source: 'detected' | 'flag' } | null = null;
        if (typeof candidateId === 'string' && candidateId.trim()) {
            const cand = await db.select({ a: duplicateCandidates.adopter1Id, b: duplicateCandidates.adopter2Id, status: duplicateCandidates.status })
                .from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).get();
            if (cand && cand.status === 'pending') pair = { a: cand.a, b: cand.b, source: 'detected' };
            if (!cand) {
                const flag = await db.select({ a: adopterFlags.adopterId, b: adopterFlags.targetAdopterId, reason: adopterFlags.reason })
                    .from(adopterFlags).where(eq(adopterFlags.id, candidateId)).get();
                if (flag && flag.reason === 'duplicate' && flag.b) pair = { a: flag.a, b: flag.b, source: 'flag' };
            }
        }
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        const load = async (id: string): Promise<DedupSide | null> => {
            const r = await db.select({ id: adopters.id, addedBy: adopters.addedBy, createdAt: adopters.createdAt, deletedAt: adopters.deletedAt })
                .from(adopters).where(eq(adopters.id, id)).get();
            if (!r) return null;
            return {
                id: r.id, addedBy: r.addedBy, createdAt: r.createdAt ? r.createdAt.getTime() : null, deleted: !!r.deletedAt,
                teamOwned: !!actorEmail && await isOwnerOrOrgMate(actorEmail, r.addedBy),
            };
        };
        const [a, b] = pair ? await Promise.all([load(pair.a), load(pair.b)]) : [null, null];
        const decision = decideDedupMerge(actorEmail, a, b, pair?.source);
        if (!decision.ok) {
            const errorId = generateErrorId();
            logger.warn('mergePendingDedupPair: refused', { candidateId, actorEmail, reason: decision.reason, errorId });
            return { success: false, error: decision.reason, errorId };
        }
        const result = await mergeAdopters(decision.primaryId, decision.secondaryId, actorEmail!);
        if (!result.success) {
            const errorId = logger.error('mergePendingDedupPair: merge failed', new Error(result.error ?? 'merge failed'), {
                candidateId, actorEmail, primaryId: decision.primaryId, secondaryId: decision.secondaryId,
            });
            return { success: false, error: 'merge_failed', errorId };
        }
        logger.info('mergePendingDedupPair: merged', { candidateId, actorEmail, primaryId: decision.primaryId, secondaryId: decision.secondaryId });
        return { success: true };
    } catch (e) {
        const errorId = logger.error('mergePendingDedupPair failed', e, { candidateId, actorEmail });
        return { success: false, error: 'merge_failed', errorId };
    }
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
export async function getPendingDuplicatesForUser(
    page = 1,
    pageSize = 10,
    includeLow = false,
): Promise<{ pairs: PendingDedupPair[]; total: number; lowHidden: number }> {
    const EMPTY = { pairs: [] as PendingDedupPair[], total: 0, lowHidden: 0 };
    try {
        const { getUser } = await import('./_db');
        const actorEmail = await getUser();

        const db = await getDb();
        if (!db) return EMPTY;

        const candidates = await db.select({
            candidateId: duplicateCandidates.id,
            adopter1Id: duplicateCandidates.adopter1Id,
            adopter2Id: duplicateCandidates.adopter2Id,
            matchTypes: duplicateCandidates.matchTypes,
            matchValues: duplicateCandidates.matchValues,
            score: duplicateCandidates.score,
            confidence: duplicateCandidates.confidence,
            detectedAt: duplicateCandidates.detectedAt,
        })
            .from(duplicateCandidates)
            .where(eq(duplicateCandidates.status, 'pending'))
            .all() as Array<{ candidateId: string; adopter1Id: string; adopter2Id: string; matchTypes: string; matchValues: string | null; score: number; confidence: string; detectedAt: Date | null }>;

        if (candidates.length === 0) return EMPTY;

        // ── Rank and page on the CANDIDATE rows, before fetching any adopter ──
        //
        // Everything needed to order lives on duplicate_candidates: `score`
        // (already a percentage), `confidence`, `detected_at`. The previous
        // shape fetched one adopter row per id across every pending candidate —
        // ~379 subrequests on staging, ~1200 in production — sorted, then
        // discarded all but ten. v2.56.30 then added ~5 queries per side on top,
        // which pushed the request past the Workers subrequest ceiling:
        // /my-adopters rendered two error toasts and no duplicates at all.
        //
        // The fan-out is now bounded by pageSize instead of corpus size.
        const ownRows = await db.select({ id: adopters.id }).from(adopters)
            .where(and(eq(adopters.addedBy, actorEmail), isNull(adopters.deletedAt))).all();
        const ownIds = new Set((ownRows as Array<{ id: string }>).map(r => r.id));
        if (ownIds.size === 0) return EMPTY;

        // The actor must own at least one side of the pair.
        const mine = candidates.filter(c => ownIds.has(c.adopter1Id) || ownIds.has(c.adopter2Id));

        // Manually flagged duplicates (adopter_flags, reason='duplicate') join
        // the same queue — they were visible only on /admin/duplicates, the one
        // screen the rescuer who raised the flag cannot open. Converted to the
        // candidate shape here so they rank and page through the identical
        // path; one query, and their adopter rows come from the page fan-out
        // below rather than a fan-out of their own.
        try {
            const flags = await db.select({
                id: adopterFlags.id,
                adopterId: adopterFlags.adopterId,
                targetAdopterId: adopterFlags.targetAdopterId,
                createdAt: adopterFlags.createdAt,
            }).from(adopterFlags).where(eq(adopterFlags.reason, 'duplicate')).limit(100).all();

            const seen = new Set(mine.map(c => [c.adopter1Id, c.adopter2Id].sort().join('|')));
            for (const f of flags as Array<{ id: string; adopterId: string; targetAdopterId: string | null; createdAt: Date | null }>) {
                if (!f.targetAdopterId) continue;
                if (!ownIds.has(f.adopterId) && !ownIds.has(f.targetAdopterId)) continue;
                const key = [f.adopterId, f.targetAdopterId].sort().join('|');
                if (seen.has(key)) continue; // the engine already found this pair
                seen.add(key);
                mine.push({
                    candidateId: f.id,
                    adopter1Id: f.adopterId,
                    adopter2Id: f.targetAdopterId,
                    matchTypes: JSON.stringify(['flagged_by_user']),
                    matchValues: null,
                    score: 100,
                    confidence: 'high',
                    detectedAt: f.createdAt,
                });
            }
        } catch (e) {
            // A flag-fetch failure must not take out the detected list.
            logger.warn('getPendingDuplicatesForUser: flagged-pair fetch failed', {
                error: e instanceof Error ? e.message : String(e),
            });
        }

        if (mine.length === 0) return EMPTY;

        const lowHidden = mine.filter(c => c.confidence === 'low').length;
        const eligible = includeLow ? mine : mine.filter(c => c.confidence !== 'low');

        // Strongest match first; ties break on detection time so a page is
        // stable across loads. (Ties used to break on adopters.createdAt, which
        // required the very fetch this ordering exists to avoid.)
        eligible.sort((x, y) =>
            (storedScoreToPercent(y.score) - storedScoreToPercent(x.score))
            || ((y.detectedAt?.getTime() ?? 0) - (x.detectedAt?.getTime() ?? 0)));

        const total = eligible.length;
        const start = Math.max(0, (page - 1) * pageSize);
        const pageCandidates = eligible.slice(start, start + pageSize);
        if (pageCandidates.length === 0) return { pairs: [], total, lowHidden };

        // Fan out only over the ids on THIS page: at most 2 × pageSize.
        const ids = new Set<string>();
        for (const c of pageCandidates) { ids.add(c.adopter1Id); ids.add(c.adopter2Id); }
        const rows = await Promise.all([...ids].map(id => db.select({
            id: adopters.id,
            name: adopters.name,
            contactInfo: adopters.contactInfo,
            source: adopters.source,
            addedBy: adopters.addedBy,
            createdAt: adopters.createdAt,
            deletedAt: adopters.deletedAt,
        }).from(adopters).where(eq(adopters.id, id)).get()));
        const byId = new Map<string, PairRow & { deletedAt: Date | null }>();
        for (const r of rows) if (r) byId.set(r.id, r as PairRow & { deletedAt: Date | null });

        // Visibility is resolved once per adopter, not once per appearance.
        const sideCache = new Map<string, PendingDedupPair['newAdopter']>();
        const side = async (row: PairRow) => {
            const hit = sideCache.get(row.id);
            if (hit) return hit;
            const built = await buildPairSide(actorEmail, row);
            sideCache.set(row.id, built);
            return built;
        };

        const pairs: PendingDedupPair[] = [];
        for (const c of pageCandidates) {
            const a = byId.get(c.adopter1Id);
            const b = byId.get(c.adopter2Id);
            if (!a || !b) continue;
            if (a.deletedAt || b.deletedAt) continue; // merged elsewhere meanwhile

            // Newer record is the "new" side; older is the merge primary.
            const aMs = a.createdAt?.getTime() ?? 0;
            const bMs = b.createdAt?.getTime() ?? 0;
            const newOne = aMs >= bMs ? a : b;
            const oldOne = aMs >= bMs ? b : a;

            pairs.push({
                candidateId: c.candidateId,
                source: c.matchTypes.includes('flagged_by_user') ? 'flagged' : 'detected',
                newAdopter: await side(newOne),
                existingAdopter: await side(oldOne),
                matchTypes: JSON.parse(c.matchTypes || '[]') as string[],
                matchValues: Object.fromEntries(
                    Object.entries(safeParseMatchValues(c.matchValues))
                        .map(([type, vals]) => [type, vals.map(v => redactInexactValue(type, v))]),
                ),
                confidence: c.confidence,
                confidencePercent: storedScoreToPercent(c.score),
            });
        }

        return { pairs, total, lowHidden };
    } catch (error) {
        logger.warn('getPendingDuplicatesForUser failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return EMPTY;
    }
}

export async function dismissDuplicateCandidate(candidateId: string): Promise<{
    success: boolean;
    /**
     * Stable machine code for the UI to translate. `error` stays as an English
     * fallback for logs and older callers — it must never reach a user, who
     * reads whichever locale they chose. See `errors.dedup_*` in the locales.
     */
    code?: 'not_found' | 'already_resolved' | 'not_authorized' | 'no_db' | 'failed';
    error?: string;
}> {
    try {
        const { getUser } = await import('./_db');
        const { isAdminAsync } = await import('@/config/admins');
        const actorEmail = await getUser();

        const db = await getDb();
        if (!db) return { success: false, code: 'no_db', error: 'Database not available' };

        const candidate = await db.select({
            id: duplicateCandidates.id,
            adopter1Id: duplicateCandidates.adopter1Id,
            adopter2Id: duplicateCandidates.adopter2Id,
            status: duplicateCandidates.status,
        }).from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).get();

        if (!candidate) return { success: false, code: 'not_found', error: 'Candidate not found' };
        if (candidate.status !== 'pending') return { success: false, code: 'already_resolved', error: 'Candidate already resolved' };

        const [a, b] = await Promise.all([
            db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, candidate.adopter1Id)).get(),
            db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, candidate.adopter2Id)).get(),
        ]);

        const isOwner = (a?.addedBy === actorEmail) || (b?.addedBy === actorEmail);
        const isAdminUser = await isAdminAsync(actorEmail);

        if (!isOwner && !isAdminUser) {
            return { success: false, code: 'not_authorized', error: 'Not authorized to dismiss this pair' };
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
