import { describe, it, expect } from 'vitest';
import { combineTheirsSide, movesToOtherList, type RowPair } from './pendingRowRules';

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
    it('not on a rebuilt pair (nothing allowed), nor for the side that declined', () => {
        expect(combineTheirsSide(declined('sent', { new: null, existing: null }))).toBeNull();
        expect(combineTheirsSide(declined('received', { new: 'merge', existing: null }))).toBeNull();
    });
    it('only on declined rows', () => {
        expect(combineTheirsSide(pair({ request: { direction: 'sent', keepId: 'e' } }))).toBeNull();
    });
});
