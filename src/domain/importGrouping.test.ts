import { describe, it, expect } from 'vitest';
import { groupSamePerson, groupName, namesAgree, unionValues, phoneDigitsKey, type GroupableRow } from './importGrouping';

const row = (index: number, o: Partial<GroupableRow>): GroupableRow =>
    ({ index, name: '', phones: [], emails: [], socials: [], ids: [], addresses: [], ...o });
const multi = (rows: GroupableRow[]) => groupSamePerson(rows).filter(g => g.indices.length > 1);

describe('groupSamePerson', () => {
    it('joins rows with the same email when the names share a word', () => {
        const g = multi([
            row(0, { name: 'Ana Pérez', emails: ['ana@x.com'], phones: ['11 5555 1234'] }),
            row(1, { name: 'ana perez gomez', emails: ['ANA@x.com '], phones: ['11 4444 0000'] }),
        ]);
        expect(g).toEqual([{ indices: [0, 1], reason: 'email' }]);
    });
    it('joins rows with the same phone written differently', () => {
        const g = multi([
            row(0, { name: 'Juan Gómez', phones: ['+54 9 11 6585-1333'] }),
            row(1, { name: 'Juan', phones: ['011 15 6585-1333'] }),
        ]);
        expect(g).toEqual([{ indices: [0, 1], reason: 'phone' }]);
    });
    it('keeps a household apart: shared phone, no name in common', () => {
        expect(multi([
            row(0, { name: 'Marta Ruiz', phones: ['11 6585 1333'] }),
            row(1, { name: 'Pedro Sosa', phones: ['11 6585 1333'] }),
        ])).toEqual([]);
    });
    it('still joins identical rows (no email or phone needed)', () => {
        expect(multi([
            row(0, { name: 'Luz', addresses: ['Calle 1'] }),
            row(1, { name: 'luz', addresses: ['calle 1'] }),
        ])).toEqual([{ indices: [0, 1], reason: 'identical' }]);
    });
    it('is transitive (email links 0–1, phone links 1–2)', () => {
        const g = multi([
            row(0, { name: 'Sol Díaz', emails: ['sol@x.com'] }),
            row(1, { name: 'Sol Díaz', emails: ['sol@x.com'], phones: ['11 2222 3333'] }),
            row(2, { name: 'Sol', phones: ['1122223333'] }),
        ]);
        expect(g.map(x => x.indices)).toEqual([[0, 1, 2]]);
    });
    it('never joins on a placeholder phone or a name alone', () => {
        expect(multi([
            row(0, { name: 'Ana Ruiz', phones: ['00000000'] }),
            row(1, { name: 'Ana Sosa', phones: ['00000000'] }),
            row(2, { name: 'Ana' }), row(3, { name: 'Ana' }),
        ])).toEqual([]);
    });
    it('returns every row once, ordered by the first row of each group', () => {
        const g = groupSamePerson([row(2, { name: 'Bea Luna', emails: ['b@x.com'] }), row(0, { name: 'Ana' }), row(1, { name: 'bea', emails: ['b@x.com'] })]);
        expect(g.map(x => x.indices)).toEqual([[0], [1, 2]]);
    });
});

describe('unionValues', () => {
    it('keeps every distinct contact once, first spelling wins', () => {
        expect(unionValues([['11-5555-1234', 'a@x.com'], ['1155551234'], ['11 4444 0000']], phoneDigitsKey))
            .toEqual(['11-5555-1234', 'a@x.com', '11 4444 0000']);
        expect(unionValues([['Ana@X.com'], ['ana@x.com', 'b@x.com']])).toEqual(['Ana@X.com', 'b@x.com']);
    });
});

describe('different people are never one person (review 2026-10-14)', () => {
    it('a shared surname is not a shared identity', () => {
        expect(multi([
            row(0, { name: 'María Pérez', phones: ['11 6585 1333'] }),
            row(1, { name: 'Juan Pérez', phones: ['11 6585 1333'] }),
        ])).toEqual([]);
        expect(multi([
            row(0, { name: 'María de los Ángeles Ruiz', emails: ['casa@x.com'] }),
            row(1, { name: 'Juan de los Santos', emails: ['casa@x.com'] }),
        ])).toEqual([]);
    });
    it('the same first name with different surnames stays apart', () => {
        expect(namesAgree('María Gómez', 'María Ruiz')).toBe(false);
        expect(namesAgree('Juan', 'Juan Gómez')).toBe(true);
        expect(namesAgree('Ana Pérez', 'ana perez gomez')).toBe(true);
        expect(namesAgree('María de los Ángeles', 'Juan de los Santos')).toBe(false);
    });
    it('no chain through a junk email shared by many names', () => {
        expect(multi([
            row(0, { name: 'María Gómez', emails: ['no@gmail.com'] }),
            row(1, { name: 'María Ruiz', emails: ['no@gmail.com'] }),
            row(2, { name: 'Lucía Ruiz', emails: ['no@gmail.com'] }),
            row(3, { name: 'Lucía Ruiz', emails: ['no@gmail.com'] }),
            row(4, { name: 'Pedro Sosa', emails: ['no@gmail.com'] }),
            row(5, { name: 'Ana Díaz', emails: ['no@gmail.com'] }),
        ]).map(g => g.indices)).toEqual([[2, 3]]); // only the two IDENTICAL rows (same name and email)
    });
    it('a value that is not an email links nobody', () => {
        expect(multi([row(0, { name: 'Ana Ruiz', emails: ['@'] }), row(1, { name: 'Ana Ruiz', emails: ['@'], phones: ['1'] })])).toEqual([]);
    });
    it('groupName keeps the most complete name', () => {
        expect(groupName(['Juan', 'juan gomez', 'Juan Gómez'])).toBe('Juan Gómez');
        expect(groupName(['', 'Ana'])).toBe('Ana');
    });
});
