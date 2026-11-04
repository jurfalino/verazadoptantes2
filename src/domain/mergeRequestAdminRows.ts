/**
 * The admin «Pedidos de combinación» list shows ONE row per pair (one shared
 * reality, D49). After an owner rejects a request, the requester's «Pedir
 * revisión a un administrador» files a second request on the same pair — a
 * dispute, to the admins. Listing both would show the same disagreement twice
 * (and offer «Aprobar igual» on the old one beside «Aprobar» on the new).
 * Instead the dispute row stands for the pair and carries the other side's
 * position: who rejected it, and when.
 *
 * Pure: over the rows listMergeRequestsForAdmin built (src/lib/mergeRequests.ts).
 */

import { pairKey } from './dedupPair';

export interface AdminRequestRowLike {
    id: string;
    status: string;
    /** Filed to the admins after the owner rejected the pair (D49). */
    dispute: boolean;
    primary: { id: string };
    secondary: { id: string };
    /** The asked owner (null for a request to the admins). */
    ownerEmail: string | null;
    /** Who answered it (on a declined request: who rejected it). */
    resolvedByEmail: string | null;
    /** epoch ms */
    resolvedAt: number | null;
}

/** The rejection a dispute row answers: who said «no es la misma persona», and when. */
export interface RejectedPosition {
    byEmail: string | null;
    /** epoch ms */
    at: number | null;
}

/**
 * Collapse each pair that has an open dispute into that dispute's row, with
 * the latest declined request on the pair (either orientation) as
 * `rejected`; those declined rows are dropped. Every other row is kept, in
 * order, with `rejected: null`.
 */
export function oneRowPerPair<R extends AdminRequestRowLike>(rows: ReadonlyArray<R>): Array<R & { rejected: RejectedPosition | null }> {
    const keyOf = (r: R) => pairKey(r.primary.id, r.secondary.id);
    const disputed = new Set(rows.filter(r => r.dispute && r.status === 'pending').map(keyOf));
    const latestDecline = new Map<string, R>();
    for (const r of rows) {
        if (r.status !== 'declined' || r.dispute || !disputed.has(keyOf(r))) continue;
        const seen = latestDecline.get(keyOf(r));
        if (!seen || (r.resolvedAt ?? 0) >= (seen.resolvedAt ?? 0)) latestDecline.set(keyOf(r), r);
    }
    return rows
        .filter(r => !(r.status === 'declined' && !r.dispute && disputed.has(keyOf(r))))
        .map(r => {
            if (!(r.dispute && r.status === 'pending')) return { ...r, rejected: null };
            const d = latestDecline.get(keyOf(r));
            return { ...r, rejected: d ? { byEmail: d.resolvedByEmail ?? d.ownerEmail, at: d.resolvedAt } : null };
        });
}
