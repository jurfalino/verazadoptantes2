/**
 * Households as profiles (spec 2026-10-26-households-as-profiles-design) —
 * the read/write core. Every person in a household is an adopter profile; a
 * household is a group of profiles (households / household_memberships), the
 * only record of who lives with whom. NOT a 'use server' module: every export
 * is called by server code only, so none of it is a browser-callable endpoint.
 *
 * Writes (throw on a DB failure — the calling action logs and answers with an errorId):
 * - `ensureHousehold`: the anchor's household, created (with the anchor in it) when it has none.
 * - `createHousehold`: a new, empty household (gift households: add the recipient first).
 * - `addMembership`: idempotent on (household, adopter).
 * - `removeMembership`: optionally remembering a correction («No vive acá», D48).
 * - `setMembershipRelationship`: compare-and-swap on the relationship read.
 * Reads:
 * - `householdIdsOf`, `sameHousehold`, `hasCorrection`, `membershipsOf`,
 *   `householdExists`, `membershipById`, `isMemberOf`.
 * - `getHouseholdsFor`: the profile page's households — each member's live
 *   summary masked exactly as that member's profile is for this viewer (the
 *   same helpers as getLinkedSummaries, src/lib/profileSummary.ts). Never throws.
 * - `householdLinesFor`: the household line of search / «¿Es este perfil?»
 *   cards, batched. Never throws.
 *
 * Rules live in src/domain/households.ts. D1: no `IN (array)` — one bounded
 * query per profile / household, fanned out with Promise.all.
 */
import { and, asc, eq, isNull, or, sql, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { adopters, duplicateCandidates, householdCorrections, householdMemberships, households } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runBatch } from '@/lib/dbBatch';
import { RELATIONSHIPS, type Relationship } from '@/lib/householdMembers';
import { isPrivilegedOnProfile } from '@/lib/profilePrivilege';
import { isPiiGatingEnabled, isPublicProfilesEnabled, resolveAdoptersVisibility } from '@/lib/piiAccessServer';
import { EMPTY_COUNTS, countsFor, namesFor, viewerContacts, type ProfileCounts } from '@/lib/profileSummary';
import { personLabel, type LinkedSummary } from '@/domain/householdLinks';
import {
    MAX_HOUSEHOLDS_PER_PROFILE,
    MAX_HOUSEHOLD_LINES,
    MAX_HOUSEHOLD_MEMBERS,
    canRemoveMembership,
    currentAge,
    isGiftHousehold,
    isMinor,
    membershipLabel,
    type HouseholdLine,
    type MembershipLabel,
} from '@/domain/households';
import { pairKey } from '@/domain/dedupPair';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type MembershipRow = typeof householdMemberships.$inferSelect;

/** Profile reads per search / «¿Es este perfil?» card at most (live or not) — the card line's hard read cap. */
export const MAX_CARD_PROFILE_READS = MAX_HOUSEHOLD_LINES * 3;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const REL_SET: ReadonlySet<string> = new Set(RELATIONSHIPS);

/** One member as the profile page shows them. `linkId` (from LinkedSummary) = `membershipId`. */
export type HouseholdMemberView = LinkedSummary & {
    membershipId: string;
    /** «pareja» / «pareja de Pedro» — an i18n key + params (params.rel is itself a key); null = no label. */
    label: MembershipLabel | null;
    /** Who added this membership («según …»): display name or handle, never an email. */
    addedByName: string | null;
    /** canRemoveMembership: the adder (not on an anchor row), the team of a household profile that team didn't add, admins/moderators. */
    canRemove: boolean;
    relationship: Relationship;
    relativeToAdopterId: string | null;
    giftRecipient: boolean;
    isMinor: boolean;
    /** Current age (goes up by itself), null when unknown. */
    age: number | null;
    /** The household's own anchor row (added next to nobody): the person relationships point at — no «Editar» there. */
    isAnchor: boolean;
    /** The viewer added this membership («agregado por vos»). */
    addedByViewer: boolean;
    /** The viewer owns this member's profile (the deletion items: «Eliminar perfil» / «Pedir eliminación»). */
    ownerIsViewer: boolean;
};

/** The viewed profile's own place in a household: «Lucas figura como hijo/a de Pedro · según Jonathan U». */
export type HouseholdSelfView = {
    label: MembershipLabel | null;
    addedByName: string | null;
    isAnchor: boolean;
    addedByViewer: boolean;
};

export type HouseholdView = { id: string; isGift: boolean; self: HouseholdSelfView; members: HouseholdMemberView[] };

/** A housemate on a search / «¿Es este perfil?» card — defined in the domain so client components can import it. */
export type { HouseholdLine };

export type AddMembershipInput = {
    householdId: string;
    adopterId: string;
    /** Outside RELATIONSHIPS → 'unknown'. */
    relationship?: string | null;
    /** The person they were added next to («pareja de Pedro»). Never themselves. */
    relativeToAdopterId?: string | null;
    giftRecipient?: boolean;
    /** The typist (credit, «según …»). */
    addedBy: string | null;
    /** Where it came from: inline:{hostId}:{memberId}, link:{linkId}, form-{submissionId}-{i}, interview:{id}:{i}, import:{batch}:{row}. */
    sourceKey?: string | null;
    addedAt?: Date;
    /**
     * Remove the newcomer's pending duplicate pairs with the people already
     * there (final fix S3). Omitted: nothing is removed (the read-side
     * exclusion still hides housemate pairs that share no email / ID number).
     */
    clearPairs?: PairClear;
};

/**
 * Who may clear a newcomer's pending duplicate pairs on a join (final fix S3):
 * `{ actor }` — only the pairs where the actor is privileged on BOTH profiles
 * (owner team, admin, moderator) — every join, merges (the merging person) and
 * the conversion (its own actor) included; `{ force: true }` — only the
 * «alguien de su hogar» answer (D35). Never a pair that shares an email or an
 * ID number.
 */
export type PairClear = { actor: string } | { force: true };

// ─────────────────────────── Reads (small) ───────────────────────────

/** Memberships of one household, oldest first, bounded. */
export async function membershipsOf(db: Db, householdId: string, limit: number = MAX_HOUSEHOLD_MEMBERS): Promise<MembershipRow[]> {
    return await db.select().from(householdMemberships)
        .where(eq(householdMemberships.householdId, householdId))
        .orderBy(asc(householdMemberships.addedAt), asc(householdMemberships.id))
        .limit(limit).all() as MembershipRow[];
}

/** This profile's own memberships, oldest first, bounded. */
async function ownMemberships(db: Db, adopterId: string, limit: number): Promise<MembershipRow[]> {
    return await db.select().from(householdMemberships)
        .where(eq(householdMemberships.adopterId, adopterId))
        .orderBy(asc(householdMemberships.addedAt), asc(householdMemberships.id))
        .limit(limit).all() as MembershipRow[];
}

/** This profile's own membership rows (gift ones included), oldest first, bounded — for merges (src/lib/householdMerge.ts). */
export async function membershipsOfProfile(db: Db, adopterId: string, limit: number): Promise<MembershipRow[]> {
    return ownMemberships(db, adopterId, limit);
}

/** The households a profile is in (gift ones included), oldest membership first. */
/**
 * How many ORDINARY households (homes) `adopterId` is in — the number
 * MAX_HOUSEHOLDS_PER_PROFILE caps. Gift households don't count (final fix S4).
 * One indexed count with a correlated check per row (no bound array).
 */
export async function ordinaryHouseholdCount(db: Db, adopterId: string): Promise<number> {
    const row = await db.select({ n: sql<number>`COUNT(*)` }).from(householdMemberships).where(and(
        eq(householdMemberships.adopterId, adopterId),
        sql`NOT EXISTS (SELECT 1 FROM household_memberships g WHERE g.household_id = ${householdMemberships.householdId} AND g.gift_recipient = 1)`,
    )).get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
}

export async function householdIdsOf(db: Db, adopterId: string): Promise<string[]> {
    return (await ownMemberships(db, adopterId, MAX_HOUSEHOLDS_PER_PROFILE * 10)).map(m => m.householdId);
}

/**
 * Two different profiles share an ordinary household. Gift households do not
 * count: the form can't tell whose name and phone it gave, so the giver and
 * the recipient may be one person and the duplicate scan must still pair them.
 */
export async function sameHousehold(db: Db, a: string, b: string): Promise<boolean> {
    if (!a || !b || a === b) return false;
    const row = await db.select({ one: sql<number>`1` }).from(householdMemberships)
        .where(and(
            eq(householdMemberships.adopterId, a),
            sql`EXISTS (SELECT 1 FROM household_memberships o WHERE o.household_id = ${householdMemberships.householdId} AND o.adopter_id = ${b})`,
            sql`NOT EXISTS (SELECT 1 FROM household_memberships g WHERE g.household_id = ${householdMemberships.householdId} AND g.gift_recipient = 1)`,
        )).limit(1).get();
    return !!row;
}

/** Someone said this person does not live in this household («No vive acá»): re-adding is a dispute (D48). */
export async function hasCorrection(db: Db, householdId: string, adopterId: string): Promise<boolean> {
    const row = await db.select({ id: householdCorrections.id }).from(householdCorrections)
        .where(and(eq(householdCorrections.householdId, householdId), eq(householdCorrections.adopterId, adopterId)))
        .limit(1).get();
    return !!row;
}

/**
 * `isOwnTeam` for canRemoveMembership: is this email the viewer or one of
 * their org-mates? Checked once per distinct adder (no IN): a failed check
 * counts as "own team" — it only ever takes standing away (logged).
 */
export async function ownTeamOf(
    viewer: string | null | undefined,
    adders: ReadonlyArray<string | null | undefined>,
    ctx: Record<string, unknown>,
): Promise<(email: string | null | undefined) => boolean> {
    const me = (viewer ?? '').trim().toLowerCase();
    const distinct = [...new Set(adders.map(a => (a ?? '').trim().toLowerCase()).filter(a => a.includes('@') && a !== me))];
    const { isOrgMate } = await import('@/lib/orgMembership');
    const mates = new Set<string>();
    await Promise.all(distinct.map(async a => {
        try {
            if (me && await isOrgMate(me, a)) mates.add(a);
        } catch (e) {
            logger.warn('households: org-mate check failed, adder treated as own team (no standing from it)', { ...ctx, error: errMsg(e) });
            mates.add(a);
        }
    }));
    return (email) => {
        const e = (email ?? '').trim().toLowerCase();
        return !!e && (e === me || mates.has(e));
    };
}

/** The household row is there (a racing ensureHousehold may have dropped an anchor-only one). */
export async function householdExists(db: Db, householdId: string): Promise<boolean> {
    const row = await db.select({ id: households.id }).from(households).where(eq(households.id, householdId)).limit(1).get();
    return !!row;
}

/** One membership by id, or null. */
export async function membershipById(db: Db, membershipId: string): Promise<MembershipRow | null> {
    const row = await db.select().from(householdMemberships).where(eq(householdMemberships.id, membershipId)).limit(1).get() as MembershipRow | undefined;
    return row ?? null;
}

/** The membership written under this source_key (unique when set, 0098), or null. */
export async function membershipBySourceKey(db: Db, sourceKey: string): Promise<{ id: string; adopterId: string; householdId: string } | null> {
    const row = await db.select({ id: householdMemberships.id, adopterId: householdMemberships.adopterId, householdId: householdMemberships.householdId })
        .from(householdMemberships).where(eq(householdMemberships.sourceKey, sourceKey)).limit(1).get() as { id: string; adopterId: string; householdId: string } | undefined;
    return row ?? null;
}

/** `adopterId`'s membership row in `householdId`, or null. */
export async function membershipIn(db: Db, householdId: string, adopterId: string): Promise<MembershipRow | null> {
    const row = await db.select().from(householdMemberships)
        .where(and(eq(householdMemberships.householdId, householdId), eq(householdMemberships.adopterId, adopterId)))
        .limit(1).get() as MembershipRow | undefined;
    return row ?? null;
}

/** `adopterId` has a membership in `householdId`. */
export async function isMemberOf(db: Db, householdId: string, adopterId: string): Promise<boolean> {
    const row = await db.select({ id: householdMemberships.id }).from(householdMemberships)
        .where(and(eq(householdMemberships.householdId, householdId), eq(householdMemberships.adopterId, adopterId)))
        .limit(1).get();
    return !!row;
}

// ─────────────────────────── Writes ───────────────────────────

/**
 * Claim the add's own record for a membership (history, audit, notices,
 * dispute check): true for exactly one caller (compare-and-set on
 * recorded_at IS NULL). Two concurrent identical adds never record twice.
 */
export async function claimMembershipRecord(db: Db, membershipId: string): Promise<boolean> {
    const won = await db.update(householdMemberships).set({ recordedAt: new Date() })
        .where(and(eq(householdMemberships.id, membershipId), isNull(householdMemberships.recordedAt)))
        .returning({ id: householdMemberships.id });
    return won.length > 0;
}

/** The record could not be written: let the next add by the same person complete it. */
export async function releaseMembershipRecord(db: Db, membershipId: string): Promise<void> {
    await db.update(householdMemberships).set({ recordedAt: null }).where(eq(householdMemberships.id, membershipId));
}

/**
 * Change one membership's relationship, compare-and-swap on the value read
 * (`from`): false when someone changed it (or removed the membership) first.
 * A relationship outside RELATIONSHIPS is never written (callers validate).
 */
export async function setMembershipRelationship(db: Db, membershipId: string, from: string, to: Relationship): Promise<boolean> {
    if (!REL_SET.has(to)) throw new Error('setMembershipRelationship: unknown relationship');
    const won = await db.update(householdMemberships).set({ relationship: to })
        .where(and(eq(householdMemberships.id, membershipId), eq(householdMemberships.relationship, from)))
        .returning({ id: householdMemberships.id });
    return won.length > 0;
}

let lastIdMs = 0;
/**
 * Time-ordered membership id: the tie-break of memberships added in the same
 * second (added_at is in seconds), so a household lists people in the order
 * they were added. Monotonic within an isolate.
 */
function membershipId(): string {
    lastIdMs = Math.max(Date.now(), lastIdMs + 1);
    return `hm-${lastIdMs.toString(36).padStart(9, '0')}-${crypto.randomUUID()}`;
}

/** A new membership id, for a caller that writes the row inside its own batch. */
export function newMembershipId(): string {
    return membershipId();
}

/** A new household with nobody in it yet. For a gift household add the recipient (gift) first. */
export async function createHousehold(db: Db, actor: string | null, id: string = `hh-${crypto.randomUUID()}`): Promise<string> {
    await db.insert(households).values({ id, createdBy: actor, createdAt: new Date() }).onConflictDoNothing().run();
    return id;
}

/**
 * The anchor's own home: its oldest ordinary (non-gift) household in which it
 * has its OWN anchor row (added next to nobody, by nobody — what
 * ensureHousehold writes). Being linked into someone else's household (a row
 * with a relative and an adder) never makes that household the default: a
 * stranger linking Pedro into their profile's household must not decide where
 * Pedro's team's next add lands. Null when it has none.
 */
async function ordinaryHouseholdOf(db: Db, anchorId: string): Promise<string | null> {
    const row = await db.select({ householdId: householdMemberships.householdId }).from(householdMemberships)
        .where(and(
            eq(householdMemberships.adopterId, anchorId),
            isNull(householdMemberships.relativeToAdopterId),
            isNull(householdMemberships.addedBy),
            sql`NOT EXISTS (SELECT 1 FROM household_memberships g WHERE g.household_id = ${householdMemberships.householdId} AND g.gift_recipient = 1)`,
        ))
        .orderBy(asc(householdMemberships.addedAt), asc(householdMemberships.id))
        .limit(1).get();
    return row?.householdId ?? null;
}

/** The anchor's own home without creating one (read-only — the conversion's dry run). */
export async function ownHomeOf(db: Db, anchorId: string): Promise<string | null> {
    return ordinaryHouseholdOf(db, anchorId);
}

/**
 * The household to add people next to `anchorId`: its own home (its oldest
 * ordinary household where it has its own anchor row — never one it was merely
 * linked into, see ordinaryHouseholdOf), else a new one with the anchor in it.
 *
 * Usage: call it when adding someone next to a profile WITHOUT a chosen
 * household (`addHouseholdPerson` with no `householdId`), then
 * `addMembership` into the id it returns. With a chosen household, or for a
 * gift household (`createHousehold`, recipient first), don't call it.
 *
 * Race-safe without a transaction (D1 has none across awaits):
 * - the first household gets the deterministic id `hh-{anchorId}`, so
 *   concurrent first adds insert-or-ignore the same rows;
 * - if that id is taken (the anchor was removed from it once — they are never
 *   put back into it), or a racing caller took it a moment earlier, a fresh
 *   `hh-{anchorId}-{8 hex}` is made;
 * - every caller then re-reads and returns the anchor's OLDEST ordinary
 *   household (all callers agree on it: membership ids are time-ordered), and
 *   a caller whose own new household lost removes it if it still holds only
 *   the anchor. So a race never leaves an orphan anchor-only household
 *   counting against MAX_HOUSEHOLDS_PER_PROFILE.
 */
export async function ensureHousehold(db: Db, anchorId: string, actor: string | null): Promise<string> {
    const existing = await ordinaryHouseholdOf(db, anchorId);
    if (existing) return existing;
    const preferred = `hh-${anchorId}`;
    const taken = await db.select({ id: households.id }).from(households).where(eq(households.id, preferred)).get();
    const id = taken ? `hh-${anchorId}-${crypto.randomUUID().slice(0, 8)}` : preferred;
    await createHousehold(db, actor, id);
    // The anchor's own row has no adder: whoever triggered the household gets no adder's rights over it.
    await addMembership(db, { householdId: id, adopterId: anchorId, relationship: 'unknown', relativeToAdopterId: null, addedBy: null });
    const winner = (await ordinaryHouseholdOf(db, anchorId)) ?? id;
    if (winner !== id) await dropLostHousehold(db, id, anchorId, { anchorId, actor, winner });
    return winner;
}

/**
 * A racing ensureHousehold made `householdId` but another caller's household
 * is the anchor's oldest: remove ours while it holds only the anchor. Anyone
 * else in it (never expected) keeps it as is. A failure is logged; the caller
 * still answers with the winner.
 */
async function dropLostHousehold(db: Db, householdId: string, anchorId: string, ctx: Record<string, unknown>): Promise<void> {
    try {
        const members = await membershipsOf(db, householdId, 2);
        if (members.length !== 1 || members[0].adopterId !== anchorId) {
            logger.warn('ensureHousehold: lost race but the household is not anchor-only, kept', { ...ctx, householdId, members: members.length });
            return;
        }
        await runBatch(db, [
            db.delete(householdMemberships).where(eq(householdMemberships.id, members[0].id)),
            db.delete(households).where(eq(households.id, householdId)),
        ]);
        logger.info('ensureHousehold: lost race, own empty household removed', { ...ctx, householdId });
    } catch (e) {
        logger.warn('ensureHousehold: lost race, removing own household failed (orphan left)', { ...ctx, householdId, error: errMsg(e) });
    }
}

/**
 * Put `adopterId` in `householdId`. Idempotent on the (household, adopter)
 * pair: a second add returns the existing membership unchanged, `created: false`.
 */
export async function addMembership(db: Db, input: AddMembershipInput): Promise<{ membershipId: string; created: boolean }> {
    const id = membershipId();
    const relationship = input.relationship && REL_SET.has(input.relationship) ? input.relationship : 'unknown';
    const relative = input.relativeToAdopterId && input.relativeToAdopterId !== input.adopterId ? input.relativeToAdopterId : null;
    await db.insert(householdMemberships).values({
        id,
        householdId: input.householdId,
        adopterId: input.adopterId,
        relationship,
        relativeToAdopterId: relative,
        giftRecipient: input.giftRecipient ? 1 : 0,
        addedBy: input.addedBy,
        addedAt: input.addedAt ?? new Date(),
        sourceKey: input.sourceKey ?? null,
    }).onConflictDoNothing().run();
    const row = await db.select({ id: householdMemberships.id }).from(householdMemberships)
        .where(and(eq(householdMemberships.householdId, input.householdId), eq(householdMemberships.adopterId, input.adopterId)))
        .get();
    if (!row) throw new Error('addMembership: membership missing after insert');
    const created = row.id === id;
    if (created && !input.giftRecipient && input.clearPairs) await dropHousemateCandidates(db, input.householdId, input.adopterId, input.clearPairs);
    return { membershipId: row.id, created };
}

/**
 * Someone just joined a household: their pending duplicate pairs with the people
 * already there leave «Pendientes de revisar» — but only as `how` allows
 * (final fix S3: declaring two profiles housemates must not let anyone erase a
 * real duplicate pair): with `{ actor }` only the pairs where the actor is
 * privileged on both profiles (merges pass the merging person, the conversion
 * its own actor); `{ force: true }` only for «alguien de su hogar» (D35). A pair sharing an email or an ID number is
 * never removed (it isn't hidden either). Removed rather than marked
 * dismissed: if they stop living together, the next scan may pair them again.
 * A merge request on such a pair keeps standing on its own. Not in a gift
 * household (not a home). Reads this person's pending pairs (indexed, held to
 * a household of MAX_HOUSEHOLD_MEMBERS), deletes each by id. A failure is
 * logged and never undoes the join.
 */
export async function dropHousemateCandidates(db: Db, householdId: string, adopterId: string, how: PairClear): Promise<void> {
    const livesThere = (col: SQLWrapper) =>
        sql`EXISTS (SELECT 1 FROM household_memberships m WHERE m.household_id = ${householdId} AND m.adopter_id = ${col})`;
    const ctx = { householdId, adopterId, ...('actor' in how ? { actor: how.actor } : { forced: true }) };
    try {
        const { sharesPersonalIdSql } = await import('@/lib/housemateSql');
        const rows = await db.select({ id: duplicateCandidates.id, a: duplicateCandidates.adopter1Id, b: duplicateCandidates.adopter2Id })
            .from(duplicateCandidates).where(and(
                eq(duplicateCandidates.status, 'pending'),
                sql`NOT EXISTS (SELECT 1 FROM household_memberships g WHERE g.household_id = ${householdId} AND g.gift_recipient = 1)`,
                sql`NOT ${sharesPersonalIdSql(duplicateCandidates.matchTypes)}`,
                or(
                    and(eq(duplicateCandidates.adopter1Id, adopterId), livesThere(duplicateCandidates.adopter2Id)),
                    and(eq(duplicateCandidates.adopter2Id, adopterId), livesThere(duplicateCandidates.adopter1Id)),
                ),
            )).limit(MAX_HOUSEHOLD_MEMBERS * 2).all() as Array<{ id: string; a: string; b: string }>;
        if (!rows.length) return;
        let drop = rows;
        if ('actor' in how) {
            const privileged = new Map<string, Promise<boolean>>();
            const onProfile = (id: string) => {
                const known = privileged.get(id);
                if (known) return known;
                const p: Promise<boolean> = (async () => {
                    const row = await db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, id)).get() as { addedBy: string | null } | undefined;
                    return isPrivilegedOnProfile(how.actor, row?.addedBy ?? null);
                })();
                privileged.set(id, p);
                return p;
            };
            const ok = await Promise.all(rows.map(async r => (await onProfile(r.a)) && (await onProfile(r.b))));
            drop = rows.filter((_, i) => ok[i]);
        }
        await Promise.all(drop.map(r => db.delete(duplicateCandidates)
            .where(and(eq(duplicateCandidates.id, r.id), eq(duplicateCandidates.status, 'pending'))).run()));
        logger.info('households: pending duplicate pairs with new housemates removed', { ...ctx, removed: drop.length, kept: rows.length - drop.length });
    } catch (e) {
        logger.warn('households: housemate duplicate pairs not removed (the feed and badge still hide them)', { ...ctx, error: errMsg(e) });
    }
}

/**
 * A profile deleted for good (owner delete / admin delete): it leaves every
 * ordinary household it was in, so it neither lingers against the 30-person
 * cap nor in the housemate checks. Gift households are left as they are: the
 * giver's row alone would read as the giver's own home (the «Crear perfil»
 * path replaces a missing recipient itself). Throws on a DB failure (the
 * caller logs with its context).
 */
export async function dropMembershipsOfDeletedProfile(db: Db, adopterId: string): Promise<void> {
    await db.delete(householdMemberships).where(and(
        eq(householdMemberships.adopterId, adopterId),
        sql`NOT EXISTS (SELECT 1 FROM household_memberships g WHERE g.household_id = ${householdMemberships.householdId} AND g.gift_recipient = 1)`,
    )).run();
}

/**
 * Take one person out of one household, for everyone. With `correction`
 * («No vive acá», D48) the fact is remembered per (household, person) with
 * the removed row as the snapshot, in the same batch. The household itself
 * and everyone else in it stay (corrections are keyed on the household id).
 * Returns the removed row (null when it was already gone).
 */
export async function removeMembership(
    db: Db,
    membershipId: string,
    actor: string,
    opts: { correction: boolean },
): Promise<{ removed: MembershipRow | null; correctionId: string | null }> {
    const row = await db.select().from(householdMemberships).where(eq(householdMemberships.id, membershipId)).get() as MembershipRow | undefined;
    if (!row) return { removed: null, correctionId: null };
    const del = db.delete(householdMemberships).where(eq(householdMemberships.id, membershipId));
    if (!opts.correction) {
        await runBatch(db, [del]);
        return { removed: row, correctionId: null };
    }
    const correctionId = `hc-${crypto.randomUUID()}`;
    await runBatch(db, [
        del,
        db.insert(householdCorrections).values({
            id: correctionId,
            householdId: row.householdId,
            adopterId: row.adopterId,
            correctedBy: actor,
            correctedAt: new Date(),
            snapshot: JSON.stringify(row),
        }),
    ]);
    return { removed: row, correctionId };
}

// ─────────────────────────── Profile page read ───────────────────────────

type ProfileRow = {
    id: string; name: string; addedBy: string | null; contactEntries: string | null; contactInfo: string | null;
    isPublic: number | boolean | null; deletedAt: Date | null; age: number | null; ageAsOf: string | null; isMinor: number | null;
};

const PROFILE_COLS = {
    id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, contactEntries: adopters.contactEntries,
    contactInfo: adopters.contactInfo, isPublic: adopters.isPublic, deletedAt: adopters.deletedAt,
    age: adopters.age, ageAsOf: adopters.ageAsOf, isMinor: adopters.isMinor,
};

/** The profile when it is live (merges re-point memberships, Task 6 — a soft-deleted row is skipped, not followed). */
async function liveProfile(db: Db, id: string): Promise<ProfileRow | null> {
    const row = await db.select(PROFILE_COLS).from(adopters).where(eq(adopters.id, id)).get() as ProfileRow | undefined;
    return row && !row.deletedAt ? row : null;
}

/**
 * A housemate's profile; a failed read skips that one person (logged) instead
 * of blanking the section. A member merged away by a build that didn't move
 * memberships (an old tab, forwarded — final fix D1) is followed to the live
 * survivor (the merge audit, as /adopter/<id> redirects): the person stays in
 * the household under their surviving profile instead of vanishing. Callers
 * key on the returned `id` (it may differ from `id`).
 */
async function housemateProfile(db: Db, id: string, ctx: Record<string, unknown>): Promise<ProfileRow | null> {
    try {
        const live = await liveProfile(db, id);
        if (live) return live;
        const { resolveMergedAdopterIdIn } = await import('@/lib/mergedAdopterRedirect');
        const survivor = await resolveMergedAdopterIdIn(db, id);
        if (!survivor || survivor === id) return null;
        logger.info('households: a member merged away without its memberships, shown as the survivor', { ...ctx, profileId: id, survivorId: survivor });
        return await liveProfile(db, survivor);
    } catch (e) {
        logger.warn('households: housemate profile read failed, member skipped', { ...ctx, profileId: id, error: errMsg(e) });
        return null;
    }
}

const asRelationship = (r: string | null | undefined): Relationship => (r && REL_SET.has(r) ? r as Relationship : 'unknown');

export type GetHouseholdsOptions = {
    /**
     * Runs before anything is read. Default (undefined): the lazy conversion
     * of today's data (Task 7, ensureProfileConverted — the profile's own
     * inline household and the hosts that link to it), so a profile is right
     * from its first view after the release. `null`: nothing. A failure is
     * logged and the read goes on.
     */
    beforeRead?: ((db: Db, adopterId: string) => Promise<unknown>) | null;
};

/** The default pre-read hook: convert what still sits in the old shape (dynamic import: the conversion imports this module). */
async function convertBeforeRead(db: Db, adopterId: string): Promise<void> {
    const { ensureProfileConverted } = await import('@/lib/householdConversion');
    const { failed } = await ensureProfileConverted(db, adopterId);
    if (failed) logger.warn('households: some of the old household data was not converted yet (retried on the next view)', { adopterId, failed });
}

/**
 * The households of `adopterId` as `viewer` may see them: one view per
 * household (oldest membership first), each with the OTHER live members'
 * summaries — contacts masked exactly as that member's profile masks them for
 * this viewer, never more. Soft-deleted profiles are skipped; a household with
 * nobody else live is left out. Bounded (MAX_HOUSEHOLDS_PER_PROFILE,
 * MAX_HOUSEHOLD_MEMBERS). Never throws: a failure yields [] and is logged.
 */
export async function getHouseholdsFor(
    db: Db,
    viewer: string | null | undefined,
    adopterId: string,
    opts: GetHouseholdsOptions = {},
): Promise<HouseholdView[]> {
    const ctx = { adopterId, viewer: viewer ?? null };
    const beforeRead = opts.beforeRead === undefined ? convertBeforeRead : opts.beforeRead;
    if (beforeRead) {
        try {
            await beforeRead(db, adopterId);
        } catch (e) {
            logger.warn('households: pre-read hook failed, households read as they are', { ...ctx, error: errMsg(e) });
        }
    }
    try {
        const self = await liveProfile(db, adopterId);
        if (!self) return [];
        const mine = await ownMemberships(db, adopterId, MAX_HOUSEHOLDS_PER_PROFILE + 1);
        if (mine.length === 0) return [];
        if (mine.length > MAX_HOUSEHOLDS_PER_PROFILE) {
            logger.warn('households: household cap hit, newer households not shown', { ...ctx, cap: MAX_HOUSEHOLDS_PER_PROFILE });
        }
        const own = mine.slice(0, MAX_HOUSEHOLDS_PER_PROFILE);
        const groups = await Promise.all(own.map(m => membershipsOf(db, m.householdId, MAX_HOUSEHOLD_MEMBERS + 1)));
        groups.forEach((g, i) => {
            if (g.length > MAX_HOUSEHOLD_MEMBERS) {
                logger.warn('households: member cap hit, newer members not shown', { ...ctx, householdId: own[i].householdId, cap: MAX_HOUSEHOLD_MEMBERS });
            }
        });
        const cappedRaw = groups.map(g => g.slice(0, MAX_HOUSEHOLD_MEMBERS));

        const otherIds = [...new Set(cappedRaw.flat().map(m => m.adopterId).filter(id => id !== adopterId))];
        const loaded = await Promise.all(otherIds.map(async id => [id, await housemateProfile(db, id, ctx)] as const));
        const profiles = new Map<string, ProfileRow>();
        const shownAs = new Map<string, string>();
        for (const [id, p] of loaded) if (p) { profiles.set(p.id, p); shownAs.set(id, p.id); }
        // A member followed to its survivor (D1) stands in under the survivor's id —
        // never twice in one household, never the profile itself.
        const capped = cappedRaw.map(g => {
            const seen = new Set<string>();
            const out: MembershipRow[] = [];
            for (const m of g) {
                const as = m.adopterId === adopterId ? adopterId : shownAs.get(m.adopterId);
                if (!as || (as === adopterId && m.adopterId !== adopterId) || seen.has(as)) continue;
                seen.add(as);
                out.push(as === m.adopterId ? m : { ...m, adopterId: as });
            }
            return out;
        });
        profiles.delete(adopterId);
        if (profiles.size === 0) return [];

        const viewerEmail = viewer ?? null;
        const everyone = [self, ...profiles.values()];
        const [gatingOn, publicFlag, visibilities, counts, viewerIsStaff, privileged] = await Promise.all([
            isPiiGatingEnabled(),
            isPublicProfilesEnabled(),
            resolveAdoptersVisibility(viewerEmail, [...profiles.values()].map(p => ({ id: p.id, addedBy: p.addedBy }))),
            Promise.all([...profiles.keys()].map(async id => [id, await countsFor(db, id, ctx)] as const)).then(e => new Map(e)),
            viewerEmail
                ? (async () => (await import('@/config/admins')).isModeratorOrAdminAsync(viewerEmail))()
                : Promise.resolve(false),
            Promise.all(everyone.map(async p => [p.id, await isPrivilegedOnProfile(viewerEmail, p.addedBy)] as const)).then(e => new Map(e)),
        ]);
        const isOwnTeam = await ownTeamOf(viewerEmail, capped.flat().map(m => m.addedBy), ctx);
        const rescuerNames = await namesFor([
            ...[...profiles.values()].map(p => p.addedBy),
            ...capped.flat().map(m => m.addedBy),
        ], ctx);
        const today = new Date();
        const me = viewerEmail?.trim().toLowerCase() || null;
        const isViewer = (email: string | null | undefined) => !!me && !!email && email.trim().toLowerCase() === me;
        const isAnchorRow = (m: MembershipRow) => !m.relativeToAdopterId && !m.addedBy;

        const views: HouseholdView[] = [];
        own.forEach((selfMembership, i) => {
            const group = capped[i];
            const live = group.filter(m => m.adopterId === adopterId || profiles.has(m.adopterId));
            const names: Record<string, string> = {};
            for (const m of live) names[m.adopterId] = m.adopterId === adopterId ? self.name : profiles.get(m.adopterId)!.name;
            const members: HouseholdMemberView[] = [];
            for (const m of live) {
                if (m.adopterId === adopterId) continue;
                const p = profiles.get(m.adopterId)!;
                const c: ProfileCounts = counts.get(p.id) ?? EMPTY_COUNTS;
                const { contacts, more, canSeeContact } = viewerContacts(p, gatingOn, publicFlag, visibilities.get(p.id));
                const canRemove = canRemoveMembership(
                    { email: viewerEmail, isAdmin: !!viewerIsStaff, privilegedOn: id => !!privileged.get(id), isOwnTeam },
                    m,
                    live,
                );
                members.push({
                    linkId: m.id,
                    membershipId: m.id,
                    profileId: p.id,
                    name: p.name,
                    ownerName: personLabel(p.addedBy, rescuerNames),
                    rating: c.rating,
                    openAlerts: c.openAlerts,
                    activity: c.activity,
                    contacts,
                    moreContacts: more,
                    canSeeContact,
                    // «No vive acá» is one of «Quitar del hogar»'s answers: the same people (spec §Removing).
                    canReportNotLiving: canRemove,
                    canRemove,
                    label: membershipLabel(adopterId, m, names, selfMembership),
                    addedByName: personLabel(m.addedBy, rescuerNames),
                    relationship: asRelationship(m.relationship),
                    relativeToAdopterId: m.relativeToAdopterId ?? null,
                    giftRecipient: !!m.giftRecipient,
                    isMinor: isMinor(p, today),
                    age: currentAge(p, today),
                    isAnchor: isAnchorRow(m),
                    addedByViewer: isViewer(m.addedBy),
                    ownerIsViewer: isViewer(p.addedBy),
                });
            }
            if (members.length === 0) return;
            const selfView: HouseholdSelfView = {
                // How the viewed profile itself reads in this household («hijo/a de Pedro»): seen from nobody's profile.
                label: membershipLabel('', selfMembership, names),
                addedByName: personLabel(selfMembership.addedBy, rescuerNames),
                isAnchor: isAnchorRow(selfMembership),
                addedByViewer: isViewer(selfMembership.addedBy),
            };
            views.push({ id: selfMembership.householdId, isGift: isGiftHousehold(group), self: selfView, members });
        });
        return views;
    } catch (e) {
        logger.warn('households: read failed, profile shows no households', { ...ctx, error: errMsg(e) });
        return [];
    }
}

// ─────────────────────────── Card lines (batched) ───────────────────────────

/** Cards per page that get a household line (the rest of a long page go without). */
export const HOUSEHOLD_LINE_CARDS = 20;

/**
 * Search / «¿Es este perfil?» cards with their household line (`households`),
 * read in ONE batched `householdLinesFor` call: one indexed lookup per card
 * (most people have no household), more only for a card that has one. Only the
 * first HOUSEHOLD_LINE_CARDS cards get a line — callers pass the cards in the
 * order shown (main results first) — and only for a signed-in viewer: the line
 * names people, and a logged-out visitor's names are masked server-side. Never
 * throws (a failed card gets [], logged).
 */
export async function withHouseholdLines<T extends { adopterId: string }>(
    db: Db,
    viewer: string,
    cards: T[],
): Promise<Array<T & { households?: HouseholdLine[] }>> {
    if (cards.length === 0) return [];
    const budget = cards.slice(0, HOUSEHOLD_LINE_CARDS);
    const lines = await householdLinesFor(db, viewer, budget.map(c => c.adopterId));
    return cards.map((c, i) => (i < HOUSEHOLD_LINE_CARDS ? { ...c, households: lines[c.adopterId] ?? [] } : c));
}

/**
 * The household line of each profile in `adopterIds` (search results,
 * «¿Es este perfil?»): every live housemate, once, with their live rating and
 * open alerts. `isGift` when every household the two share is a gift one.
 * Every requested id gets an entry ([] when none). Profiles, households and
 * counts are read once per call however many cards share them. Bounded per
 * card (MAX_HOUSEHOLD_LINES). Never throws: a failed card gets [] (logged).
 * `viewer` is for the log only — the line carries no contact data.
 */
export async function householdLinesFor(
    db: Db,
    viewer: string | null | undefined,
    adopterIds: string[],
): Promise<Record<string, HouseholdLine[]>> {
    const memo = <T>(m: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> => {
        let p = m.get(key);
        if (!p) { p = load(); m.set(key, p); }
        return p;
    };
    const groupMemo = new Map<string, Promise<MembershipRow[]>>();
    const profileMemo = new Map<string, Promise<ProfileRow | null>>();
    const countMemo = new Map<string, Promise<ProfileCounts>>();
    const today = new Date();
    const ids = [...new Set(adopterIds)];

    const entries = await Promise.all(ids.map(async (adopterId): Promise<[string, HouseholdLine[]]> => {
        const ctx = { adopterId, viewer: viewer ?? null };
        try {
            const mine = await ownMemberships(db, adopterId, MAX_HOUSEHOLDS_PER_PROFILE);
            if (mine.length === 0) return [adopterId, []];
            const groups = await Promise.all(mine.map(m => memo(groupMemo, m.householdId, () => membershipsOf(db, m.householdId))));
            // Each housemate once; gift only when every shared household is a gift one.
            // Their home on the card: the first ordinary household the two share.
            const mates = new Map<string, boolean>();
            const homeOf = new Map<string, string>();
            groups.forEach((group, gi) => {
                const gift = isGiftHousehold(group);
                for (const m of group) {
                    if (m.adopterId === adopterId) continue;
                    const wasGiftOnly = mates.get(m.adopterId) ?? true;
                    mates.set(m.adopterId, wasGiftOnly && gift);
                    if (!homeOf.has(m.adopterId) || (wasGiftOnly && !gift)) homeOf.set(m.adopterId, mine[gi].householdId);
                }
            });
            // Read only what the line shows: just enough profiles to fill it,
            // in membership order, never more than MAX_CARD_PROFILE_READS
            // (deleted housemates can't make a card read without end).
            // People who live there first: a gift-only housemate (left off the card)
            // never takes a slot or a read from someone who does.
            const candidates = [...mates.keys()].sort((x, y) => Number(!!mates.get(x)) - Number(!!mates.get(y)));
            if (candidates.length > MAX_CARD_PROFILE_READS) {
                logger.info('households: card read cap, later housemates not read', { ...ctx, housemates: candidates.length, cap: MAX_CARD_PROFILE_READS });
            }
            const readable = candidates.slice(0, MAX_CARD_PROFILE_READS);
            const shown: ProfileRow[] = [];
            for (let i = 0; i < readable.length && shown.length < MAX_HOUSEHOLD_LINES;) {
                const batch = readable.slice(i, i + (MAX_HOUSEHOLD_LINES - shown.length));
                i += batch.length;
                const rows = await Promise.all(batch.map(id => memo(profileMemo, id, () => housemateProfile(db, id, ctx))));
                // A member followed to its survivor (D1): never twice, never the card's own profile.
                rows.forEach((p, k) => {
                    if (!p || p.id === adopterId || shown.some(x => x.id === p.id)) return;
                    if (p.id !== batch[k] && !mates.has(p.id)) { mates.set(p.id, mates.get(batch[k]) ?? false); homeOf.set(p.id, homeOf.get(batch[k]) ?? ''); }
                    shown.push(p);
                });
            }
            const counts = await Promise.all(shown.map(p => memo(countMemo, p.id, () => countsFor(db, p.id, ctx))));
            return [adopterId, shown.map((p, i) => ({
                name: p.name,
                profileId: p.id,
                rating: counts[i].rating,
                openAlerts: counts[i].openAlerts,
                isMinor: isMinor(p, today),
                isGift: !!mates.get(p.id),
                householdId: homeOf.get(p.id) ?? '',
            }))];
        } catch (e) {
            logger.warn('households: card line read failed, card shows no household', { ...ctx, error: errMsg(e) });
            return [adopterId, []];
        }
    }));
    return Object.fromEntries(entries);
}

/**
 * Every pair of profiles that share an ordinary household, as `pairKey`s — for
 * the duplicate scan and «Pendientes de revisar», which never pair housemates
 * («alguien de su hogar» is already a recorded answer). ONE self-join over the
 * memberships (never a query per pair: the scan runs near the subrequest
 * ceiling). Gift households don't count, exactly as in `sameHousehold`. Throws
 * on a DB failure (the caller decides how to degrade).
 */
export async function housematePairKeys(db: Db): Promise<Set<string>> {
    const other = alias(householdMemberships, 'o');
    const rows = await db.select({ a: householdMemberships.adopterId, b: other.adopterId })
        .from(householdMemberships)
        .innerJoin(other, and(eq(other.householdId, householdMemberships.householdId), sql`${other.adopterId} > ${householdMemberships.adopterId}`))
        .where(sql`NOT EXISTS (SELECT 1 FROM household_memberships g WHERE g.household_id = ${householdMemberships.householdId} AND g.gift_recipient = 1)`)
        .all() as Array<{ a: string; b: string }>;
    return new Set(rows.map(r => pairKey(r.a, r.b)));
}
