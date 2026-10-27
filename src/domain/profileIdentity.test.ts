import { describe, it, expect } from 'vitest';
import {
    ageColumns, knownAsNames, parseNameChange, renameEntries, renameUndoPath, undoableRenameId, sameName,
} from './profileIdentity';
import { deserializeContactEntries, contactEntriesToBlob, mergeContactEntries, stripRenameMarks, type ContactEntry } from '@/lib/contactEntries';
import { maskContactEntries, maskAdopterContact, NO_ACCESS_VISIBILITY } from '@/lib/piiAccess';
import { extractTokens } from '@/lib/tokenizer';
import { isMinor } from './households';

const phone: ContactEntry = { id: 'p', type: 'phone', value: '+54 11 4200 0001', addedBy: 'o@x.com' };

describe('renameEntries', () => {
    it('keeps the old name as a rename alias', () => {
        const { entries, aliasKept } = renameEntries([phone], { from: 'Pedro Paez', to: 'P. Paez', actor: 's@x.com', newId: 'a1' });
        expect(aliasKept).toBe(true);
        expect(entries).toEqual([phone, { id: 'a1', type: 'alias', value: 'Pedro Paez', addedBy: 's@x.com', fromRename: true }]);
    });
    it('no alias for an empty old name or the same name in other case/accents', () => {
        expect(renameEntries([], { from: '', to: 'Lucas', actor: 's', newId: 'a' })).toMatchObject({ aliasKept: false, changed: false });
        expect(renameEntries([], { from: 'José Pérez', to: 'jose perez', actor: 's', newId: 'a' })).toMatchObject({ aliasKept: false, changed: false });
    });
    it('a plain alias with the old name is upgraded to the rename alias (its contributor can no longer erase the old name); an existing rename alias is left as is', () => {
        const plain: ContactEntry = { id: 'x', type: 'alias', value: 'pedro paez', addedBy: 's' };
        expect(renameEntries([plain], { from: 'Pedro Paez', to: 'P. Paez', actor: 'o', newId: 'a' }))
            .toEqual({ entries: [{ ...plain, fromRename: true }], aliasKept: true, changed: true });
        const kept: ContactEntry = { id: 'k', type: 'alias', value: 'Pedro Paez', fromRename: true };
        expect(renameEntries([kept], { from: 'Pedro Paez', to: 'P. Paez', actor: 'o', newId: 'a' })).toEqual({ entries: [kept], aliasKept: true, changed: false });
    });
    it('renaming back to a kept name drops that rename alias (it is the name again), never a plain alias', () => {
        const kept: ContactEntry = { id: 'k', type: 'alias', value: 'Pedro Paez', fromRename: true };
        const plain: ContactEntry = { id: 'x', type: 'alias', value: 'Pedro Paez' };
        expect(renameEntries([kept], { from: 'P. Paez', to: 'Pedro Paez', actor: 'o', newId: 'a' }).entries)
            .toEqual([{ id: 'a', type: 'alias', value: 'P. Paez', addedBy: 'o', fromRename: true }]);
        expect(renameEntries([plain], { from: 'P. Paez', to: 'Pedro Paez', actor: 'o', newId: 'a' }).entries[0]).toBe(plain);
        expect(stripRenameMarks([{ id: 'k', type: 'alias', value: 'X', fromRename: true }])).toEqual([{ id: 'k', type: 'alias', value: 'X' }]);
    });
});

describe('fromRename survives every path an alias takes', () => {
    const stored = JSON.stringify([phone, { id: 'a1', type: 'alias', value: 'Pedro Paez', addedBy: 's@x.com', fromRename: true }]);
    it('deserialize keeps it on aliases only, drops it anywhere else', () => {
        const back = deserializeContactEntries(stored);
        expect(back[1]).toMatchObject({ type: 'alias', fromRename: true });
        expect(deserializeContactEntries(JSON.stringify([{ ...phone, fromRename: true }]))[0]).not.toHaveProperty('fromRename');
        expect(deserializeContactEntries(JSON.stringify(back))).toEqual(back);
    });
    it('masking never masks it and keeps the flag (entries and the whole-profile mask)', () => {
        const { entries } = maskContactEntries(deserializeContactEntries(stored), NO_ACCESS_VISIBILITY);
        expect(entries[0].masked).toBe(true);
        expect(entries[1]).toMatchObject({ value: 'Pedro Paez', fromRename: true });
        const masked = maskAdopterContact({ contactInfo: contactEntriesToBlob(deserializeContactEntries(stored)), contactEntries: stored, addressInfo: null, householdMembers: null }, NO_ACCESS_VISIBILITY);
        expect(deserializeContactEntries(masked.contactEntries)[1]).toMatchObject({ value: 'Pedro Paez', fromRename: true });
    });
    it('merge keeps the first copy with its flag; the blob and the token index carry the old name', () => {
        const merged = mergeContactEntries(deserializeContactEntries(stored), [{ id: 'z', type: 'alias', value: 'pedro paez' }]);
        expect(merged.filter(e => e.type === 'alias')).toEqual([expect.objectContaining({ fromRename: true })]);
        expect(contactEntriesToBlob(merged)).toContain('Pedro Paez');
        const tokens = extractTokens({ name: 'P. Paez' } as never, [], merged as never);
        expect(tokens).toContainEqual({ type: 'name_full', value: 'pedro paez' });
    });
});

describe('knownAsNames / undo bookkeeping', () => {
    const kept = (v: string): ContactEntry => ({ id: v, type: 'alias', value: v, fromRename: true });
    it('lists rename aliases only, never the current name, once each', () => {
        expect(knownAsNames([phone, kept('Pedro Paez'), { id: 'x', type: 'alias', value: 'Peter' }, kept('pedro paez'), kept('P. Paez')], 'P. Paez')).toEqual(['Pedro Paez']);
    });
    it('parseNameChange reads the history row; undoableRenameId offers only the newest rename still in place', () => {
        const rename = { id: 'h1', changedAt: 100, changes: JSON.stringify({ name: { from: 'A', to: 'B' }, name_changed: { from: 'A', to: 'B', aliasKept: true } }) };
        expect(parseNameChange(rename.changes)).toEqual({ from: 'A', to: 'B', aliasKept: true });
        expect(parseNameChange('{"name":{"from":"A","to":"B"}}')).toBeNull();
        expect(undoableRenameId([rename], 'B')).toBe('h1');
        expect(undoableRenameId([rename], 'C')).toBeNull();
        const undo = { id: 'h2', changedAt: 200, changes: { name_changed: { from: 'B', to: 'A', undoOf: 'h1' } } };
        expect(undoableRenameId([undo, rename], 'A')).toBeNull();
        expect(sameName(' A ', 'A')).toBe(true);
    });
    it('renameUndoPath builds the confirmation link from the notice metadata', () => {
        expect(renameUndoPath({ profileId: 'pedro', undo: { historyId: 'h 1' } })).toBe('/adopter/pedro?undoRename=h%201');
        expect(renameUndoPath(JSON.stringify({ adopterId: 'p', undo: { historyId: 'h' } }))).toBe('/adopter/p?undoRename=h');
        expect(renameUndoPath({ profileId: 'p' })).toBeNull();
        expect(renameUndoPath('not json')).toBeNull();
    });
});

describe('ageColumns', () => {
    const today = new Date(Date.UTC(2026, 9, 27, 23, 30));
    it('an age decides the box (auto and locked); no age → the box', () => {
        expect(ageColumns(12, false, today)).toEqual({ age: 12, ageAsOf: '2026-10-27', isMinor: 1 });
        expect(ageColumns(18, true, today)).toEqual({ age: 18, ageAsOf: '2026-10-27', isMinor: 0 });
        expect(ageColumns(null, true, today)).toEqual({ age: null, ageAsOf: null, isMinor: 1 });
    });
    it('a 16-year-old told in 2024 is 18 now: no longer a minor', () => {
        const told = ageColumns(16, true, new Date(Date.UTC(2024, 5, 1)));
        expect(isMinor(told, new Date(Date.UTC(2026, 5, 1)))).toBe(false);
        expect(isMinor(told, new Date(Date.UTC(2026, 4, 31)))).toBe(true);
    });
});
