import { describe, it, expect } from 'vitest';
import { parseHouseholdPeople, childrenAnswer, fullName, MAX_HOUSEHOLD_PEOPLE } from './householdPeople';

describe('parseHouseholdPeople', () => {
    it('keeps valid people, trimming names', () => {
        expect(parseHouseholdPeople([{ relationship: 'child', age: 7, firstName: ' Tomás ', lastName: ' López ' }]))
            .toEqual([{ relationship: 'child', age: 7, firstName: 'Tomás', lastName: 'López' }]);
    });
    it('drops unknown relationships, "unknown", non-integer and out-of-range ages', () => {
        expect(parseHouseholdPeople([
            { relationship: 'boss', age: 30 }, { relationship: 'unknown', age: 30 },
            { relationship: 'child', age: -1 }, { relationship: 'child', age: 121 },
            { relationship: 'child', age: 3.5 }, { relationship: 'child', age: '4' },
            { relationship: 'partner', age: 0 },
        ])).toEqual([{ relationship: 'partner', age: 0 }]);
    });
    it('omits empty names and caps each at 60 chars', () => {
        const [p] = parseHouseholdPeople([{ relationship: 'sibling', age: 20, firstName: '  ', lastName: 'x'.repeat(80) }]);
        expect(p.firstName).toBeUndefined();
        expect(p.lastName).toHaveLength(60);
    });
    it('caps the list at 15 and ignores non-arrays', () => {
        const many = Array.from({ length: 40 }, () => ({ relationship: 'housemate', age: 30 }));
        expect(parseHouseholdPeople(many)).toHaveLength(MAX_HOUSEHOLD_PEOPLE);
        expect(parseHouseholdPeople('nope')).toEqual([]);
        expect(parseHouseholdPeople(null)).toEqual([]);
    });
});

describe('childrenAnswer', () => {
    it('counts people under 18, mapped to the legacy answer', () => {
        expect(childrenAnswer([])).toBe('none');
        expect(childrenAnswer([{ relationship: 'partner', age: 40 }])).toBe('none');
        expect(childrenAnswer([{ relationship: 'child', age: 17 }])).toBe('1');
        expect(childrenAnswer([{ relationship: 'child', age: 2 }, { relationship: 'child', age: 9 }])).toBe('2');
        expect(childrenAnswer([1, 2, 3, 4].map(a => ({ relationship: 'child' as const, age: a })))).toBe('3+');
    });
});

describe('fullName', () => {
    it('needs both names', () => {
        expect(fullName({ relationship: 'child', age: 7, firstName: 'Tomás', lastName: 'López' })).toBe('Tomás López');
        expect(fullName({ relationship: 'child', age: 7, firstName: 'Tomás' })).toBeNull();
        expect(fullName({ relationship: 'child', age: 7 })).toBeNull();
    });
});
