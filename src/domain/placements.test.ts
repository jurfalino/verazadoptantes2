import { describe, it, expect } from 'vitest';
import { deriveEndedPlacement, type PlacementRowLike } from './placements';

const T1 = new Date('2026-01-01T12:00:00Z');
const T2 = new Date('2026-02-01T12:00:00Z');
const ACTOR = 'rescuer@example.com';

function row(overrides: Partial<PlacementRowLike>): PlacementRowLike {
    return {
        id: 'animal-1',
        adopterId: null,
        recordType: 'available',
        animalName: 'Luna',
        species: 'dog',
        date: T1,
        ...overrides,
    };
}

describe('deriveEndedPlacement', () => {
    it('records the foster placement when a fostered animal moves to another foster home', () => {
        const existing = row({ adopterId: 'home-A', recordType: 'foster' });
        const entry = deriveEndedPlacement(existing, { adopterId: 'home-B', recordType: 'foster' }, T2, ACTOR);
        expect(entry).toEqual({
            animalRowId: 'animal-1',
            adopterId: 'home-A',
            recordType: 'foster',
            animalName: 'Luna',
            species: 'dog',
            startedAt: T1,
            endedAt: T2,
            recordedBy: ACTOR,
        });
    });

    it('records the foster placement when a fostered animal is given for adoption', () => {
        const existing = row({ adopterId: 'home-A', recordType: 'foster' });
        const entry = deriveEndedPlacement(existing, { adopterId: 'adopter-C', recordType: 'adoption' }, T2, ACTOR);
        expect(entry?.adopterId).toBe('home-A');
        expect(entry?.recordType).toBe('foster');
    });

    it('returns null for the FIRST placement (available → foster) — nothing ended', () => {
        const existing = row({ adopterId: null, recordType: 'available' });
        expect(deriveEndedPlacement(existing, { adopterId: 'home-A', recordType: 'foster' }, T2, ACTOR)).toBeNull();
    });

    it('returns null when a placement exists but only a non-custody field changed (same holder/type)', () => {
        const existing = row({ adopterId: 'adopter-C', recordType: 'adoption' });
        // rating/address edit — adopterId & recordType unchanged (omitted = unchanged)
        expect(deriveEndedPlacement(existing, {}, T2, ACTOR)).toBeNull();
        expect(deriveEndedPlacement(existing, { adopterId: 'adopter-C', recordType: 'adoption' }, T2, ACTOR)).toBeNull();
    });

    it('returns null when the prior row is not a placement type (e.g. observation)', () => {
        const existing = row({ adopterId: 'adopter-C', recordType: 'observation' });
        expect(deriveEndedPlacement(existing, { adopterId: 'adopter-D', recordType: 'observation' }, T2, ACTOR)).toBeNull();
    });

    it('records when an adoption is re-assigned to a different adopter', () => {
        const existing = row({ adopterId: 'adopter-C', recordType: 'adoption' });
        const entry = deriveEndedPlacement(existing, { adopterId: 'adopter-D', recordType: 'adoption' }, T2, ACTOR);
        expect(entry?.adopterId).toBe('adopter-C');
    });
});
