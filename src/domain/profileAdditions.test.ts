import { describe, it, expect } from 'vitest';
import {
    additionFromParams,
    additionParams,
    deliveryAddressGiven,
    isEmptyAddition,
    mergeAdditions,
    MAX_LISTED_RECORDS,
} from './profileAdditions';

describe('profile additions (one notice per user action)', () => {
    it('merges records in order, adds counts, keeps the address once', () => {
        const a = { records: [{ type: 'adoption', rating: 4 }] };
        const b = { photos: 2, address: true };
        const c = { records: [{ type: 'follow_up' }], photos: 1, videos: 1 };
        expect(mergeAdditions(mergeAdditions(a, b), c)).toEqual({
            records: [{ type: 'adoption', rating: 4 }, { type: 'follow_up' }],
            photos: 3, videos: 1, address: true,
        });
    });

    it('round-trips through template params (strings only, codes not words)', () => {
        const add = { records: [{ type: 'adoption', rating: 4 }, { type: 'observation' }], photos: 3, address: true };
        const p = additionParams(add);
        expect(p).toEqual({ records: 'adoption:4,observation', photos: '3', address: '1' });
        expect(Object.values(p).every(v => typeof v === 'string')).toBe(true);
        expect(additionFromParams(p)).toEqual(add);
    });

    it('drops what it cannot read: unknown shapes, ratings out of 1–5, zero counts', () => {
        expect(additionFromParams({ records: 'adoption:9,bad type,observation:2', photos: 'x', videos: '0' }))
            .toEqual({ records: [{ type: 'adoption' }, { type: 'observation', rating: 2 }] });
        expect(additionParams({ records: [{ type: 'adoption', rating: 0 }], photos: 0 })).toEqual({ records: 'adoption' });
    });

    it('keeps the list bounded (a notice never grows without end)', () => {
        const many = { records: Array.from({ length: MAX_LISTED_RECORDS + 5 }, () => ({ type: 'observation' })) };
        expect(additionFromParams(additionParams(many)).records).toHaveLength(MAX_LISTED_RECORDS);
    });

    it('isEmptyAddition', () => {
        expect(isEmptyAddition({})).toBe(true);
        expect(isEmptyAddition({ photos: 0, records: [] })).toBe(true);
        expect(isEmptyAddition({ address: true })).toBe(false);
    });

    it('a delivery address counts only on a record type that stores one, delivered, with a non-blank address', () => {
        expect(deliveryAddressGiven('adoption', 1, 'Calle 1, Lanús')).toBe(true);
        expect(deliveryAddressGiven('foster', true, 'Calle 1')).toBe(true);
        expect(deliveryAddressGiven('adoption', 0, 'Calle 1')).toBe(false);
        expect(deliveryAddressGiven('adoption', 1, '  ')).toBe(false);
        expect(deliveryAddressGiven('observation', 1, 'Calle 1')).toBe(false);
    });
});
