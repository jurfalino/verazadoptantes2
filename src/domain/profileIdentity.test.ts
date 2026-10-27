import { describe, it, expect } from 'vitest';
import {
    ageColumns, knownAsNames, profileIdentityView, parseNameChange, renameEntries, renameUndoPath, undoableRenameId, sameName,
} from './profileIdentity';
import { deserializeContactEntries, contactEntriesToBlob, mergeContactEntries, stripRenameMarks, isRenameAlias, contactCapExceeded, MAX_CONTACT_ENTRIES, RENAME_ALIAS_AUTHOR, type ContactEntry } from '@/lib/contactEntries';
import { maskContactEntries, maskAdopterContact, NO_ACCESS_VISIBILITY, isRealActorEmail } from '@/lib/piiAccess';
import { extractTokens } from '@/lib/tokenizer';
import { isMinor } from './households';

const phone: ContactEntry = { id: 'p', type: 'phone', value: '+54 11 4200 0001', addedBy: 'o@x.com' };

describe('renameEntries', () => {
    it('keeps the old name as a rename alias', () => {
        const { entries, aliasKept } = renameEntries([phone], { from: 'Pedro Paez', to: 'P. Paez', actor: 's@x.com', newId: 'a1' });
        expect(aliasKept).toBe(true);
        expect(entries).toEqual([{ id: 'a1', type: 'alias', value: 'Pedro Paez', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true }, phone]);
    });
    it('no alias for an empty old name or the same name in other case/accents', () => {
        expect(renameEntries([], { from: '', to: 'Lucas', actor: 's', newId: 'a' })).toMatchObject({ aliasKept: false, changed: false });
        expect(renameEntries([], { from: 'José Pérez', to: 'jose perez', actor: 's', newId: 'a' })).toMatchObject({ aliasKept: false, changed: false });
    });
    it('a plain alias with the old name is upgraded to the rename alias (its contributor can no longer erase the old name); an existing rename alias is left as is', () => {
        const plain: ContactEntry = { id: 'x', type: 'alias', value: 'pedro paez', addedBy: 's' };
        expect(renameEntries([plain], { from: 'Pedro Paez', to: 'P. Paez', actor: 'o', newId: 'a' }))
            .toEqual({ entries: [{ ...plain, addedBy: RENAME_ALIAS_AUTHOR, fromRename: true }], aliasKept: true, changed: true });
        const kept: ContactEntry = { id: 'k', type: 'alias', value: 'Pedro Paez', fromRename: true };
        expect(renameEntries([kept], { from: 'Pedro Paez', to: 'P. Paez', actor: 'o', newId: 'a' })).toEqual({ entries: [kept], aliasKept: true, changed: false });
    });
    it('renaming back to a kept name drops that rename alias (it is the name again), never a plain alias', () => {
        const kept: ContactEntry = { id: 'k', type: 'alias', value: 'Pedro Paez', fromRename: true };
        const plain: ContactEntry = { id: 'x', type: 'alias', value: 'Pedro Paez' };
        expect(renameEntries([kept], { from: 'P. Paez', to: 'Pedro Paez', actor: 'o', newId: 'a' }).entries)
            .toEqual([{ id: 'a', type: 'alias', value: 'P. Paez', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true }]);
        expect(renameEntries([plain], { from: 'P. Paez', to: 'Pedro Paez', actor: 'o', newId: 'a' }).entries).toContain(plain);
        expect(stripRenameMarks([{ id: 'k', type: 'alias', value: 'X', fromRename: true }])).toEqual([{ id: 'k', type: 'alias', value: 'X' }]);
    });
});

describe('fromRename survives every path an alias takes', () => {
    const stored = JSON.stringify([{ id: 'a1', type: 'alias', value: 'Pedro Paez', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true }, phone]);
    it('deserialize keeps it on aliases only, drops it anywhere else', () => {
        const back = deserializeContactEntries(stored);
        expect(back[0]).toMatchObject({ type: 'alias', fromRename: true });
        expect(deserializeContactEntries(JSON.stringify([{ ...phone, fromRename: true }]))[0]).not.toHaveProperty('fromRename');
        expect(deserializeContactEntries(JSON.stringify(back))).toEqual(back);
    });
    it('masking never masks it and keeps the flag (entries and the whole-profile mask)', () => {
        const { entries } = maskContactEntries(deserializeContactEntries(stored), NO_ACCESS_VISIBILITY);
        expect(entries[1].masked).toBe(true);
        expect(entries[0]).toMatchObject({ value: 'Pedro Paez', fromRename: true });
        const masked = maskAdopterContact({ contactInfo: contactEntriesToBlob(deserializeContactEntries(stored)), contactEntries: stored, addressInfo: null, householdMembers: null }, NO_ACCESS_VISIBILITY);
        expect(deserializeContactEntries(masked.contactEntries)[0]).toMatchObject({ value: 'Pedro Paez', fromRename: true });
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
    it('Task 8: the identity view carries each kept name with every alias id behind it (a junk one can be removed)', () => {
        const v = profileIdentityView({ name: 'P. Paez' }, [phone, kept('Pedro Paez'), { id: 'x', type: 'alias', value: 'Peter' }, kept('pedro paez'), kept('P. Paez')]);
        expect(v.knownAs).toEqual(['Pedro Paez']);
        expect(v.knownAsEntries).toEqual([{ name: 'Pedro Paez', ids: ['Pedro Paez', 'pedro paez'] }]);
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

describe('Final fix S1/S2 — the rename alias never falls off the cap, and an old build cannot strip it', () => {
    const junk = (n: number): ContactEntry[] => Array.from({ length: n }, (_, i) => ({ id: `j${i}`, type: 'alias' as const, value: `Junk ${i}`, addedBy: 's@x.com' }));
    it('renameEntries puts the old name FIRST, credited to the rename sentinel (never the renamer)', () => {
        const { entries } = renameEntries([phone, ...junk(3)], { from: 'Pedro Paez', to: 'P. Paez', actor: 's@x.com', newId: 'a1' });
        expect(entries[0]).toEqual({ id: 'a1', type: 'alias', value: 'Pedro Paez', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true });
        const plain: ContactEntry = { id: 'x', type: 'alias', value: 'Pedro Paez', addedBy: 's@x.com' };
        const up = renameEntries([phone, plain], { from: 'Pedro Paez', to: 'P. Paez', actor: 's@x.com', newId: 'a1' }).entries;
        expect(up[0]).toEqual({ ...plain, addedBy: RENAME_ALIAS_AUTHOR, fromRename: true });
    });
    it('deserialize: rename aliases are exempt from the 50-entry cap and come first; the rest is capped', () => {
        const stored = JSON.stringify([...junk(60), { id: 'r', type: 'alias', value: 'Pedro Paez', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true }]);
        const back = deserializeContactEntries(stored);
        expect(back[0]).toMatchObject({ id: 'r', fromRename: true });
        expect(back.filter(e => !isRenameAlias(e))).toHaveLength(MAX_CONTACT_ENTRIES);
        expect(knownAsNames(back, 'P. Paez')).toEqual(['Pedro Paez']);
    });
    it('an old build dropped `fromRename` but kept the sentinel author: still the rename alias (re-marked on read)', () => {
        const back = deserializeContactEntries(JSON.stringify([phone, { id: 'r', type: 'alias', value: 'Pedro Paez', addedBy: RENAME_ALIAS_AUTHOR }]));
        expect(back[0]).toEqual({ id: 'r', type: 'alias', value: 'Pedro Paez', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true });
        // A rename alias written before the sentinel (credited to the renamer) is re-credited on read.
        const legacy = deserializeContactEntries(JSON.stringify([{ id: 'r', type: 'alias', value: 'Pedro Paez', addedBy: 's@x.com', fromRename: true }]));
        expect(legacy[0]).toMatchObject({ addedBy: RENAME_ALIAS_AUTHOR, fromRename: true });
    });
    it('client JSON can forge neither marker: stripRenameMarks drops the flag AND the sentinel author', () => {
        expect(stripRenameMarks([{ id: 'k', type: 'alias', value: 'X', addedBy: RENAME_ALIAS_AUTHOR }])).toEqual([{ id: 'k', type: 'alias', value: 'X' }]);
        expect(stripRenameMarks([{ id: 'k', type: 'alias', value: 'X', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true }])).toEqual([{ id: 'k', type: 'alias', value: 'X' }]);
    });
    it('the sentinel is never a real actor', () => {
        expect(isRealActorEmail(RENAME_ALIAS_AUTHOR)).toBe(false);
    });
    it('contactCapExceeded counts everything but the rename aliases', () => {
        const r: ContactEntry = { id: 'r', type: 'alias', value: 'Old', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true };
        expect(contactCapExceeded([r, ...junk(MAX_CONTACT_ENTRIES)])).toBe(false);
        expect(contactCapExceeded([r, ...junk(MAX_CONTACT_ENTRIES + 1)])).toBe(true);
    });
});
