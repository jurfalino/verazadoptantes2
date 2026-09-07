/**
 * Ordering for the animal's line of life (v2.56.14).
 *
 * The rail is newest-at-top, so a plain `b.date - a.date` is *almost* right —
 * until two items share an instant, which is not an edge case here: registering
 * an animal that is already adopted writes `animals.created_at` and
 * `placements.started_at` from the same clock read, byte-identical. `Array.sort`
 * is stable, so the tie fell to insertion order (origin pushed first) and the
 * page claimed the animal was registered *after* it was adopted.
 *
 * So same-instant items order by CAUSE instead: an animal is registered, then
 * placed, then things happen to it during that placement. Reading downward, the
 * story stays in the order it actually occurred.
 */

/** Item kinds in causal order — higher sits higher on a newest-first rail. */
const RANK: Record<string, number> = {
    adopter_event: 4,   // follow-ups, returns — happen DURING a placement
    animal_event: 4,    // vaccination, neuter, vet — likewise
    placement_start: 3, // a same-day handoff reads "adopted by B" above "foster with A ended"
    placement_end: 2,
    created: 1,         // the origin is always the bottom of a same-instant cluster
};

export type OrderableTimelineItem = {
    kind: string;
    date: number | null;
    placementId?: string | null;
};

export function compareTimelineItems(a: OrderableTimelineItem, b: OrderableTimelineItem): number {
    const byDate = (b.date ?? 0) - (a.date ?? 0);
    if (byDate !== 0) return byDate;

    // A zero-day span still ended after it started — and for ONE placement that
    // beats the generic start-above-end rule (which exists for handoffs between
    // two different placements on the same day).
    if (a.placementId && a.placementId === b.placementId) {
        if (a.kind === 'placement_end' && b.kind === 'placement_start') return -1;
        if (a.kind === 'placement_start' && b.kind === 'placement_end') return 1;
    }

    return (RANK[b.kind] ?? 0) - (RANK[a.kind] ?? 0);
}
