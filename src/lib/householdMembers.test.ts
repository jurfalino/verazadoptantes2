import { describe, it, expect } from 'vitest';
import {
    deserializeHouseholdMembers,
    serializeHouseholdMembers,
    parseLegacyFamilyText,
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

describe('parseLegacyFamilyText (manual "Convertir")', () => {
    it('splits lines/commas/semicolons into name-only members, deduped', () => {
        const out = parseLegacyFamilyText('María Gómez\nJuan Pérez, María Gómez; Pedro');
        expect(out.map(m => m.name)).toEqual(['María Gómez', 'Juan Pérez', 'Pedro']);
        expect(out.every(m => m.relationship === null && m.contactEntries.length === 0)).toBe(true);
    });
    it('returns [] for empty / whitespace', () => {
        expect(parseLegacyFamilyText('')).toEqual([]);
        expect(parseLegacyFamilyText('   ')).toEqual([]);
    });
    it('ignores 1-char fragments', () => {
        expect(parseLegacyFamilyText('a, Bob').map(m => m.name)).toEqual(['Bob']);
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
