import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions', () => ({ findAdopters: vi.fn() }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));

import { adultsToOffer } from './MinorRecordsNote';

const line = (id: string, over: Partial<{ isMinor: boolean; isGift: boolean }> = {}) =>
    ({ name: id, profileId: id, rating: null, openAlerts: 0, isMinor: false, isGift: false, householdId: 'h', ...over });

describe('adultsToOffer (audit A3: a minor in the picker offers their household\'s adults)', () => {
    it('keeps the adults of the household, once each', () => {
        expect(adultsToOffer([line('pedro'), line('marta'), line('pedro')]).map(l => l.profileId)).toEqual(['pedro', 'marta']);
    });
    it('never offers another minor or a gift recipient\'s household', () => {
        expect(adultsToOffer([line('hermano', { isMinor: true }), line('regalo', { isGift: true }), line('mama')]).map(l => l.profileId)).toEqual(['mama']);
    });
    it('nothing known → nothing offered', () => {
        expect(adultsToOffer(undefined)).toEqual([]);
        expect(adultsToOffer(null)).toEqual([]);
    });
});
