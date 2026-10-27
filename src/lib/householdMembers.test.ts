import { describe, it, expect } from 'vitest';
import {
    deserializeHouseholdMembers,
    serializeHouseholdMembers,
    isMeaningfulMember,
    MAX_MEMBERS,
    type HouseholdMember,
} from './householdMembers';

describe('deserializeHouseholdMembers', () => {
    it('round-trips a member with a name, relationship, and nested contacts', () => {
        const json = JSON.stringify([{
            id: 'hm-1', name: 'María Gómez', relationship: 'parent',
            contactEntries: [
                { type: 'phone', value: '11 2345-6789', apps: ['whatsapp'] },
                { type: 'social', value: 'instagram.com/maria', platform: 'instagram' },
            ],
        }]);
        const [m] = deserializeHouseholdMembers(json);
        expect(m.name).toBe('María Gómez');
        expect(m.relationship).toBe('parent');
        expect(m.contactEntries).toHaveLength(2);
        expect(m.contactEntries[0].type).toBe('phone');
        expect(m.contactEntries[0].id).toBeTruthy(); // entry id assigned by deserializeContactEntries
        expect(m.contactEntries[1].platform).toBe('instagram');
    });

    it('allows a nameless member with only a relationship (decision #1)', () => {
        const [m] = deserializeHouseholdMembers(JSON.stringify([{ name: '', relationship: 'child', contactEntries: [] }]));
        expect(m.name).toBe('');
        expect(m.relationship).toBe('child');
        expect(m.id).toBeTruthy(); // derived id assigned
    });

    it('allows a nameless, relationless member that has a contact', () => {
        const [m] = deserializeHouseholdMembers(JSON.stringify([{ name: '', relationship: null, contactEntries: [{ type: 'phone', value: '1145678901' }] }]));
        expect(m.contactEntries).toHaveLength(1);
    });

    it('drops a fully-empty member', () => {
        expect(deserializeHouseholdMembers(JSON.stringify([{ name: '  ', relationship: null, contactEntries: [] }]))).toEqual([]);
    });

    it('nulls an invalid relationship', () => {
        const [m] = deserializeHouseholdMembers(JSON.stringify([{ name: 'X', relationship: 'roommate-ish' }]));
        expect(m.relationship).toBeNull();
    });

    it('bounds the member count to MAX_MEMBERS', () => {
        const many = Array.from({ length: MAX_MEMBERS + 10 }, (_, i) => ({ name: `P${i}`, relationship: 'housemate' }));
        expect(deserializeHouseholdMembers(JSON.stringify(many))).toHaveLength(MAX_MEMBERS);
    });

    it('returns [] on bad / non-array / null JSON', () => {
        expect(deserializeHouseholdMembers(null)).toEqual([]);
        expect(deserializeHouseholdMembers('not json')).toEqual([]);
        expect(deserializeHouseholdMembers('{"not":"array"}')).toEqual([]);
        expect(deserializeHouseholdMembers('[1, "x", null]')).toEqual([]);
    });

    it('keeps a real member id but derives one deterministically when missing', () => {
        const withId = deserializeHouseholdMembers(JSON.stringify([{ id: 'hm-real', name: 'Ana' }]))[0];
        expect(withId.id).toBe('hm-real');
        const a = deserializeHouseholdMembers(JSON.stringify([{ name: 'Ana', relationship: 'sibling' }]))[0].id;
        const b = deserializeHouseholdMembers(JSON.stringify([{ name: 'Ana', relationship: 'sibling' }]))[0].id;
        expect(a).toBe(b); // deterministic across calls
        expect(a).toMatch(/^hm-[0-9a-f]{8}-[0-9a-f]{8}$/);
    });
});

describe('serializeHouseholdMembers round-trip', () => {
    it('serialize → deserialize preserves members and drops empties', () => {
        const members: HouseholdMember[] = [
            { id: 'hm-1', name: 'Ana', relationship: 'partner', contactEntries: [{ id: 'ce-1', type: 'email', value: 'ana@x.com' }] },
            { id: 'hm-2', name: '', relationship: null, contactEntries: [] }, // empty → dropped
        ];
        const round = deserializeHouseholdMembers(serializeHouseholdMembers(members));
        expect(round).toHaveLength(1);
        expect(round[0].name).toBe('Ana');
        expect(round[0].contactEntries[0].value).toBe('ana@x.com');
    });
    it('empty input serializes to "[]"', () => {
        expect(serializeHouseholdMembers([])).toBe('[]');
        expect(serializeHouseholdMembers(null)).toBe('[]');
    });
});

describe('isMeaningfulMember', () => {
    it('true for name / relationship / contact; false for empty', () => {
        expect(isMeaningfulMember({ name: 'X' })).toBe(true);
        expect(isMeaningfulMember({ relationship: 'child' })).toBe(true);
        expect(isMeaningfulMember({ contactEntries: [{}] })).toBe(true);
        expect(isMeaningfulMember({ name: '  ', relationship: 'nope', contactEntries: [] })).toBe(false);
    });
});

import { currentAge, undoHouseholdMerge } from './householdMembers';

describe('member age', () => {
    it('round-trips age + ageAsOf and drops invalid ones', () => {
        const json = serializeHouseholdMembers([
            { id: 'a', name: 'Tomás López', relationship: 'child', contactEntries: [], age: 7, ageAsOf: '2026-10-04' },
            { id: 'b', name: 'Ana Ruiz', relationship: 'partner', contactEntries: [], age: -3, ageAsOf: 'yesterday' },
        ]);
        const [a, b] = deserializeHouseholdMembers(json);
        expect(a.age).toBe(7); expect(a.ageAsOf).toBe('2026-10-04');
        expect(b.age).toBeUndefined(); expect(b.ageAsOf).toBeUndefined();
    });
    it('currentAge adds whole years since ageAsOf', () => {
        const m = { age: 7, ageAsOf: '2025-10-04' };
        expect(currentAge(m, new Date('2026-10-03'))).toBe(7);
        expect(currentAge(m, new Date('2026-10-04'))).toBe(8);
        expect(currentAge({ age: 7 }, new Date('2030-01-01'))).toBe(7);
        expect(currentAge({}, new Date())).toBeNull();
    });
});

describe('undoHouseholdMerge — an old merge\'s payload (#4, 2026-10-13)', () => {
    const phone = (id: string, value: string) => ({ id, type: 'phone' as const, value });
    // What an old merge left: Laura enriched with the absorbed copy's phone c2 and its gift mark; Ana appended.
    const laura = { id: 's1', name: 'Laura Pérez', relationship: 'child' as const, giftRecipient: true, contactEntries: [phone('c1', '11 4444 0000'), phone('c2', '11 5555 1234')] };
    const ana = { id: 'a2', name: 'Ana Ruiz', relationship: 'partner' as const, contactEntries: [] };
    const added = { memberIds: ['a2'], enriched: [{ memberId: 's1', contactIds: ['c2'], giftRecipient: true }] };

    it('takes back exactly what it added — and keeps a phone a teammate added since', () => {
        const later = [{ ...laura, contactEntries: [...laura.contactEntries, phone('c9', '11 7777 7777')] }, ana];
        const undone = undoHouseholdMerge(later, added);
        expect(undone.map(m => m.id)).toEqual(['s1']);
        expect(undone[0].giftRecipient).toBeUndefined();
        expect(undone[0].contactEntries.map(c => c.id)).toEqual(['c1', 'c9']);
    });
    it('a survivor already marked keeps the mark through undo', () => {
        expect(undoHouseholdMerge([laura], { memberIds: [], enriched: [{ memberId: 's1', contactIds: ['c2'], giftRecipient: false }] })[0].giftRecipient).toBe(true);
    });
});

describe('profileId — a household member with their own profile (D35)', () => {
    const linked: HouseholdMember = { id: 'hm-l', name: 'Lucía Pérez', relationship: 'unknown', contactEntries: [], profileId: 'adopter-2' };
    it('serialize → deserialize keeps the link', () => {
        expect(deserializeHouseholdMembers(serializeHouseholdMembers([linked]))[0].profileId).toBe('adopter-2');
    });
    it('a missing, blank, non-string or oversized profileId is dropped', () => {
        const json = JSON.stringify([
            { id: 'a', name: 'A', profileId: '' }, { id: 'b', name: 'B', profileId: 42 }, { id: 'c', name: 'C', profileId: 'x'.repeat(65) }, { id: 'd', name: 'D' },
        ]);
        expect(deserializeHouseholdMembers(json).map(m => 'profileId' in m)).toEqual([false, false, false, false]);
        expect(serializeHouseholdMembers([{ ...linked, profileId: '  ' }])).not.toContain('profileId');
    });
});
