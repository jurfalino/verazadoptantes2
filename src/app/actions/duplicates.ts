'use server';

import { adopters, adopterFlags, adopterStats, duplicateTokens, duplicateCandidates, auditLog, mergeRequests, pendingPairHidden } from '@/db/schema';
import { eq, or, and, inArray, sql, isNull, asc, desc } from 'drizzle-orm';
import { logger, generateErrorId } from '@/lib/logger';
import { getDb, getUser } from './_db';
import { decideDedupAction, isOpenDuplicateFlag, keepOptions, KEPT_SEPARATE_FLAG_DETAILS_PREFIX, pairKey, realOwner, type DedupSide } from '@/domain/dedupPair';
import { needsIdentityChoice } from '@/domain/identityChoice';
import { matchBreakdown, summarizeBreakdown, type BreakdownField } from '@/domain/matchBreakdown';
import { deserializeContactEntries, parseBlobToContactEntries } from '@/lib/contactEntries';
import { getTeamEmails, normEmail } from '@/lib/orgMembership';
import { emailHandle } from '@/lib/userDisplay';
import { normalizeText, extractPhones, extractEmails, extractSocials, normalizeSocialHandle, detectSocialPlatformFromValue } from '@/lib/tokenizer';
import { normalizeConfidence, confidenceBand, fuzzyNameScore, storedScoreToPercent, PRACTICAL_MAX_DUPLICATE } from '@/lib/scoring';

import { mergeAdopters, notifyMergeOwners } from '@/lib/adopterMerge';
import { createMergeRequest, keepSeparate, settleRequestsAsHousehold } from '@/lib/mergeRequests';
import { grantAccessAfterFold } from '@/lib/mergeAccess';
import { isAdminAsync } from '@/config/admins';
import { addHouseholdMember } from './householdMembers';

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
    // Signed-in only (the profile page and its flagging panel both are): the
    // result names the other profiles that look like this one.
    try { await getUser(); } catch {
        logger.warn('getDuplicateCandidates: refused — no session', { adopterId });
        return [];
    }
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
    names: ReadonlyMap<string, string>,
): Promise<PendingDedupSide> {
    let contactInfo = row.contactInfo;
    let contactEntries: string | null = null;
    let canSeeContact = true;
    try {
        const { resolveAdopterVisibility } = await import('@/lib/piiAccessServer');
        const { maskAdopterContact } = await import('@/lib/piiAccess');
        const visibility = await resolveAdopterVisibility(viewerEmail, { id: row.id, addedBy: row.addedBy });
        if (!visibility.nothingMasked) {
            // Typed entries from the blob, so the masked result carries a typed list
            // the comparison table can read (re-parsing masked text mislabels it).
            const { parseBlobToContactEntries } = await import('@/lib/contactEntries');
            const typed = parseBlobToContactEntries(row.contactInfo);
            const masked = maskAdopterContact({ contactInfo: row.contactInfo, contactEntries: typed.length ? JSON.stringify(typed) : null, addressInfo: null }, visibility);
            contactInfo = masked.contactInfo;
            contactEntries = masked.contactEntries;
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
        contactEntries,
        source: row.source,
        createdAt: row.createdAt ? Math.floor(row.createdAt.getTime() / 1000) : null,
        canSeeContact,
        isMine: !!realOwner(row.addedBy) && normEmail(row.addedBy) === normEmail(viewerEmail),
        ...creatorLabel(viewerEmail, row.addedBy, names),
    };
}

/** "Cargado por …" for one side (D1, D15): nothing for the viewer's own record. */
function creatorLabel(
    viewerEmail: string | null | undefined,
    addedBy: string | null,
    names: ReadonlyMap<string, string>,
): Pick<PendingDedupSide, 'createdByName' | 'createdByAnonymous'> {
    const creator = realOwner(addedBy);
    if (!creator) return { createdByName: null, createdByAnonymous: true };
    if (normEmail(creator) === normEmail(viewerEmail)) return { createdByName: null, createdByAnonymous: false };
    return { createdByName: names.get(creator) || emailHandle(creator), createdByAnonymous: false };
}

/** A pending or owner-declined merge request as the feed sees it, keyed to its pair. */
type FeedRequestRow = {
    id: string; primaryId: string; secondaryId: string; candidateId: string | null; flagId: string | null;
    requesterEmail: string; ownerEmail: string | null; createdAt: Date | null;
    status: 'pending' | 'declined'; resolvedByEmail: string | null; resolvedAt: Date | null;
};
/** Per query: no one has anywhere near this many open requests. */
const OPEN_REQUESTS_CAP = 100;
/**
 * Declined requests never leave the table, so they get their own (smaller)
 * cap, newest first — they must never crowd pending ones out of the feed.
 */
const DECLINED_REQUESTS_CAP = 50;

/**
 * The merge requests the viewer filed, or that ask the viewer or a teammate
 * (D16), one per pair: the pending one (the oldest, should two have been filed
 * at once), else the latest owner decline — a declined pair stays on both
 * lists as «Rechazado» (D27); an admin's decline resolved the pair. TWO
 * queries in parallel (pending, declined), each `requester = ? OR owner = ? OR
 * owner = ? …` — one bind per email (D1-safe, never `IN (array)`) however
 * large the team, since this feed already sits close to the Workers
 * subrequest ceiling (see the ranking note in getPendingDuplicatesForUser).
 * ≤ 31 binds each.
 */
async function loadRequestsByPair(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    actorEmail: string,
    team: readonly string[],
): Promise<Map<string, FeedRequestRow>> {
    const columns = {
        id: mergeRequests.id,
        primaryId: mergeRequests.primaryId,
        secondaryId: mergeRequests.secondaryId,
        candidateId: mergeRequests.candidateId,
        flagId: mergeRequests.flagId,
        requesterEmail: mergeRequests.requesterEmail,
        ownerEmail: mergeRequests.ownerEmail,
        createdAt: mergeRequests.createdAt,
        status: mergeRequests.status,
        resolvedByEmail: mergeRequests.resolvedByEmail,
        resolvedAt: mergeRequests.resolvedAt,
    };
    // Both columns are stored normalized (createMergeRequest); so are these.
    const involves = or(eq(mergeRequests.requesterEmail, normEmail(actorEmail)), ...team.map(e => eq(mergeRequests.ownerEmail, normEmail(e))));
    const [pending, declined] = await Promise.all([
        db.select(columns).from(mergeRequests).where(and(eq(mergeRequests.status, 'pending'), involves))
            .orderBy(asc(mergeRequests.createdAt)).limit(OPEN_REQUESTS_CAP).all() as Promise<FeedRequestRow[]>,
        db.select(columns).from(mergeRequests).where(and(eq(mergeRequests.status, 'declined'), involves))
            .orderBy(desc(mergeRequests.createdAt)).limit(DECLINED_REQUESTS_CAP).all() as Promise<FeedRequestRow[]>,
    ]);
    const byPair = new Map<string, FeedRequestRow>();
    // Pending first: an open question beats an earlier «no» on the same pair.
    for (const r of [...pending, ...declined]) {
        const key = pairKey(r.primaryId, r.secondaryId);
        if (!byPair.has(key)) byPair.set(key, r);
    }
    return byPair;
}

/**
 * The pairs this viewer took off their list («Quitar de la lista», D27). One
 * query. A failed lookup shows them again rather than taking out the feed.
 */
async function loadHiddenPairKeys(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    actorEmail: string,
): Promise<Set<string>> {
    try {
        const rows = await db.select({ pairKey: pendingPairHidden.pairKey }).from(pendingPairHidden)
            .where(eq(pendingPairHidden.viewerEmail, normEmail(actorEmail))).all() as Array<{ pairKey: string }>;
        return new Set(rows.map(r => r.pairKey));
    } catch (e) {
        logger.warn('getPendingDuplicatesForUser: hidden pairs unreadable, showing them', {
            actorEmail, error: e instanceof Error ? e.message : String(e),
        });
        return new Set();
    }
}

/**
 * Display names (else nothing — callers fall back to the email handle) for the
 * people a feed page mentions. A failed lookup degrades to handles, logged.
 */
async function resolvePeopleNames(emails: string[], actorEmail: string): Promise<Map<string, string>> {
    if (emails.length === 0) return new Map();
    try {
        const { resolveUserNames } = await import('./userNames');
        return new Map(Object.entries(await resolveUserNames(emails)));
    } catch (e) {
        logger.warn('getPendingDuplicatesForUser: names unresolved, showing handles', {
            actorEmail, count: emails.length, error: e instanceof Error ? e.message : String(e),
        });
        return new Map();
    }
}

/** The card's request line (D7, D8, D15, D27, D28): who it waits on, who asked, who declined. */
function requestView(
    r: FeedRequestRow,
    actorEmail: string,
    teamKeys: ReadonlySet<string>,
    names: ReadonlyMap<string, string>,
): NonNullable<PendingDedupPair['request']> {
    const direction = normEmail(r.requesterEmail) === normEmail(actorEmail) ? 'sent' : 'received';
    const counterpart = direction === 'sent' ? r.ownerEmail : r.requesterEmail;
    const nameOf = (email: string) => names.get(email) || emailHandle(email);
    const declined = r.status === 'declined';
    // Whoever declined: the owner or a teammate (D16). Not named to themselves.
    const decliner = declined ? (r.resolvedByEmail ?? r.ownerEmail) : null;
    return {
        id: r.id,
        status: r.status,
        direction,
        createdAt: r.createdAt ? Math.floor(r.createdAt.getTime() / 1000) : 0,
        counterpartName: counterpart ? nameOf(counterpart) : null,
        toAdmins: r.ownerEmail === null,
        // The same rule sendPairMessage enforces: requester ⇄ owner team, never the admins.
        canMessage: !!r.ownerEmail && (direction === 'sent' || teamKeys.has(normEmail(r.ownerEmail))),
        declinedAt: declined && r.resolvedAt ? Math.floor(r.resolvedAt.getTime() / 1000) : null,
        declinedByName: decliner && normEmail(decliner) !== normEmail(actorEmail) ? nameOf(decliner) : null,
    };
}

/** A side's contact as the card shows it to this viewer (masked typed list, else the visible text). */
function entriesAsShown(side: PendingDedupSide): Array<{ type: string; value: string }> {
    return (side.contactEntries ? deserializeContactEntries(side.contactEntries) : parseBlobToContactEntries(side.contactInfo))
        .map(e => ({ type: e.type, value: e.value }));
}

/** Order of the groups on the list (D21). */
const GROUP_ORDER: ReadonlyArray<PendingDedupPair['group']> = ['received', 'sent', 'declined', 'pair'];

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
    newAdopter: PendingDedupSide;
    /** The "existing" side — older record. Use as merge primary. */
    existingAdopter: PendingDedupSide;
    matchTypes: string[];
    /**
     * The values that actually matched, keyed by token type — e.g.
     * `{ phone: ['5119-2702'] }`. Written by the batch rebuild; the per-save
     * path stores null, so treat an empty object as "we know the types but not
     * the values" and fall back to showing the type labels alone.
     */
    matchValues: Record<string, string[]>;
    confidence: string;
    /** The engine's score — admins only (null for everyone else, D22). Superseded by `adminScore`. */
    confidencePercent: number | null;
    /**
     * The match % behind the admin gauge (D22). null for rescuers, and for
     * flagged pairs and pairs rebuilt from a request, whose 100 is made up (D34).
     */
    adminScore: number | null;
    /**
     * Where the row sits (D21), in this order: 'received' (a pending request
     * asks the viewer or their team), 'sent' (the viewer's pending request),
     * 'declined' (an owner declined a request, either side, D27), 'pair'
     * (a possible duplicate with no request).
     */
    group: 'received' | 'sent' | 'declined' | 'pair';
    /**
     * The closed row's «Coinciden: … · Distinto: …» (D22), from matchBreakdown
     * on what this viewer may see (new side = the rescuer's data, existing side
     * = the profile, as the card compares them). `flagged`: a person marked the
     * pair («Marcado manualmente»).
     */
    summary: { same: BreakdownField[]; diff: BreakdownField[]; flagged: boolean };
    /**
     * What «Combinar» does for this viewer with the default survivor (the
     * older side when `keepOptions` allows it, else the one it allows), so the
     * button says so: 'merge' merges now («Combinar perfiles»); 'request' asks
     * the other profile's owner («Pedir combinar»). The same decideDedupAction
     * mergePendingDedupPair runs on click; admins' choices merge straight away
     * (D24). A refusal (the viewer created neither side — only listed for a
     * request, whose card shows no button) reads 'merge'.
     */
    mergeAction: 'merge' | 'request';
    /** Which side the viewer may keep («¿Cuál se conserva?», D24, D42). Admins: either. */
    keepOptions: { new: boolean; existing: boolean };
    /** Combining asks «¿Es la misma persona?» first (D35): the same test mergePendingDedupPair applies. */
    identityChoice: boolean;
    /**
     * The merge request on this pair, if any: pending — one the viewer filed
     * ('sent', D8) or one asking the viewer or a teammate ('received', D7,
     * D16) — or declined by the owner team, shown to both sides until the
     * viewer hides the pair (D27). An admin's decline resolves the pair.
     */
    request: null | {
        id: string;
        status: 'pending' | 'declined';
        direction: 'sent' | 'received';
        createdAt: number; // epoch s
        /** 'sent': the asked owner (null when it went to the admins); 'received': the requester. Name or handle, never an email. */
        counterpartName: string | null;
        /** No real owner, so the admins decide (D15). */
        toAdmins: boolean;
        /** «Escribirle» (D28): requester ⇄ owner team, never a request to the admins. */
        canMessage: boolean;
        /** When it was declined (epoch s); null while pending. */
        declinedAt: number | null;
        /** Who declined («Rechazado por María»), name or handle; null while pending and when the viewer declined it. */
        declinedByName: string | null;
    };
}

export interface PendingDedupSide {
    id: string;
    name: string;
    contactInfo: string | null;
    /** Masked typed entries (JSON) when this viewer can't see everything; null = read contactInfo. */
    contactEntries: string | null;
    source: string;
    createdAt: number | null;
    /** False ⇒ contactInfo is masked and the card offers "ask the owner". */
    canSeeContact: boolean;
    /** Who created this profile (display name, else email handle) — null for the viewer's own, and for no real creator (D1). */
    createdByName: string | null;
    /** No real creator (`added_by` null, '' or 'anonymous'): "Cargado por un usuario anónimo" (D15). */
    createdByAnonymous: boolean;
    /** The viewer created this profile («Tuyo», D22–D23). */
    isMine: boolean;
}

/**
 * «Combinar perfiles» on /my-adopters (PendingDedup). The ONLY browser door to
 * a merge: the actor comes from the session, never from the caller. The pair
 * must be one getPendingDuplicatesForUser lists for them (a pending
 * duplicate_candidates row, or a manual duplicate flag — the feed uses the
 * flag's id as the candidate id — where the caller created a live side).
 *
 * v2 (spec 2026-10-25-pendientes-d): `opts.keepId` is the profile the rescuer
 * chose to keep (D24; default: the older one). The server never trusts it:
 * decideDedupAction (src/domain/dedupPair.ts) re-decides — a keepId outside
 * the pair is `not_found`; keeping the other rescuer's profile merges now and
 * tells them (`adopter_merged`); keeping yours while the other is someone
 * else's files a merge request to them and their team, or to the admins when
 * there is no real owner (createMergeRequest, src/lib/mergeRequests.ts) —
 * unless that requester was already declined on this pair (`declined_before`,
 * D43). An ownerless profile can't be kept (`keep_not_allowed`, D42). Admins
 * choose freely: their choice merges straight away and the owners are told.
 *
 * Different names matched on a contact ask «¿Es la misma persona?» first
 * (`identity_required`, D35); `identity: 'household'` is accepted only there
 * (`identity_not_applicable` otherwise) and merges nothing: the
 * other person is added by name, linked, to each side the caller's team owns
 * (never another rescuer's profile), and the pair is resolved as kept-separate.
 *
 * Every merge is the shared mergeAdopters (src/lib/adopterMerge.ts); after it
 * the absorbed profile's owner team keeps access to the survivor (D40).
 */
export async function mergePendingDedupPair(candidateId: string, opts?: { keepId?: string; identity?: 'same' | 'household' }): Promise<
    | { success: true; outcome: 'merged' }
    | { success: true; outcome: 'household' }
    | { success: true; outcome: 'requested'; toName: string | null; toAdmins: boolean }
    | { success: false; error: string; errorId?: string }
> {
    let actorEmail: string | null = null;
    // From the browser: only a string keepId and a known identity answer count.
    const chosenKeepId = typeof opts?.keepId === 'string' && opts.keepId ? opts.keepId : undefined;
    const identity = opts?.identity === 'same' || opts?.identity === 'household' ? opts.identity : undefined;
    try {
        try { actorEmail = await getUser(); } catch { actorEmail = null; }
        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available', errorId: generateErrorId() };
        const refuse = (reason: string) => {
            const errorId = generateErrorId();
            logger.warn('mergePendingDedupPair: refused', { candidateId, actorEmail, reason, keepId: chosenKeepId, identity, errorId });
            return { success: false as const, error: reason, errorId };
        };

        let pair: { a: string; b: string; source: 'detected' | 'flag'; matchTypes: string[] } | null = null;
        if (typeof candidateId === 'string' && candidateId.trim()) {
            const cand = await db.select({ a: duplicateCandidates.adopter1Id, b: duplicateCandidates.adopter2Id, status: duplicateCandidates.status, matchTypes: duplicateCandidates.matchTypes })
                .from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).get();
            if (cand && cand.status === 'pending') pair = { a: cand.a, b: cand.b, source: 'detected', matchTypes: parseMatchTypes(cand.matchTypes, candidateId) };
            if (!cand) {
                const flag = await db.select({ adopterId: adopterFlags.adopterId, targetAdopterId: adopterFlags.targetAdopterId, reason: adopterFlags.reason, details: adopterFlags.details })
                    .from(adopterFlags).where(eq(adopterFlags.id, candidateId)).get();
                if (flag && isOpenDuplicateFlag(flag)) pair = { a: flag.adopterId, b: flag.targetAdopterId!, source: 'flag', matchTypes: ['flagged_by_user'] };
            }
        }
        const { isOwnerOrOrgMate, normEmail } = await import('@/lib/orgMembership');
        const load = async (id: string): Promise<(DedupSide & { name: string }) | null> => {
            const r = await db.select({ id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, createdAt: adopters.createdAt, deletedAt: adopters.deletedAt })
                .from(adopters).where(eq(adopters.id, id)).get();
            if (!r) return null;
            return {
                id: r.id, name: r.name ?? '', addedBy: r.addedBy, createdAt: r.createdAt ? r.createdAt.getTime() : null, deleted: !!r.deletedAt,
                teamOwned: !!actorEmail && await isOwnerOrOrgMate(actorEmail, r.addedBy),
            };
        };
        const [a, b] = pair ? await Promise.all([load(pair.a), load(pair.b)]) : [null, null];
        // No choice sent: keep the older one (the card's default), so the
        // chosen-survivor rules always apply. Ties keep `b`, as before.
        const keepId = chosenKeepId ?? (a && b ? ((a.createdAt ?? 0) >= (b.createdAt ?? 0) ? b.id : a.id) : undefined);
        const action = decideDedupAction(actorEmail, a, b, pair?.source, keepId);
        // Who may touch this pair at all, whatever is kept.
        if (action.kind === 'refuse' && action.reason !== 'keep_not_allowed') return refuse(action.reason);
        const sideA = a!, sideB = b!, actor = actorEmail!;

        // «¿Es la misma persona?» (D35): a detected pair matched on a contact
        // but not on the (different) names. A flag is a person saying "same".
        const asksIdentity = pair!.source === 'detected'
            && needsIdentityChoice({ matchTypes: pair!.matchTypes, nameA: sideA.name, nameB: sideB.name });
        if (!identity && asksIdentity) return refuse('identity_required');
        if (identity === 'household') {
            // Only offered where the question is asked (D35).
            if (!asksIdentity) return refuse('identity_not_applicable');
            return await keepAsHousehold(db, candidateId, actor, sideA, sideB);
        }

        // Admins choose freely (D24): no consent needed, any side may be kept.
        let viaAdmin = false;
        let plan: { primaryId: string; secondaryId: string } | null = action.kind === 'refuse' ? null : action;
        if ((action.kind === 'request' || action.kind === 'refuse') && await isAdminAsync(actor)) {
            viaAdmin = true;
            plan = { primaryId: keepId!, secondaryId: keepId === sideA.id ? sideB.id : sideA.id };
        }
        if (!plan) return refuse(action.kind === 'refuse' ? action.reason : 'not_found');
        const { primaryId, secondaryId } = plan;

        if (action.kind === 'request' && !viaAdmin) {
            const fromFlag = pair!.source === 'flag';
            const filed = await createMergeRequest(db, {
                primaryId, secondaryId,
                candidateId: fromFlag ? null : candidateId,
                flagId: fromFlag ? candidateId : null,
                requesterEmail: actor,
                ownerEmail: action.ownerEmail,
            });
            if ('refused' in filed) return refuse(filed.refused);
            const { id: requestId, created, requesterEmail } = filed;
            // Someone else already asked about this pair (possibly asking the
            // caller): not "your request was sent" — nothing was filed or sent.
            if (!created && normEmail(requesterEmail) !== normEmail(actor)) {
                const errorId = generateErrorId();
                logger.warn('mergePendingDedupPair: request already pending', { candidateId, actorEmail, requestId, errorId });
                return { success: false, error: 'request_pending', errorId };
            }
            logger.info('mergePendingDedupPair: requested', { candidateId, actorEmail, requestId, created, primaryId, secondaryId });
            // Who was asked, so the toast names the right person. Display name
            // or email handle, never the address; null when the admins decide.
            const toAdmins = action.ownerEmail === null;
            let toName: string | null = null;
            if (action.ownerEmail) {
                const { resolveDisplayName } = await import('./notifications');
                toName = await resolveDisplayName(action.ownerEmail).catch(() => action.ownerEmail!.split('@')[0]);
                if (toName.includes('@')) toName = toName.split('@')[0];
            }
            return { success: true, outcome: 'requested', toName, toAdmins };
        }

        const result = await mergeAdopters(primaryId, secondaryId, actor);
        if (!result.success) {
            const errorId = logger.error('mergePendingDedupPair: merge failed', new Error(result.error ?? 'merge failed'), {
                candidateId, actorEmail, primaryId, secondaryId,
            });
            return { success: false, error: 'merge_failed', errorId };
        }
        const notifyOwner = action.kind === 'merge' ? action.notifyOwner : null;
        logger.info('mergePendingDedupPair: merged', { candidateId, actorEmail, primaryId, secondaryId, viaAdmin, notifyOwner: !!notifyOwner });
        // D40: the absorbed profile's owner team keeps seeing the survivor. Best-effort.
        const absorbed = secondaryId === sideA.id ? sideA : sideB;
        await grantAccessAfterFold(db, { survivorId: primaryId, absorbedOwnerEmail: realOwner(absorbed.addedBy), actor, mergeAuditId: result.auditId ?? null });
        if (viaAdmin) {
            // Whoever registered either profile hears that an admin joined them.
            await notifyMergeOwners({ primaryId, ...result }, actor);
        } else if (notifyOwner) {
            // Their profile absorbed the caller's record: tell them.
            const { createNotification, resolveDisplayName } = await import('./notifications');
            const requester = await resolveDisplayName(actor);
            await createNotification({
                type: 'adopter_merged',
                // Normalized: notifications are keyed (bell, email) by the
                // lowercased email, and `added_by` keeps whatever case it had.
                userId: normEmail(notifyOwner),
                title: `Se unieron dos perfiles: ${result.secondaryName ?? ''} → ${result.primaryName ?? ''}`,
                body: `${requester} combinó su perfil con el tuyo porque son la misma persona. Todo quedó en tu perfil.`,
                url: `/adopter/${primaryId}`,
                icon: '🔗',
                metadata: { primaryId, secondaryId, auditId: result.auditId ?? null },
            });
        }
        return { success: true, outcome: 'merged' };
    } catch (e) {
        const errorId = logger.error('mergePendingDedupPair failed', e, { candidateId, actorEmail });
        return { success: false, error: 'merge_failed', errorId };
    }
}

function parseMatchTypes(raw: string | null, candidateId: string): string[] {
    try {
        const v = JSON.parse(raw || '[]');
        return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
    } catch (e) {
        // Unreadable types read as "no name match" — the safer side: it asks.
        logger.warn('mergePendingDedupPair: unreadable match types', { candidateId, error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

/**
 * «No, es alguien de su hogar» (D35): nothing is merged. Each side the
 * caller's team owns gets the other person as a household member — name only,
 * relationship unknown, linked to their profile — through the same write as
 * «Agregar persona» (addHouseholdMember: owner / org-mate / admin gate, CAS,
 * history, audit). The other rescuer's profile is never touched. Then the pair
 * leaves both lists: kept-separate; a pending request asking the caller's team
 * counts as their decline, any other pending one closes
 * (settleRequestsAsHousehold).
 */
async function keepAsHousehold(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    candidateId: string,
    actor: string,
    a: DedupSide & { name: string },
    b: DedupSide & { name: string },
): Promise<{ success: true; outcome: 'household' } | { success: false; error: string; errorId: string }> {
    const ctx = { candidateId, actorEmail: actor, primaryId: a.id, secondaryId: b.id };
    for (const [own, other] of [[a, b], [b, a]] as const) {
        if (!own.teamOwned) continue;
        const res = await addHouseholdMember({ adopterId: own.id, name: other.name, relationship: 'unknown', profileId: other.id });
        if (!res.ok) {
            const errorId = 'errorId' in res && res.errorId
                ? res.errorId
                : logger.error('mergePendingDedupPair: household member not added', new Error(res.error), { ...ctx, adopterId: own.id });
            return { success: false, error: 'household_failed', errorId };
        }
    }
    await keepSeparate(db, { a: a.id, b: b.id }, actor, `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}household`, ctx);
    try {
        await settleRequestsAsHousehold(db, a.id, b.id, actor);
    } catch (e) {
        logger.warn('mergePendingDedupPair: open requests on a household pair left open', { ...ctx, error: e instanceof Error ? e.message : String(e) });
    }
    logger.info('mergePendingDedupPair: kept as household', ctx);
    return { success: true, outcome: 'household' };
}

/** A row the feed ranks and pages: a detected candidate, a duplicate flag, or a pair rebuilt from a request. */
type FeedCandidate = {
    candidateId: string; adopter1Id: string; adopter2Id: string; matchTypes: string; matchValues: string | null;
    score: number; confidence: string; detectedAt: Date | null;
    /** Rebuilt from a merge request whose candidate row is gone: its score is made up (D34). */
    rebuilt?: boolean;
};

/**
 * Pending-dedup feed for the current user's /my-adopters section.
 * Returns a page of pending candidate pairs where the current rescuer is the
 * `addedBy` on either side of the pair, plus every pair with an open merge
 * request the rescuer filed or that asks them or a teammate (D16 — a teammate
 * of the asked owner may have created neither side), and every pair whose
 * request the owner team declined (D27). Each side names its creator unless it
 * is the viewer (D1). The newer record is presented as "the new submission";
 * the older as "the existing profile" — the default survivor (D24).
 *
 * Layout D (spec 2026-10-25-pendientes-d): rows come grouped received → sent →
 * declined → possible duplicates (D21), each with its summary line, the
 * admin-only score, the survivor choices and whether combining asks
 * «¿Es la misma persona?». Pairs the viewer took off their list
 * (hidePendingPair) are skipped — unless a pending request on them needs an
 * answer, which the bell points here for.
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
    let actorEmail: string | null = null;
    try {
        const { getUser } = await import('./_db');
        const viewer = await getUser();
        actorEmail = viewer;

        const db = await getDb();
        if (!db) return EMPTY;

        // The viewer and their org-mates (fails open to the viewer alone):
        // whose open requests concern them, and whose profiles they may
        // absorb (mergeAction).
        const team = await getTeamEmails(viewer);
        const teamKeys = new Set(team.map(normEmail));

        // Merge requests the viewer is part of, by pair. A failed lookup
        // must not take out the list: the pairs still render, without the
        // request line.
        let requests = new Map<string, FeedRequestRow>();
        const [loaded, hidden, isAdmin] = await Promise.all([
            loadRequestsByPair(db, viewer, team).catch((e) => {
                logger.warn('getPendingDuplicatesForUser: merge-request fetch failed', {
                    actorEmail: viewer, error: e instanceof Error ? e.message : String(e),
                });
                return null;
            }),
            loadHiddenPairKeys(db, viewer),
            isAdminAsync(viewer).catch((e) => {
                // Degrades to the rescuer view (no score, the usual rules), never to no list.
                logger.warn('getPendingDuplicatesForUser: admin check failed, rescuer view', {
                    actorEmail: viewer, error: e instanceof Error ? e.message : String(e),
                });
                return false;
            }),
        ]);
        if (loaded) requests = loaded;
        // A hidden pair stays hidden unless someone must answer a pending
        // request on it. Dropped before the per-request checks below, so a
        // long list of hidden declines costs no subrequests.
        const isHidden = (key: string) => hidden.has(key) && requests.get(key)?.status !== 'pending';
        for (const key of [...requests.keys()]) if (isHidden(key)) requests.delete(key);

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
            .all() as FeedCandidate[];

        if (candidates.length === 0 && requests.size === 0) return EMPTY;

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
            .where(and(eq(adopters.addedBy, viewer), isNull(adopters.deletedAt))).all();
        const ownIds = new Set((ownRows as Array<{ id: string }>).map(r => r.id));
        if (ownIds.size === 0 && requests.size === 0) return EMPTY;

        // The actor must own at least one side of the pair — or be party to
        // an open request on it (filed it, or is on the asked owner's team).
        const listed = (a: string, b: string) => ownIds.has(a) || ownIds.has(b) || requests.has(pairKey(a, b));
        const hasRequest = (c: { adopter1Id: string; adopter2Id: string }) => requests.has(pairKey(c.adopter1Id, c.adopter2Id));
        const mine = candidates.filter(c => listed(c.adopter1Id, c.adopter2Id));

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
                reason: adopterFlags.reason,
                details: adopterFlags.details,
                createdAt: adopterFlags.createdAt,
            }).from(adopterFlags).where(eq(adopterFlags.reason, 'duplicate')).limit(100).all();

            const seen = new Set(mine.map(c => [c.adopter1Id, c.adopter2Id].sort().join('|')));
            for (const f of flags as Array<{ id: string; adopterId: string; targetAdopterId: string | null; reason: string | null; details: string | null; createdAt: Date | null }>) {
                // Merged (annotated) and self-pointing flags are settled; the
                // merge action refuses them too (isOpenDuplicateFlag).
                if (!f.targetAdopterId || !isOpenDuplicateFlag(f)) continue;
                if (!listed(f.adopterId, f.targetAdopterId)) continue;
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
                    rebuilt: false,
                });
            }
        } catch (e) {
            // A flag-fetch failure must not take out the detected list.
            logger.warn('getPendingDuplicatesForUser: flagged-pair fetch failed', {
                actorEmail: viewer, error: e instanceof Error ? e.message : String(e),
            });
        }

        // Every request pair is checked, one bounded lookup per open request
        // (normally a handful; ≤ the request cap), before it may rank first:
        // - Both profiles must be live. A request on a deleted profile closes
        //   with the delete (closeRequestsForDeletedAdopter); this guards
        //   against one that did not, which would otherwise rank first, count
        //   in `total` and then vanish at render, eating page-1 slots.
        // - A request whose pair has no pending candidate or open flag listed:
        //   if the row it came from is GONE (the admin rescan deletes every
        //   pending candidate and re-detects; a pair it no longer finds has no
        //   row) it still needs answering, so the pair is listed from the
        //   request itself. If the row is still there it was settled — a
        //   candidate is non-pending (every pending one is loaded above), e.g.
        //   set aside with «Mantener separados» — and the pair stays out. A
        //   flag may be open yet unlisted (the flag fetch is capped).
        // Adopter rows come from the page fan-out below.
        const listedKeys = new Set(mine.map(c => pairKey(c.adopter1Id, c.adopter2Id)));
        const checked = await Promise.all([...requests].map(async ([key, r]) => {
            try {
                const live = await db.select({ n: sql<number>`COUNT(*)` }).from(adopters).where(and(
                    or(eq(adopters.id, r.primaryId), eq(adopters.id, r.secondaryId)),
                    isNull(adopters.deletedAt),
                )).get();
                if (Number(live?.n ?? 0) < 2) return { key, r, keep: false, synthesize: false };
                if (listedKeys.has(key)) return { key, r, keep: true, synthesize: false };
                if (r.flagId) {
                    const flag = await db.select({ adopterId: adopterFlags.adopterId, targetAdopterId: adopterFlags.targetAdopterId, reason: adopterFlags.reason, details: adopterFlags.details })
                        .from(adopterFlags).where(eq(adopterFlags.id, r.flagId)).get();
                    const open = !flag || isOpenDuplicateFlag(flag);
                    return { key, r, keep: open, synthesize: open };
                }
                if (r.candidateId) {
                    const cand = await db.select({ id: duplicateCandidates.id })
                        .from(duplicateCandidates).where(eq(duplicateCandidates.id, r.candidateId)).get();
                    return { key, r, keep: !cand, synthesize: !cand };
                }
                return { key, r, keep: true, synthesize: true };
            } catch (e) {
                logger.warn('getPendingDuplicatesForUser: request pair lookup failed, listing it', {
                    actorEmail: viewer, requestId: r.id, pair: key, error: e instanceof Error ? e.message : String(e),
                });
                return { key, r, keep: true, synthesize: !listedKeys.has(key) };
            }
        }));
        const dropped = new Set<string>();
        for (const { key, r, keep, synthesize } of checked) {
            if (!keep) {
                requests.delete(key); // settled or dead: no request line, no "request first" ranking
                if (listedKeys.has(key)) dropped.add(key);
                continue;
            }
            if (!synthesize) continue;
            mine.push({
                candidateId: r.candidateId ?? r.flagId ?? r.id,
                adopter1Id: r.primaryId,
                adopter2Id: r.secondaryId,
                matchTypes: JSON.stringify(r.flagId ? ['flagged_by_user'] : []),
                matchValues: null,
                score: 100,
                confidence: 'high',
                detectedAt: r.createdAt,
                rebuilt: true,
            });
        }
        // A listed pair whose request found a profile gone: it would only
        // vanish at render after being counted. And the pairs the viewer hid.
        for (let i = mine.length - 1; i >= 0; i--) {
            const key = pairKey(mine[i].adopter1Id, mine[i].adopter2Id);
            if (dropped.has(key) || isHidden(key)) mine.splice(i, 1);
        }

        if (mine.length === 0) return EMPTY;

        // A pair someone must answer is never hidden as low-confidence: the
        // bell notification points here.
        const lowHidden = mine.filter(c => c.confidence === 'low' && !hasRequest(c)).length;
        const eligible = includeLow ? mine : mine.filter(c => c.confidence !== 'low' || hasRequest(c));

        // By group (D21): waiting on the viewer's answer, sent, declined, then
        // the possible duplicates. Request rows: newest request first.
        // Possible duplicates: strongest match, then detection time. The id
        // last, so a page is stable across loads. (Ties used to break on
        // adopters.createdAt, which required the very fetch this ordering
        // exists to avoid.)
        const groupOf = (c: FeedCandidate): PendingDedupPair['group'] => {
            const r = requests.get(pairKey(c.adopter1Id, c.adopter2Id));
            if (!r) return 'pair';
            if (r.status === 'declined') return 'declined';
            return normEmail(r.requesterEmail) === normEmail(viewer) ? 'sent' : 'received';
        };
        const requestTime = (c: FeedCandidate) => requests.get(pairKey(c.adopter1Id, c.adopter2Id))?.createdAt?.getTime() ?? 0;
        eligible.sort((x, y) => {
            const gx = groupOf(x), gy = groupOf(y);
            return (GROUP_ORDER.indexOf(gx) - GROUP_ORDER.indexOf(gy))
                || (gx === 'pair'
                    ? (storedScoreToPercent(y.score) - storedScoreToPercent(x.score))
                        || ((y.detectedAt?.getTime() ?? 0) - (x.detectedAt?.getTime() ?? 0))
                    : requestTime(y) - requestTime(x))
                || (x.candidateId < y.candidateId ? -1 : x.candidateId > y.candidateId ? 1 : 0);
        });

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

        // Creators (other than the viewer) and request counterparts on THIS
        // page, resolved to names in one batched lookup.
        const people = new Set<string>();
        for (const r of byId.values()) {
            const creator = realOwner(r.addedBy);
            if (creator && normEmail(creator) !== normEmail(viewer)) people.add(creator);
        }
        for (const c of pageCandidates) {
            const r = requests.get(pairKey(c.adopter1Id, c.adopter2Id));
            if (r) for (const e of [r.requesterEmail, r.ownerEmail, r.resolvedByEmail]) if (e && normEmail(e) !== normEmail(viewer)) people.add(e);
        }
        const names = await resolvePeopleNames([...people], viewer);

        // Visibility is resolved once per adopter, not once per appearance.
        const sideCache = new Map<string, PendingDedupSide>();
        const side = async (row: PairRow) => {
            const hit = sideCache.get(row.id);
            if (hit) return hit;
            const built = await buildPairSide(viewer, row, names);
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
            const request = requests.get(pairKey(c.adopter1Id, c.adopter2Id));
            const matchTypes = JSON.parse(c.matchTypes || '[]') as string[];
            const source = matchTypes.includes('flagged_by_user') ? 'flagged' : 'detected';
            // Same inputs, same order as mergePendingDedupPair's decision.
            const dedupSide = (r: PairRow): DedupSide => ({
                id: r.id, addedBy: r.addedBy, createdAt: r.createdAt ? r.createdAt.getTime() : null, deleted: false,
                teamOwned: !!r.addedBy && teamKeys.has(normEmail(r.addedBy)),
            });
            const sides = { a: dedupSide(a), b: dedupSide(b) };
            const decide = (keepId: string) => decideDedupAction(viewer, sides.a, sides.b, source === 'flagged' ? 'flag' : 'detected', keepId);
            // Which side may stay: whatever the domain allows; an admin's
            // choice merges straight away (D24) — refused only when the admin
            // created neither side, as mergePendingDedupPair refuses it.
            const may = keepOptions(viewer, sides.a, sides.b);
            const adminMay = (id: string) => { const d = decide(id); return d.kind !== 'refuse' || d.reason === 'keep_not_allowed'; };
            // After the owner declined the viewer's request, the viewer may not
            // ask again (D43): only keeping the other's profile is left.
            const declinedMine = request?.status === 'declined' && normEmail(request.requesterEmail) === normEmail(viewer);
            const rescuerMay = (row: PairRow) => (row.id === a.id ? may.a : may.b) && !(declinedMine && decide(row.id).kind === 'request');
            const keep = isAdmin
                ? { new: adminMay(newOne.id), existing: adminMay(oldOne.id) }
                : { new: rescuerMay(newOne), existing: rescuerMay(oldOne) };
            // The default survivor: the older one, unless it may not stay (D42).
            const defaultKeep = keep.existing || !keep.new ? oldOne : newOne;
            const action = decide(defaultKeep.id);
            const [newSide, existingSide] = [await side(newOne), await side(oldOne)];
            const { same, diff } = summarizeBreakdown(matchBreakdown({
                matchTypes,
                source: { name: newSide.name, entries: entriesAsShown(newSide) },
                profile: { name: existingSide.name, has: null, entries: entriesAsShown(existingSide) },
            }));

            pairs.push({
                candidateId: c.candidateId,
                source,
                newAdopter: newSide,
                existingAdopter: existingSide,
                matchTypes,
                matchValues: Object.fromEntries(
                    Object.entries(safeParseMatchValues(c.matchValues))
                        .map(([type, vals]) => [type, vals.map(v => redactInexactValue(type, v))]),
                ),
                confidence: c.confidence,
                confidencePercent: isAdmin ? storedScoreToPercent(c.score) : null,
                adminScore: isAdmin && source === 'detected' && !c.rebuilt ? storedScoreToPercent(c.score) : null,
                group: groupOf(c),
                summary: { same, diff, flagged: source === 'flagged' },
                mergeAction: !isAdmin && action.kind === 'request' ? 'request' : 'merge',
                keepOptions: keep,
                // As mergePendingDedupPair asks it: a detected pair it can load
                // (a pair rebuilt from a request has no candidate row to load).
                identityChoice: source === 'detected' && !c.rebuilt
                    && needsIdentityChoice({ matchTypes, nameA: a.name ?? '', nameB: b.name ?? '' }),
                request: request ? requestView(request, viewer, teamKeys, names) : null,
            });
        }

        return { pairs, total, lowHidden };
    } catch (error) {
        logger.warn('getPendingDuplicatesForUser failed', {
            actorEmail, error: error instanceof Error ? error.message : String(error),
        });
        return EMPTY;
    }
}

/** Longest pair key accepted from the browser: two ids and a '|'. */
const PAIR_KEY_MAX = 200;

/**
 * «Quitar de la lista» (D27): take a pair off the viewer's own «Pendientes de
 * revisar» — offered on declined rows. Writes `pending_pair_hidden` for the
 * session's user only; nobody else's list changes, nothing about the pair
 * does (it can still be combined from the profile, and a new pending request
 * on it shows again). Safe with any key a stranger chooses: it can only hide
 * rows from their own list. Either id order names the same pair.
 */
export async function hidePendingPair(key: string): Promise<{ success: boolean; errorId?: string }> {
    let actorEmail: string | null = null;
    try {
        try { actorEmail = await getUser(); } catch { actorEmail = null; }
        const refuse = (reason: string) => {
            const errorId = generateErrorId();
            logger.warn('hidePendingPair: refused', { actorEmail, reason, errorId });
            return { success: false, errorId };
        };
        if (!actorEmail) return refuse('unauthenticated');
        const ids = typeof key === 'string' && key.length <= PAIR_KEY_MAX ? key.split('|') : [];
        if (ids.length !== 2 || !ids[0] || !ids[1] || ids[0] === ids[1]) return refuse('invalid_pair');
        const db = await getDb();
        if (!db) {
            const errorId = logger.error('hidePendingPair: database not available', new Error('Database not available'), { actorEmail });
            return { success: false, errorId };
        }
        const normalized = pairKey(ids[0], ids[1]);
        await db.insert(pendingPairHidden)
            .values({ viewerEmail: normEmail(actorEmail), pairKey: normalized, createdAt: new Date() })
            .onConflictDoNothing();
        logger.info('hidePendingPair: hidden', { actorEmail, pairKey: normalized });
        return { success: true };
    } catch (e) {
        const errorId = logger.error('hidePendingPair failed', e, { actorEmail });
        return { success: false, errorId };
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
    // Signed-in only: it answers "is anyone named X / with phone Y on file?"
    // with names — an existence oracle for anonymous callers.
    try { await getUser(); } catch {
        logger.warn('checkTokenDuplicates: refused — no session');
        return [];
    }
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
