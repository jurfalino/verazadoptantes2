import { describe, it, expect } from 'vitest';
import { groupSharedIdentifiers } from './sharedIdentifiers';

const names = new Map([['a', 'María Pérez'], ['b', 'María José Pérez'], ['c', 'Laura Gómez']]);

describe('groupSharedIdentifiers', () => {
    it('a phone on two profiles with fitting names is a likely duplicate', () => {
        const g = groupSharedIdentifiers([{ tokenType: 'phone', tokenValue: '5491155550000', adopterIds: ['a', 'b'] }], names);
        expect(g).toEqual([{ field: 'phone', value: '5491155550000', profiles: [{ id: 'a', name: 'María Pérez' }, { id: 'b', name: 'María José Pérez' }], sameName: true, partial: false }]);
    });

    it('a shared family phone (different names) is listed, not called a duplicate', () => {
        const g = groupSharedIdentifiers([{ tokenType: 'phone', tokenValue: '5491155550000', adopterIds: ['a', 'c'] }], names);
        expect(g[0].sameName).toBe(false);
    });

    it('the exact phone and its 8-digit ending naming the same profiles are one group', () => {
        const g = groupSharedIdentifiers([
            { tokenType: 'phone_suffix', tokenValue: '55550000', adopterIds: ['a', 'c'] },
            { tokenType: 'phone', tokenValue: '5491155550000', adopterIds: ['c', 'a'] },
        ], names);
        expect(g).toHaveLength(1);
        expect(g[0].value).toBe('5491155550000');
        expect(g[0].partial).toBe(false);
    });

    it('a match on the last 8 digits only is marked partial', () => {
        const g = groupSharedIdentifiers([{ tokenType: 'phone_suffix', tokenValue: '55550000', adopterIds: ['a', 'c'] }], names);
        expect(g[0]).toMatchObject({ field: 'phone', value: '55550000', partial: true });
    });

    it('deleted / unknown profiles do not count; a single remaining profile is no group', () => {
        expect(groupSharedIdentifiers([{ tokenType: 'email', tokenValue: 'x@y.com', adopterIds: ['a', 'gone'] }], names)).toEqual([]);
    });

    it('other token types are ignored; likely duplicates sort first', () => {
        const g = groupSharedIdentifiers([
            { tokenType: 'name_word', tokenValue: 'maria', adopterIds: ['a', 'b'] },
            { tokenType: 'id_number', tokenValue: '30123456', adopterIds: ['a', 'c'] },
            { tokenType: 'email', tokenValue: 'm@p.com', adopterIds: ['a', 'b'] },
        ], names);
        expect(g.map(x => x.field)).toEqual(['email', 'documentId']);
    });
});
