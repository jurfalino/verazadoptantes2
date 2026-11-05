import { logger } from '@/lib/logger';
import { getFeatureFlag } from '@/config/features';

/**
 * Due follow-ups per animal — the «N pendientes» badge on /my-animals, the
 * «Con controles pendientes» tab and the homepage animals card. One
 * implementation so the three can never disagree.
 *
 * Moved out of /api/my-animals (v2.55.16 badge, v2.55.20 bulk read). The bulk
 * read is 4 queries TOTAL, independent of N; everything per animal is a pure
 * map lookup.
 */

type ActiveRow = { id: string; animalId: string; startedAt: unknown; endedAt: unknown; recordType: string; recordedBy: string | null; createdAt: unknown };
type EvRow = { id: string; animalId: string | null; date: unknown; followupKey: string | null; followupSubtype: string | null; eventType: string; placementId: string | null; recordedBy: string | null; createdAt: unknown };
type CareRow = { id: string; animalId: string; date: unknown; followupKey: string | null; eventType: string; recordedBy: string | null; createdAt: unknown };
type AnimalRow = { id: string; estimatedBirthDate: unknown; neutered: number | null; updatedAt: unknown; updatedBy: string | null };

export type AnimalActivityBulk = {
    activeByAnimal: Map<string, ActiveRow>;
    placementsByAnimal: Map<string, ActiveRow[]>;
    eventsByAnimal: Map<string, EvRow[]>;
    careByAnimal: Map<string, CareRow[]>;
    animalById: Map<string, AnimalRow>;
};

export type FollowupCtx = {
    schedule: import('@/domain/followups').ScheduleEntry[];
    fosterRule: import('@/domain/followups').FosterRule;
    compute: typeof import('@/domain/followups').computeFollowups;
};

/** The soonest-overdue slot, so a badge can name the action instead of only counting it. */
export type DueTop = { copyKey: string; offsetDays?: number; dueDate: number };

/** Every placement, adopter event, care event and animal row owned by the team. Null (logged) when the read fails. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Drizzle D1/better-sqlite3 union getDb() returns
export async function loadAnimalActivityBulk(db: any, scopeEmails: string[], log: Record<string, unknown>): Promise<AnimalActivityBulk | null> {
    try {
        const { placements, adopterEvents, animalEvents, animals } = await import('@/db/schema');
        const { eq, or } = await import('drizzle-orm');
        const ownerMatch = or(...scopeEmails.map((e: string) => eq(animals.addedBy, e)));
        const [placementRows, evRows, careRows, animalRows] = await Promise.all([
            // NOT filtered to active: an ENDED span (a devolución) is an
            // update too, and `active` is derived from endedAt in JS.
            db.select({ id: placements.id, animalId: placements.animalId, startedAt: placements.startedAt, endedAt: placements.endedAt, recordType: placements.recordType, recordedBy: placements.recordedBy, createdAt: placements.createdAt })
                .from(placements).innerJoin(animals, eq(animals.id, placements.animalId))
                .where(ownerMatch).all(),
            db.select({ id: adopterEvents.id, animalId: adopterEvents.animalId, date: adopterEvents.date, followupKey: adopterEvents.followupKey, followupSubtype: adopterEvents.followupSubtype, eventType: adopterEvents.eventType, placementId: adopterEvents.placementId, recordedBy: adopterEvents.recordedBy, createdAt: adopterEvents.createdAt })
                .from(adopterEvents).innerJoin(animals, eq(animals.id, adopterEvents.animalId))
                .where(ownerMatch).all(),
            db.select({ id: animalEvents.id, animalId: animalEvents.animalId, date: animalEvents.date, followupKey: animalEvents.followupKey, eventType: animalEvents.eventType, recordedBy: animalEvents.recordedBy, createdAt: animalEvents.createdAt })
                .from(animalEvents).innerJoin(animals, eq(animals.id, animalEvents.animalId))
                .where(ownerMatch).all(),
            db.select({ id: animals.id, estimatedBirthDate: animals.estimatedBirthDate, neutered: animals.neutered, updatedAt: animals.updatedAt, updatedBy: animals.updatedBy })
                .from(animals).where(ownerMatch).all(),
        ]);

        const placementsByAnimal = new Map<string, ActiveRow[]>();
        const activeByAnimal = new Map<string, ActiveRow>();
        for (const r of placementRows as ActiveRow[]) {
            const list = placementsByAnimal.get(r.animalId) || []; list.push(r); placementsByAnimal.set(r.animalId, list);
            if (r.endedAt == null) activeByAnimal.set(r.animalId, r);
        }
        const eventsByAnimal = new Map<string, EvRow[]>();
        for (const r of evRows as EvRow[]) {
            if (!r.animalId) continue;
            const list = eventsByAnimal.get(r.animalId) || []; list.push(r); eventsByAnimal.set(r.animalId, list);
        }
        const careByAnimal = new Map<string, CareRow[]>();
        for (const r of careRows as CareRow[]) {
            const list = careByAnimal.get(r.animalId) || []; list.push(r); careByAnimal.set(r.animalId, list);
        }
        const animalById = new Map<string, AnimalRow>();
        for (const r of animalRows as AnimalRow[]) animalById.set(r.id, r);

        return { activeByAnimal, placementsByAnimal, eventsByAnimal, careByAnimal, animalById };
    } catch (e) {
        logger.warn('animalFollowupsDue: bulk activity fallback', { ...log, error: e instanceof Error ? e.message : String(e) });
        return null;
    }
}

/** The viewer's follow-up schedule. Null when ENABLE_FOLLOWUPS is off, or (logged) when the settings read fails. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see loadAnimalActivityBulk
export async function loadFollowupCtx(db: any, userEmail: string, log: Record<string, unknown>): Promise<FollowupCtx | null> {
    const followupsOn = await getFeatureFlag('ENABLE_FOLLOWUPS').catch((e: unknown) => {
        logger.warn('animalFollowupsDue: ENABLE_FOLLOWUPS read failed, badges off', { ...log, error: e instanceof Error ? e.message : String(e) });
        return false;
    });
    if (!followupsOn) return null;
    try {
        const { computeFollowups, mergeSchedule, mergeFosterRule, parseFollowupSettings, DEFAULT_SCHEDULE } = await import('@/domain/followups');
        const { users, userProfiles } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');
        const row = await db.select({ settings: userProfiles.followupSettings })
            .from(userProfiles)
            .innerJoin(users, eq(users.id, userProfiles.userId))
            .where(eq(users.email, userEmail)).get();
        const settings = parseFollowupSettings(row?.settings);
        return {
            schedule: mergeSchedule(DEFAULT_SCHEDULE, settings),
            fosterRule: mergeFosterRule(settings),
            compute: computeFollowups,
        };
    } catch (e) {
        logger.warn('animalFollowupsDue: followup settings fallback', { ...log, error: e instanceof Error ? e.message : String(e) });
        return null;
    }
}

/**
 * «Con controles pendientes»: the placed rows with a follow-up due now,
 * deduped by id (the compat view can repeat one), most overdue first.
 */
export function withDueFollowups<R extends { id: string; adopterId: string | null; date: unknown }>(
    rows: R[],
    bulk: AnimalActivityBulk | null,
    ctx: FollowupCtx | null,
    log: Record<string, unknown>,
): Array<R & { dueFollowups: number; dueTop: DueTop }> {
    const seen = new Set<string>();
    const out: Array<R & { dueFollowups: number; dueTop: DueTop }> = [];
    for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const due = dueForAnimal(r, bulk, ctx, log);
        if (due.dueFollowups > 0 && due.dueTop) out.push({ ...r, dueFollowups: due.dueFollowups, dueTop: due.dueTop });
    }
    return out.sort((a, b) => a.dueTop.dueDate - b.dueTop.dueDate);
}

const asDate = (v: unknown): Date | null => v instanceof Date ? v : typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : null;

/**
 * Due follow-ups for one animal row of the compat view. Only animals with an
 * active placement (the row's adopterId marks it) can have any. Pure; a
 * failure degrades this row to none (logged).
 */
export function dueForAnimal(
    animal: { id: string; adopterId: string | null; date: unknown },
    bulk: AnimalActivityBulk | null,
    ctx: FollowupCtx | null,
    log: Record<string, unknown>,
): { dueFollowups: number; dueTop: DueTop | null } {
    const none = { dueFollowups: 0, dueTop: null };
    if (!ctx || !bulk || !animal.adopterId || !animal.date) return none;
    try {
        const active = bulk.activeByAnimal.get(animal.id);
        if (!active?.startedAt) return none;
        const evRows = bulk.eventsByAnimal.get(animal.id) || [];
        const careRows = bulk.careByAnimal.get(animal.id) || [];
        const animalRow = bulk.animalById.get(animal.id);
        const slots = ctx.compute({
            placementStartedAt: asDate(active.startedAt)!,
            placementType: active.recordType,
            animal: { estimatedBirthDate: asDate(animalRow?.estimatedBirthDate ?? null), neutered: animalRow?.neutered ?? null },
            schedule: ctx.schedule,
            fosterRule: ctx.fosterRule,
            recorded: [
                ...evRows.filter(e => e.placementId === active.id || !e.placementId)
                    .map(e => ({ id: e.id, date: asDate(e.date), followupKey: e.followupKey, subtype: e.followupSubtype, eventType: e.eventType })),
                ...careRows.map(e => ({ id: e.id, date: asDate(e.date), followupKey: e.followupKey, subtype: null, eventType: e.eventType })),
            ],
            now: new Date(),
        });
        const due = slots.filter(s => s.status === 'due')
            .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
        return {
            dueFollowups: due.length,
            dueTop: due[0] ? { copyKey: due[0].copyKey, offsetDays: due[0].offsetDays, dueDate: due[0].dueDate.getTime() } : null,
        };
    } catch (e) {
        logger.warn('animalFollowupsDue: due-followups fallback', { ...log, animalId: animal.id, error: e instanceof Error ? e.message : String(e) });
        return none;
    }
}

export type AnimalLastUpdate = { by: string; at: number; kind: 'updated' | 'added' };

const toMs = (v: unknown): number | null =>
    v instanceof Date ? v.getTime() : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : null;

/**
 * Who last touched this animal, and when — the /my-animals card's
 * «Actualizado por …» and the order of the «Todos» tab and the homepage card.
 *
 * v2.56.16: derived rather than stamped — placements/adopter_events/
 * animal_events all carry `recorded_by`, so nothing has to remember to keep a
 * column fresh. `animals.updated_by` covers the one case those tables cannot
 * see: a pure ficha edit.
 *
 * created_at, NOT date/started_at: those are real-world dates the rescuer
 * types and can backdate by months, and "actualizado" means app-time.
 * 'anonymous' is the tables' DEFAULT, so it is not an actor — skip it and fall
 * back to the registration.
 */
export function animalLastUpdate(
    animal: { id: string; addedBy?: string | null; date?: unknown },
    bulk: AnimalActivityBulk | null,
): AnimalLastUpdate | null {
    const named = (by: string | null | undefined): by is string => !!by && by !== 'anonymous';
    let last: AnimalLastUpdate | null = null;
    if (bulk) {
        const consider = (by: string | null | undefined, at: unknown) => {
            const ms = toMs(at);
            if (!named(by) || ms == null) return;
            if (!last || ms > last.at) last = { by, at: ms, kind: 'updated' };
        };
        const arow = bulk.animalById.get(animal.id);
        consider(arow?.updatedBy, arow?.updatedAt);
        for (const p of bulk.placementsByAnimal.get(animal.id) || []) consider(p.recordedBy, p.createdAt);
        for (const e of bulk.eventsByAnimal.get(animal.id) || []) consider(e.recordedBy, e.createdAt);
        for (const c of bulk.careByAnimal.get(animal.id) || []) consider(c.recordedBy, c.createdAt);
    }
    // Never touched since it was created — say so honestly rather than
    // calling a registration an update.
    if (!last && named(animal.addedBy) && toMs(animal.date) != null) {
        last = { by: animal.addedBy as string, at: toMs(animal.date)!, kind: 'added' };
    }
    return last;
}

/** «Most recently updated first» sort key: the last update, else the record's date, else 0 (last). */
export function animalActivityAt(animal: { id: string; addedBy?: string | null; date?: unknown }, bulk: AnimalActivityBulk | null): number {
    return animalLastUpdate(animal, bulk)?.at ?? toMs(animal.date) ?? 0;
}

/** Newest activity first; ties by the record's date, newest first. Returns a new array. */
export function byRecentActivity<R extends { id: string; addedBy?: string | null; date?: unknown }>(rows: readonly R[], bulk: AnimalActivityBulk | null): R[] {
    const key = new Map(rows.map(r => [r.id, animalActivityAt(r, bulk)]));
    return [...rows].sort((a, b) => (key.get(b.id)! - key.get(a.id)!) || ((toMs(b.date) ?? 0) - (toMs(a.date) ?? 0)));
}
