/**
 * A profile's activity, counted by record type — what the «Actividad» header
 * shows («1 adopción · 2 pedidos · 1 tránsito»). One rule for every surface
 * that summarises a person's activity: the profile's own header
 * (AdoptionHistory, over getAdoptions' rows) and each person in
 * «Familiares / Convivientes» (countsFor, over the same `adoptions` view).
 * Pure — no DB, no server imports.
 */
import { RECORD_TYPES } from './constants';

/** The kinds the header counts, in the order it shows them. */
export const ACTIVITY_KINDS = [
    RECORD_TYPES.ADOPTION,
    RECORD_TYPES.REQUEST,
    RECORD_TYPES.OBSERVATION,
    RECORD_TYPES.FOLLOW_UP,
    RECORD_TYPES.RETURNED,
    RECORD_TYPES.FOSTER,
] as const;

export type ActivityKind = typeof ACTIVITY_KINDS[number];

/** How many records of each kind; a kind with none is absent. */
export type ActivityCounts = Partial<Record<ActivityKind, number>>;

const KINDS: ReadonlySet<string> = new Set(ACTIVITY_KINDS);

/**
 * Counts records by type. A record with no type is an adoption (the header's
 * long-standing rule for legacy rows); anything that isn't one of the six
 * kinds (an animal still «available») is not activity.
 */
export function countActivity(records: Iterable<{ recordType?: string | null }>): ActivityCounts {
    const out: ActivityCounts = {};
    for (const r of records) {
        const kind = r.recordType || RECORD_TYPES.ADOPTION;
        if (!KINDS.has(kind)) continue;
        out[kind as ActivityKind] = (out[kind as ActivityKind] ?? 0) + 1;
    }
    return out;
}

/** The counts as the header lists them: kinds in order, zero kinds left out. */
export function activityParts(counts: ActivityCounts): Array<{ kind: ActivityKind; n: number }> {
    return ACTIVITY_KINDS.filter(k => (counts[k] ?? 0) > 0).map(k => ({ kind: k, n: counts[k]! }));
}
