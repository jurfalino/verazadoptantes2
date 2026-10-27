/**
 * Households as profiles (spec «Merges and undo», «No convive» memory) — what a
 * merge does to the household tables, and how undo reverses it. Plain server
 * module (NOT 'use server'): called only by src/lib/adopterMerge.ts.
 *
 * Merging `absorbed` into `survivor`:
 * - each of the absorbed profile's memberships becomes the survivor's
 *   (compare-and-set on the row, refused while the survivor is already in that
 *   household);
 * - where the survivor is already there, the two collapse into the survivor's
 *   row, which takes the stronger shape of the pair: the anchor shape (the
 *   household stays someone's home), a known relationship over `unknown`, the
 *   gift-recipient mark (a gift household never turns into an ordinary home),
 *   and the `source_key` (a replayed form or «Crear perfil» finds the survivor
 *   instead of making the person again);
 * - nobody is left relative to themselves, and «hijo de <absorbed>» now points
 *   at the survivor;
 * - «No vive acá» corrections naming the absorbed profile name the survivor, and
 *   a merge that leaves the survivor in a household with a correction it did not
 *   have there before is a dispute (D48) — returned for the caller to notify
 *   once the merge stands.
 * Everything moved is recorded in `HouseholdMergeUndo` AS IT HAPPENS, so a merge
 * failing halfway can be reverted exactly as far as it got.
 *
 * Undo (`restoreMembershipsAfterMerge`) writes back only what the merge wrote,
 * each step guarded by the value the merge left: a membership removed or edited
 * since stays as it is now. Re-running it converges (the undo is retryable).
 *
 * D1: no `IN (array)` — single-value WHEREs, OR-chunks for id lists.
 */
import { and, eq, or, sql, type SQLWrapper } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { adopters, householdCorrections, householdMemberships } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runBatch } from '@/lib/dbBatch';
import { dropHousemateCandidates, hasCorrection, membershipById, membershipIn, membershipsOf, membershipsOfProfile, type MembershipRow } from '@/lib/households';
import { MAX_HOUSEHOLDS_PER_PROFILE } from '@/domain/households';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Ctx = Record<string, unknown>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Membership rows read per merged profile at most (logged when hit). */
export const MAX_MERGE_MEMBERSHIPS = MAX_HOUSEHOLDS_PER_PROFILE * 10;
/** Ids per OR-chunk on undo: well under D1's bound-parameter cap. */
const CHUNK = 40;
/** A row the merge could not settle after this many tries throws (the merge reverts). */
const PLACE_ATTEMPTS = 3;

/** A membership row as stored in the undo payload (dates as epoch ms). */
export type StoredMembership = {
    id: string; householdId: string; adopterId: string; relationship: string; relativeToAdopterId: string | null;
    giftRecipient: number; addedBy: string | null; addedAt: number; sourceKey: string | null; recordedAt: number | null;
};

/** The columns a collapse may patch on the survivor's row. */
type ShapeCols = { relationship: string; relativeToAdopterId: string | null; addedBy: string | null; giftRecipient: number; sourceKey: string | null };
type ShapeKey = keyof ShapeCols;
const SHAPE_KEYS: readonly ShapeKey[] = ['relationship', 'relativeToAdopterId', 'addedBy', 'giftRecipient', 'sourceKey'];

/** What a merge did to the household tables — the `householdMemberships` part of the merge's undo payload. */
export type HouseholdMergeUndo = {
    /** Absorbed rows that became the survivor's: their household and relative before. */
    moved: Array<{ id: string; householdId: string; relativeToAdopterId: string | null }>;
    /** Absorbed rows removed because the survivor was already there, and what the survivor's row took from them. */
    collapsed: Array<{ row: StoredMembership; survivorRowId: string; survivorBefore: Partial<ShapeCols>; survivorAfter: Partial<ShapeCols> }>;
    /** Rows that were relative to the absorbed profile: now relative to `to` (the survivor, or nobody on the survivor's own row). */
    relatives: Array<{ id: string; to: string | null }>;
    /** «No vive acá» corrections re-pointed from the absorbed profile to the survivor. */
    correctionIds: string[];
};

export function emptyHouseholdMergeUndo(): HouseholdMergeUndo {
    return { moved: [], collapsed: [], relatives: [], correctionIds: [] };
}

/** The payload shape check for undo: anything else is ignored (logged by the caller). */
export function isHouseholdMergeUndo(v: unknown): v is HouseholdMergeUndo {
    const u = v as Partial<HouseholdMergeUndo> | null;
    return !!u && Array.isArray(u.moved) && Array.isArray(u.collapsed) && Array.isArray(u.relatives) && Array.isArray(u.correctionIds);
}

/** A survivor now in a household where a correction says it does not live — and it wasn't so before the merge. */
export type MergeDispute = { householdId: string; membershipId: string };

const toMs = (d: Date | number | null | undefined): number | null => (d == null ? null : d instanceof Date ? d.getTime() : Number(d) * 1000);

function stored(r: MembershipRow): StoredMembership {
    return {
        id: r.id, householdId: r.householdId, adopterId: r.adopterId, relationship: r.relationship,
        relativeToAdopterId: r.relativeToAdopterId ?? null, giftRecipient: r.giftRecipient ? 1 : 0, addedBy: r.addedBy ?? null,
        addedAt: toMs(r.addedAt) ?? Date.now(), sourceKey: r.sourceKey ?? null, recordedAt: toMs(r.recordedAt),
    };
}

const isAnchorRow = (r: { relativeToAdopterId: string | null; addedBy: string | null }) => r.relativeToAdopterId == null && r.addedBy == null;

/**
 * What the survivor's row takes from the absorbed one when they collapse. Pure.
 * Gift households are not homes: no anchor shape is carried there.
 */
export function collapsePatch(absorbed: StoredMembership | MembershipRow, mine: StoredMembership | MembershipRow, survivorId: string): Partial<ShapeCols> {
    const patch: Partial<ShapeCols> = {};
    const gift = !!absorbed.giftRecipient || !!mine.giftRecipient;
    const a = { relativeToAdopterId: absorbed.relativeToAdopterId ?? null, addedBy: absorbed.addedBy ?? null };
    const m = { relativeToAdopterId: mine.relativeToAdopterId ?? null, addedBy: mine.addedBy ?? null };
    if (!gift && isAnchorRow(a) && !isAnchorRow(m)) {
        // The absorbed profile's own home: it stays the survivor's home (ensureHousehold reads this shape).
        patch.relationship = absorbed.relationship;
        patch.relativeToAdopterId = null;
        patch.addedBy = null;
    } else if (!isAnchorRow(m) && mine.relationship === 'unknown' && absorbed.relationship !== 'unknown') {
        patch.relationship = absorbed.relationship;
        patch.relativeToAdopterId = a.relativeToAdopterId === survivorId ? null : a.relativeToAdopterId;
    }
    if (absorbed.giftRecipient && !mine.giftRecipient) patch.giftRecipient = 1;
    if (absorbed.sourceKey && !mine.sourceKey) patch.sourceKey = absorbed.sourceKey;
    // Only real changes.
    for (const k of SHAPE_KEYS) {
        if (k in patch && (patch[k] ?? null) === ((mine as Record<ShapeKey, unknown>)[k] ?? null)) delete patch[k];
    }
    return patch;
}

/** `col IS value` — matches NULL too (the guard every undo step writes against). */
const isValue = (col: SQLWrapper, v: unknown) => sql`${col} IS ${v ?? null}`;

const COLUMN: Record<ShapeKey, SQLWrapper> = {
    relationship: householdMemberships.relationship,
    relativeToAdopterId: householdMemberships.relativeToAdopterId,
    addedBy: householdMemberships.addedBy,
    giftRecipient: householdMemberships.giftRecipient,
    sourceKey: householdMemberships.sourceKey,
};

/**
 * One absorbed row onto the survivor: moved when the survivor isn't in that
 * household, collapsed when it is. 'gone' when the row left meanwhile.
 */
async function placeOnSurvivor(db: Db, a: MembershipRow, survivorId: string, absorbedId: string, undo: HouseholdMergeUndo, ctx: Ctx): Promise<'moved' | 'collapsed' | 'gone'> {
    const c = { ...ctx, membershipId: a.id, householdId: a.householdId };
    for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
        const moved = await db.update(householdMemberships)
            .set({
                adopterId: survivorId,
                relativeToAdopterId: sql`CASE WHEN ${householdMemberships.relativeToAdopterId} = ${survivorId} THEN NULL ELSE ${householdMemberships.relativeToAdopterId} END`,
            })
            .where(and(
                eq(householdMemberships.id, a.id),
                eq(householdMemberships.adopterId, absorbedId),
                sql`NOT EXISTS (SELECT 1 FROM household_memberships o WHERE o.household_id = ${a.householdId} AND o.adopter_id = ${survivorId})`,
            ))
            .returning({ id: householdMemberships.id });
        if (moved.length > 0) {
            undo.moved.push({ id: a.id, householdId: a.householdId, relativeToAdopterId: a.relativeToAdopterId ?? null });
            return 'moved';
        }
        const now = await membershipById(db, a.id);
        if (!now || now.adopterId !== absorbedId) {
            logger.info('householdMerge: membership left before the merge reached it', c);
            return 'gone';
        }
        const mine = await membershipIn(db, a.householdId, survivorId);
        if (!mine) continue; // the survivor left meanwhile: try the move again
        // 1. Remove the absorbed row, only while the survivor's row is there.
        //    RETURNING says whether THIS statement removed it: only then is
        //    there a collapse to record (and to undo).
        const removed = await db.delete(householdMemberships).where(and(
            eq(householdMemberships.id, a.id),
            eq(householdMemberships.adopterId, absorbedId),
            sql`EXISTS (SELECT 1 FROM household_memberships o WHERE o.id = ${mine.id})`,
        )).returning({ id: householdMemberships.id });
        if (removed.length === 0) continue; // it left, or the survivor's row did: look again
        // 2. Recorded at once: whatever fails from here, the revert re-inserts it.
        const record: HouseholdMergeUndo['collapsed'][number] = { row: stored(now), survivorRowId: mine.id, survivorBefore: {}, survivorAfter: {} };
        undo.collapsed.push(record);
        // 3. The survivor's row takes the stronger shape — compare-and-set on the
        //    values read, so a concurrent collapse into the same row (or an edit)
        //    is never overwritten; then nothing is taken.
        const patch = collapsePatch(now, mine, survivorId);
        const keys = Object.keys(patch) as ShapeKey[];
        if (keys.length) {
            const before: Partial<ShapeCols> = {};
            for (const k of keys) (before as Record<ShapeKey, unknown>)[k] = (mine as Record<ShapeKey, unknown>)[k] ?? null;
            const patched = await db.update(householdMemberships).set(patch)
                .where(and(eq(householdMemberships.id, mine.id), ...keys.map(k => isValue(COLUMN[k], (before as Record<ShapeKey, unknown>)[k]))))
                .returning({ id: householdMemberships.id });
            if (patched.length > 0) {
                record.survivorBefore = before;
                record.survivorAfter = patch;
            } else {
                logger.info('householdMerge: survivor row changed meanwhile, collapse took nothing from the absorbed row', { ...c, survivorRowId: mine.id });
            }
        }
        return 'collapsed';
    }
    throw new Error(`householdMerge: membership ${a.id} kept changing during the merge`);
}

/**
 * Move the absorbed profile's household rows onto the survivor (see the module
 * comment). Records into `undo` as it goes. Returns the households the survivor
 * newly joined (for the housemate-pair cleanup, run once the merge stands) and
 * the disputes to notify. Throws on a DB failure — the caller reverts with
 * `restoreMembershipsAfterMerge(undo)`.
 */
export async function moveMembershipsOnMerge(
    db: Db,
    merge: { survivorId: string; absorbedId: string },
    undo: HouseholdMergeUndo,
    ctx: Ctx,
): Promise<{ joined: string[]; disputes: MergeDispute[] }> {
    const { survivorId, absorbedId } = merge;
    const correctedIn = async (adopterId: string) => new Set((await db.select({ householdId: householdCorrections.householdId }).from(householdCorrections)
        .where(eq(householdCorrections.adopterId, adopterId)).limit(MAX_MERGE_MEMBERSHIPS).all() as Array<{ householdId: string }>).map(r => r.householdId));
    const [survivorRows, wasCorrected, absorbedWasCorrected] = await Promise.all([
        membershipsOfProfile(db, survivorId, MAX_MERGE_MEMBERSHIPS),
        correctedIn(survivorId),
        correctedIn(absorbedId),
    ]);
    const absorbedRows = await membershipsOfProfile(db, absorbedId, MAX_MERGE_MEMBERSHIPS);
    if (absorbedRows.length >= MAX_MERGE_MEMBERSHIPS) {
        logger.warn('householdMerge: membership cap hit, later memberships stay on the absorbed profile', { ...ctx, cap: MAX_MERGE_MEMBERSHIPS });
    }
    const wasThere = new Set(survivorRows.map(r => r.householdId));
    const absorbedWasThere = new Set(absorbedRows.map(r => r.householdId));

    const touched = new Set<string>();
    const joined = new Set<string>();
    for (const a of absorbedRows) {
        const outcome = await placeOnSurvivor(db, a, survivorId, absorbedId, undo, ctx);
        if (outcome === 'gone') continue;
        touched.add(a.householdId);
        if (outcome === 'moved' && !a.giftRecipient) joined.add(a.householdId);
    }

    // «hijo de <absorbed>» → «hijo de <survivor>»; the survivor's own row relative to nobody.
    const relatives = await db.update(householdMemberships)
        .set({ relativeToAdopterId: sql`CASE WHEN ${householdMemberships.adopterId} = ${survivorId} THEN NULL ELSE ${survivorId} END` })
        .where(eq(householdMemberships.relativeToAdopterId, absorbedId))
        .returning({ id: householdMemberships.id, to: householdMemberships.relativeToAdopterId }) as Array<{ id: string; to: string | null }>;
    undo.relatives.push(...relatives.map(r => ({ id: r.id, to: r.to ?? null })));

    const corrections = await db.update(householdCorrections)
        .set({ adopterId: survivorId })
        .where(eq(householdCorrections.adopterId, absorbedId))
        .returning({ id: householdCorrections.id, householdId: householdCorrections.householdId }) as Array<{ id: string; householdId: string }>;
    undo.correctionIds.push(...corrections.map(c => c.id));
    for (const c of corrections) touched.add(c.householdId);

    // D48: the survivor now lives where a correction says it doesn't — and that
    // was not already so before the merge for either profile (an earlier re-add
    // of that same profile was disputed then).
    const disputes: MergeDispute[] = [];
    for (const householdId of touched) {
        if (wasThere.has(householdId) && wasCorrected.has(householdId)) continue;
        if (absorbedWasThere.has(householdId) && absorbedWasCorrected.has(householdId)) continue;
        const [mine, corrected] = await Promise.all([membershipIn(db, householdId, survivorId), hasCorrection(db, householdId, survivorId)]);
        if (mine && corrected) disputes.push({ householdId, membershipId: mine.id });
    }

    if (absorbedRows.length || relatives.length || corrections.length) {
        logger.info('householdMerge: memberships moved with a merge', {
            ...ctx, moved: undo.moved.length, collapsed: undo.collapsed.length, relatives: relatives.length,
            corrections: corrections.length, disputes: disputes.length,
        });
    }
    return { joined: [...joined], disputes };
}

/** After the merge stands: the survivor's pending duplicate pairs with its new housemates go (Task 5 join rule). Never throws. */
export async function clearHousematePairsAfterMerge(db: Db, survivorId: string, joined: readonly string[]): Promise<void> {
    for (const householdId of joined) await dropHousemateCandidates(db, householdId, survivorId);
}

/** «Pedro» for the dispute notice: the household's anchor (or its oldest other member). Null on failure (logged). */
export async function householdHostName(db: Db, householdId: string, personId: string, ctx: Ctx): Promise<string | null> {
    try {
        const rows = (await membershipsOf(db, householdId, 10)).filter(r => r.adopterId !== personId);
        const host = rows.find(r => isAnchorRow({ relativeToAdopterId: r.relativeToAdopterId ?? null, addedBy: r.addedBy ?? null })) ?? rows[0];
        if (!host) return null;
        const row = await db.select({ name: adopters.name }).from(adopters).where(eq(adopters.id, host.adopterId)).get();
        return row?.name ?? null;
    } catch (e) {
        logger.warn('householdMerge: host name not read, dispute notice goes without it', { ...ctx, householdId, error: errMsg(e) });
        return null;
    }
}

/**
 * Reverse `moveMembershipsOnMerge` from its recorded `undo`, newest step first.
 * Every write is guarded by what the merge left, so a later removal, move or
 * edit stands. Throws on a DB failure (the unmerge is retryable).
 */
export async function restoreMembershipsAfterMerge(
    db: Db,
    undo: HouseholdMergeUndo,
    merge: { survivorId: string; absorbedId: string },
    ctx: Ctx,
): Promise<void> {
    const { survivorId, absorbedId } = merge;

    for (let i = 0; i < undo.correctionIds.length; i += CHUNK) {
        const chunk = undo.correctionIds.slice(i, i + CHUNK);
        await db.update(householdCorrections).set({ adopterId: absorbedId })
            .where(and(or(...chunk.map(id => eq(householdCorrections.id, id))), eq(householdCorrections.adopterId, survivorId)));
    }

    for (const r of undo.relatives) {
        await db.update(householdMemberships).set({ relativeToAdopterId: absorbedId })
            .where(and(eq(householdMemberships.id, r.id), isValue(householdMemberships.relativeToAdopterId, r.to)));
    }

    let notRestored = 0;
    for (const c of [...undo.collapsed].reverse()) {
        // The survivor left that household since («No vive acá», a removal): the
        // person is not put back there under the absorbed profile either — the
        // same rule as a moved row removed since.
        if (!(await membershipById(db, c.survivorRowId))) {
            notRestored++;
            continue;
        }
        // The survivor's row gives back what it took (its source_key first, so the
        // absorbed row can have it again), then the absorbed row comes back as it was.
        const statements: BatchItem<'sqlite'>[] = [];
        for (const k of Object.keys(c.survivorAfter ?? {}) as ShapeKey[]) {
            statements.push(db.update(householdMemberships)
                .set({ [k]: (c.survivorBefore as Record<ShapeKey, unknown>)[k] ?? null } as Partial<ShapeCols>)
                .where(and(eq(householdMemberships.id, c.survivorRowId), isValue(COLUMN[k], (c.survivorAfter as Record<ShapeKey, unknown>)[k]))));
        }
        const r = c.row;
        statements.push(db.insert(householdMemberships).values({
            id: r.id, householdId: r.householdId, adopterId: r.adopterId, relationship: r.relationship,
            relativeToAdopterId: r.relativeToAdopterId, giftRecipient: r.giftRecipient, addedBy: r.addedBy,
            addedAt: new Date(r.addedAt), sourceKey: r.sourceKey, recordedAt: r.recordedAt == null ? null : new Date(r.recordedAt),
        }).onConflictDoNothing());
        await runBatch(db, statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
        if (!(await membershipById(db, r.id))) notRestored++;
    }

    let stayed = 0;
    for (const m of undo.moved) {
        // The relative the merge cleared (it was the survivor) comes back; one edited since stays.
        const mergeLeft = m.relativeToAdopterId === survivorId ? null : m.relativeToAdopterId;
        const back = await db.update(householdMemberships)
            .set({
                adopterId: absorbedId,
                relativeToAdopterId: sql`CASE WHEN ${householdMemberships.relativeToAdopterId} IS ${mergeLeft} THEN ${m.relativeToAdopterId} ELSE ${householdMemberships.relativeToAdopterId} END`,
            })
            .where(and(
                eq(householdMemberships.id, m.id),
                eq(householdMemberships.adopterId, survivorId),
                sql`NOT EXISTS (SELECT 1 FROM household_memberships o WHERE o.household_id = ${m.householdId} AND o.adopter_id = ${absorbedId})`,
            ))
            .returning({ id: householdMemberships.id });
        if (back.length === 0) stayed++;
    }

    if (notRestored || stayed) {
        logger.info('householdMerge: undo — memberships changed since the merge stay as they are', { ...ctx, survivorId, absorbedId, notRestored, stayed });
    }
}
