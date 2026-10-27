import { describe, it, expect } from 'vitest';
import { activityParts, countActivity } from './activityCounts';

describe('countActivity', () => {
    it('counts each record type, untyped rows as adoptions, fosters and returns included', () => {
        const counts = countActivity([
            { recordType: 'adoption' }, { recordType: null }, { recordType: 'foster' },
            { recordType: 'adoption_request' }, { recordType: 'adoption_request' },
            { recordType: 'observation' }, { recordType: 'follow_up' }, { recordType: 'returned_pet' },
        ]);
        expect(counts).toEqual({ adoption: 2, foster: 1, adoption_request: 2, observation: 1, follow_up: 1, returned_pet: 1 });
    });

    it('an «available» animal is not activity; nothing counted is an empty object', () => {
        expect(countActivity([{ recordType: 'available' }])).toEqual({});
        expect(countActivity([])).toEqual({});
    });
});

describe('activityParts', () => {
    it('lists the kinds in the header order and drops zeros', () => {
        expect(activityParts({ foster: 1, adoption_request: 2, observation: 0, adoption: 1 })).toEqual([
            { kind: 'adoption', n: 1 }, { kind: 'adoption_request', n: 2 }, { kind: 'foster', n: 1 },
        ]);
    });
});
