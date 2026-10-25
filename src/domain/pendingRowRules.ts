/**
 * «Pendientes de revisar» row rules (layout D) that decide what the UI asks
 * before a click — pure, over the feed's shapes (getPendingDuplicatesForUser).
 * The server re-decides every click; these only choose what to show.
 */

import type { KeepAction, KeepSide } from './dedupPair';

export interface RowSide { id: string; teamOwned: boolean }

export interface RowPair {
    group: 'received' | 'sent' | 'declined' | 'pair';
    newAdopter: RowSide;
    existingAdopter: RowSide;
    actionByKeep: { new: KeepAction | null; existing: KeepAction | null };
    request: null | { direction: 'sent' | 'received'; keepId: string };
}

export const otherSide = (s: KeepSide): KeepSide => (s === 'new' ? 'existing' : 'new');

export function sideOf<P extends RowPair>(pair: P, s: KeepSide): P['newAdopter'] {
    return s === 'new' ? pair.newAdopter : pair.existingAdopter;
}

export function sideById(pair: RowPair, id: string): KeepSide | null {
    return pair.newAdopter.id === id ? 'new' : pair.existingAdopter.id === id ? 'existing' : null;
}

/**
 * Keeping `keep` merges now and folds the viewer's (or their team's) adopter
 * into another rescuer's profile: the case D25 confirms («pasará a la lista
 * de …»). Same team, a request, or absorbing the other's: no confirmation.
 */
export function movesToOtherList(pair: RowPair, keep: KeepSide): boolean {
    const kept = sideOf(pair, keep);
    const absorbed = sideOf(pair, otherSide(keep));
    return pair.actionByKeep[keep] === 'merge' && absorbed.teamOwned && !kept.teamOwned;
}

/**
 * A declined request, seen by its requester: the asked owner's side, when it
 * may be kept right away (D43 — no consent needed). Null otherwise, including
 * a pair rebuilt from the request, where nothing is allowed.
 */
export function combineTheirsSide(pair: RowPair): KeepSide | null {
    const r = pair.request;
    if (pair.group !== 'declined' || !r || r.direction !== 'sent') return null;
    const requesterKeep = sideById(pair, r.keepId);
    if (!requesterKeep) return null;
    const theirs = otherSide(requesterKeep);
    return pair.actionByKeep[theirs] === 'merge' ? theirs : null;
}
