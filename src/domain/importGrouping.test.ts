import { describe, it, expect } from 'vitest';
import { groupSamePerson, groupName, namesAgree, unionValues, phoneDigitsKey, documentIdKey, type GroupableRow } from './importGrouping';

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
    it('still joins identical rows that have no name', () => {
        expect(multi([
            row(0, { name: '', phones: ['11 6585 1333'] }),
            row(1, { name: ' ', phones: ['11 6585 1333'] }),
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

describe('a document Id joins rows exactly like a phone (Jon 2026-11-02)', () => {
    it('same document Id written differently + agreeing names → one person', () => {
        expect(multi([
            row(0, { name: 'Lucía Fernández', phones: ['+54 9 11 3000-1111'], ids: ['35.111.222'] }),
            row(1, { name: 'Lucía Fernández Gómez', phones: ['+54 9 11 3000-2222'], ids: ['35111222'] }),
        ])).toEqual([{ indices: [0, 1], reason: 'document' }]);
    });
    it('same document Id + different names stays apart', () => {
        expect(multi([
            row(0, { name: 'Pedro Acosta', ids: ['36.222.333'] }),
            row(1, { name: 'Martín Acosta', ids: ['36222333'] }),
        ])).toEqual([]);
    });
    it('a placeholder or too-short document Id links nobody, even with the same name', () => {
        expect(multi([
            row(0, { name: 'Ana Ruiz', phones: ['11 5555 0001'], ids: ['00.000.000'] }),
            row(1, { name: 'Ana Ruiz', phones: ['11 5555 0002'], ids: ['00000000'] }),
            row(2, { name: 'Bea Luna', phones: ['11 5555 0003'], ids: ['12345678'] }),
            row(3, { name: 'Bea Luna', phones: ['11 5555 0004'], ids: ['12.345.678'] }),
            row(4, { name: 'Caro Paz', phones: ['11 5555 0005'], ids: ['123'] }),
            row(5, { name: 'Caro Paz', phones: ['11 5555 0006'], ids: ['123'] }),
        ])).toEqual([]);
    });
    it('a document Id written by more than 3 different names links nobody', () => {
        const names = ['Ana Ruiz', 'Bea Luna', 'Caro Paz', 'Dora Sol'];
        expect(multi([
            ...names.map((name, i) => row(i, { name, ids: ['30111222'] })),
            row(4, { name: 'Ana Ruiz', phones: ['11 5555 0009'], ids: ['30.111.222'] }),
        ])).toEqual([]);
    });
});

describe('unionValues', () => {
    it('keeps every distinct contact once, first spelling wins', () => {
        expect(unionValues([['11-5555-1234', 'a@x.com'], ['1155551234'], ['11 4444 0000']], phoneDigitsKey))
            .toEqual(['11-5555-1234', 'a@x.com', '11 4444 0000']);
        expect(unionValues([['Ana@X.com'], ['ana@x.com', 'b@x.com']])).toEqual(['Ana@X.com', 'b@x.com']);
        expect(unionValues([['35.111.222'], ['35111222', '36 222 333']], documentIdKey)).toEqual(['35.111.222', '36 222 333']);
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
    it('names agree in any word order, and a one-word name agrees with a longer one', () => {
        expect(namesAgree('Ana Pérez', 'Pérez Ana')).toBe(true);
        expect(namesAgree('María Pérez', 'Juan Pérez')).toBe(false);
        expect(namesAgree('Ana', 'Ana Gómez')).toBe(true);
        expect(multi([
            row(0, { name: 'Ana Pérez', emails: ['a@x.com'] }),
            row(1, { name: 'Pérez Ana', emails: ['a@x.com'] }),
        ]).map(g => g.indices)).toEqual([[0, 1]]);
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
    it('a surname-only row never bridges two household members, and the grouping is the same in any row order', () => {
        const names = ['Ana Gómez', 'Gómez', 'Juan Gómez'];
        const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
        const byName = (order: number[]) => groupSamePerson(order.map((n, i) => row(i, { name: names[n], phones: ['11 6585 1333'] })))
            .map(g => g.indices.map(i => names[order[i]]).sort().join(' + ')).sort();
        for (const order of perms) {
            const got = byName(order);
            expect(got.some(g => g.includes('Ana Gómez') && g.includes('Juan Gómez')), `order ${order.map(n => names[n]).join(', ')}`).toBe(false);
            // «Gómez» could be either of them: it joins neither, whatever the order (as at base).
            expect(got, `order ${order.map(n => names[n]).join(', ')}`).toEqual(['Ana Gómez', 'Gómez', 'Juan Gómez']);
        }
    });
    it('the two orderings from the review: Ana and Juan stay apart', () => {
        const ph = ['11 6585 1333'];
        const a = groupSamePerson([row(0, { name: 'Ana Gómez', phones: ph }), row(1, { name: 'Gómez', phones: ph }), row(2, { name: 'Juan Gómez', phones: ph })]);
        expect(a.some(g => g.indices.includes(0) && g.indices.includes(2))).toBe(false);
        const b = groupSamePerson([row(0, { name: 'Ana Gómez', phones: ph }), row(1, { name: 'Juan Gómez', phones: ph }), row(2, { name: 'Gómez', phones: ph })]);
        expect(b.some(g => g.indices.includes(0) && g.indices.includes(1))).toBe(false);
    });
    it('a bridge across two keys is refused too (email links one pair, phone the other)', () => {
        const g = groupSamePerson([
            row(0, { name: 'Ana Pérez Gómez', emails: ['ana@x.com'] }),
            row(1, { name: 'Ana Pérez', emails: ['ana@x.com'], phones: ['11 6585 1333'] }),
            row(2, { name: 'Ana Pérez Ruiz', phones: ['11 6585 1333'] }),
        ]);
        expect(g.some(x => x.indices.includes(0) && x.indices.includes(2))).toBe(false);
    });
    it('a row refused by one compatible earlier group still joins a later compatible one', () => {
        // «Gómez» joins «Ana Gómez» by email; on the phone it then can't take the Juan rows,
        // but the second «Juan Gómez» must still join the first.
        const ph = ['11 6585 1333'];
        const g = groupSamePerson([
            row(0, { name: 'Ana Gómez', emails: ['ana@x.com'] }), row(1, { name: 'Gómez', emails: ['ana@x.com'], phones: ph }),
            row(2, { name: 'Juan Gómez', phones: ph }), row(3, { name: 'Juan Gómez', phones: ph, emails: ['j@x.com'] }),
        ]);
        expect(g.map(x => x.indices)).toEqual([[0, 1], [2, 3]]);
    });
    it('a surname-only row with one agreeing holder still joins it', () => {
        const ph = ['11 6585 1333'];
        expect(multi([row(0, { name: 'Ana Gómez', phones: ph }), row(1, { name: 'Gómez', phones: ph })]).map(g => g.indices)).toEqual([[0, 1]]);
    });
    it('groupName keeps the most complete name', () => {
        expect(groupName(['Juan', 'juan gomez', 'Juan Gómez'])).toBe('Juan Gómez');
        expect(groupName(['', 'Ana'])).toBe('Ana');
    });
});
