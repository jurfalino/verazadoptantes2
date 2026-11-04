/**
 * Where a merged-away profile's URL should send people. Pure — the DB lookup
 * that answers "what does this id find?" lives in src/lib/mergedAdopterRedirect.ts.
 *
 * A merge soft-deletes the absorbed profile, so its old /adopter/<id> link
 * (notifications, history, bookmarks, another rescuer's open tab) used to 404.
 * It now follows the merge to the profile that absorbed it:
 *   - chains are followed to the end (C merged into B, B later into A → A);
 *   - only a LIVE survivor is a destination — if the survivor was itself
 *     deleted (not merged), there is nowhere to go and the link stays a 404;
 *   - a profile deleted for any other reason (admin delete, API delete, demo
 *     rows) is never a redirect;
 *   - an undone merge doesn't count: undo brings the profile back, so its
 *     own URL works again, and a later re-merge points to the new survivor.
 */

export type MergeStep =
    | { kind: 'live' }
    | { kind: 'merged'; into: string }
    | { kind: 'gone' };

/** Plenty for any real chain; it only exists so bad data can't loop forever. */
export const MAX_MERGE_HOPS = 10;

/**
 * Follow `startId` through merges to a live profile. Returns the survivor's
 * id, or null when `startId` is not a merged-away profile or the chain ends
 * nowhere live (deleted survivor, cycle, too many hops).
 */
export async function followMergeChain(
    startId: string,
    step: (id: string) => Promise<MergeStep>,
    maxHops = MAX_MERGE_HOPS,
): Promise<string | null> {
    const visited = new Set<string>([startId]);
    let current = startId;
    for (let hop = 0; hop <= maxHops; hop++) {
        const s = await step(current);
        if (s.kind === 'live') return current === startId ? null : current;
        if (s.kind === 'gone') return null;
        if (hop === maxHops || visited.has(s.into)) return null;
        visited.add(s.into);
        current = s.into;
    }
    return null;
}

export interface MergeRecord {
    /** The survivor this merge folded the profile into. */
    primaryId: string | null;
    createdAt: number;
    undone: boolean;
}

/**
 * A profile can have several merge records (merged, undone, merged again).
 * The one in force is the latest that was not undone.
 */
export function pickActiveMerge(records: MergeRecord[]): string | null {
    const active = records
        .filter(r => !r.undone && r.primaryId)
        .sort((a, b) => b.createdAt - a.createdAt);
    return active[0]?.primaryId ?? null;
}
