import { describe, it, expect } from 'vitest';
import { combineTheirsSide, deferredToEvaluation, movesToOtherList, needsViewer, type RowPair } from './pendingRowRules';

const pair = (over: Partial<RowPair> & { mineNew?: boolean; mineExisting?: boolean } = {}): RowPair => ({
    group: 'pair',
    newAdopter: { id: 'n', teamOwned: over.mineNew ?? false },
    existingAdopter: { id: 'e', teamOwned: over.mineExisting ?? true },
    actionByKeep: { new: 'merge', existing: 'request' },
    request: null,
    ...over,
});

describe('movesToOtherList (D25: when to confirm)', () => {
    it("keeping the other rescuer's profile while yours is absorbed: confirm", () => {
        expect(movesToOtherList(pair(), 'new')).toBe(true);
    });
    it("keeping a teammate's profile: nothing moves to another rescuer, no confirm", () => {
        expect(movesToOtherList(pair({ mineNew: true, actionByKeep: { new: 'merge', existing: 'merge' } }), 'new')).toBe(false);
    });
    it("absorbing the other rescuer's profile (merge, e.g. an admin): no confirm", () => {
        expect(movesToOtherList(pair({ actionByKeep: { new: 'merge', existing: 'merge' } }), 'existing')).toBe(false);
    });
    it('a request moves nothing yet: no confirm', () => {
        expect(movesToOtherList(pair({ actionByKeep: { new: 'request', existing: 'request' } }), 'new')).toBe(false);
    });
});

describe('combineTheirsSide (D43)', () => {
    const declined = (direction: 'sent' | 'received', actionByKeep: RowPair['actionByKeep']) =>
        pair({ group: 'declined', request: { direction, keepId: 'e' }, actionByKeep });
    it("the requester may keep the asked owner's side when the feed allows merging it", () => {
        expect(combineTheirsSide(declined('sent', { new: 'merge', existing: null }))).toBe('new');
    });
    it("D49: a rescuer's keep-theirs after a rejection is a dispute, and the row still offers it", () => {
        expect(combineTheirsSide(declined('sent', { new: 'dispute', existing: null }))).toBe('new');
    });
    it('a keep that would ask the owner again is not offered', () => {
        expect(combineTheirsSide(declined('sent', { new: 'request', existing: null }))).toBeNull();
    });
    it('not on a rebuilt pair (nothing allowed), nor for the side that declined', () => {
        expect(combineTheirsSide(declined('sent', { new: null, existing: null }))).toBeNull();
        expect(combineTheirsSide(declined('received', { new: 'merge', existing: null }))).toBeNull();
    });
    it('only on declined rows', () => {
        expect(combineTheirsSide(pair({ request: { direction: 'sent', keepId: 'e' } }))).toBeNull();
    });
});

describe('needsViewer — the next move is the viewer\'s (Jon 2026-11-09)', () => {
    it('a possible duplicate, and a request asking the viewer or their team: yes', () => {
        expect(needsViewer(pair())).toBe(true);
        expect(needsViewer(pair({ group: 'received', request: { direction: 'received', keepId: 'e' } }))).toBe(true);
    });

    it('a request the viewer sent, waiting on the other side: no («Cancelar» / «Escribir» are cleanup)', () => {
        expect(needsViewer(pair({ group: 'sent', request: { direction: 'sent', keepId: 'n' } }))).toBe(false);
    });

    it('declined by the viewer (or their team): no — already decided; «Aceptar ahora» stays on the row', () => {
        expect(needsViewer(pair({ group: 'declined', request: { direction: 'received', keepId: 'e' } }))).toBe(false);
    });

    it('declined, seen by the requester: yes while «Unir conservando el de …» / «Pedir revisión» is offered', () => {
        expect(needsViewer(pair({ group: 'declined', request: { direction: 'sent', keepId: 'n' }, actionByKeep: { new: 'merge', existing: 'dispute' } }))).toBe(true);
    });

    it('declined, seen by the requester with only «Quitar de la lista» left (e.g. a pair rebuilt from the request): no', () => {
        expect(needsViewer(pair({ group: 'declined', request: { direction: 'sent', keepId: 'n' }, actionByKeep: { new: null, existing: null } }))).toBe(false);
    });
});

describe('deferredToEvaluation (Q6)', () => {
    const inEvaluation = new Set(['n']);
    it('a plain possible duplicate with a side in evaluation → true; with neither → false', () => {
        expect(deferredToEvaluation({ group: 'pair', adopter1Id: 'n', adopter2Id: 'e' }, inEvaluation)).toBe(true);
        expect(deferredToEvaluation({ group: 'pair', adopter1Id: 'x', adopter2Id: 'n' }, inEvaluation)).toBe(true);
        expect(deferredToEvaluation({ group: 'pair', adopter1Id: 'x', adopter2Id: 'e' }, inEvaluation)).toBe(false);
    });
    it('a request (received, sent, declined) is its own move: never deferred', () => {
        for (const group of ['received', 'sent', 'declined'] as const) {
            expect(deferredToEvaluation({ group, adopter1Id: 'n', adopter2Id: 'e' }, inEvaluation)).toBe(false);
        }
    });
});
