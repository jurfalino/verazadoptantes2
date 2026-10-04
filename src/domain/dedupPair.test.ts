import { describe, it, expect } from 'vitest';
import { decideDedupMerge, isOpenDuplicateFlag, type DedupSide } from './dedupPair';

const ME = 'me@example.com';
const side = (id: string, addedBy: string | null, createdAt: number, teamOwned: boolean, deleted = false): DedupSide =>
    ({ id, addedBy, createdAt, teamOwned, deleted });

const MINE_OLD = side('mine-old', ME, 1_000, true);
const MINE_NEW = side('mine-new', ME, 3_000, true);
const FOREIGN_OLD = side('foreign-old', 'other@example.com', 500, false);
const FOREIGN_NEW = side('foreign-new', 'other@example.com', 2_000, false);
const MATE_NEW = side('mate-new', 'mate@example.com', 2_000, true);

describe('decideDedupMerge', () => {
    it('anonymous: refused', () => {
        expect(decideDedupMerge(null, MINE_OLD, FOREIGN_NEW)).toEqual({ ok: false, reason: 'unauthenticated' });
    });

    it('a rescuer who created neither side: refused', () => {
        expect(decideDedupMerge('stranger@example.com', MINE_OLD, FOREIGN_NEW)).toEqual({ ok: false, reason: 'not_yours' });
    });

    it('both sides hers: allowed, the older survives', () => {
        expect(decideDedupMerge(ME, MINE_NEW, MINE_OLD)).toEqual({ ok: true, primaryId: 'mine-old', secondaryId: 'mine-new' });
    });

    it('her record is newer, the other is foreign: allowed — hers folds into theirs, the foreign one survives', () => {
        expect(decideDedupMerge(ME, MINE_NEW, FOREIGN_OLD)).toEqual({ ok: true, primaryId: 'foreign-old', secondaryId: 'mine-new' });
    });

    it('her record is older, the other is foreign: refused — a foreign record is never absorbed into hers', () => {
        expect(decideDedupMerge(ME, MINE_OLD, FOREIGN_NEW)).toEqual({ ok: false, reason: 'other_owner' });
        expect(decideDedupMerge(ME, FOREIGN_NEW, MINE_OLD)).toEqual({ ok: false, reason: 'other_owner' });
    });

    it('backdating her record never gets a foreign record absorbed', () => {
        const backdated = side('mine-backdated', ME, 1, true);
        expect(decideDedupMerge(ME, backdated, FOREIGN_OLD)).toEqual({ ok: false, reason: 'other_owner' });
    });

    it('a teammate\'s newer record may be absorbed into hers', () => {
        expect(decideDedupMerge(ME, MINE_OLD, MATE_NEW)).toEqual({ ok: true, primaryId: 'mine-old', secondaryId: 'mate-new' });
    });

    it('a self-filed flag across owners: refused in both age orders', () => {
        expect(decideDedupMerge(ME, MINE_OLD, FOREIGN_NEW, 'flag')).toEqual({ ok: false, reason: 'flag_cross_owner' });
        expect(decideDedupMerge(ME, MINE_NEW, FOREIGN_OLD, 'flag')).toEqual({ ok: false, reason: 'flag_cross_owner' });
    });

    it('a flag inside her team: allowed', () => {
        expect(decideDedupMerge(ME, MINE_OLD, MATE_NEW, 'flag')).toEqual({ ok: true, primaryId: 'mine-old', secondaryId: 'mate-new' });
    });

    it('a deleted or missing side, or the same id twice: not found', () => {
        expect(decideDedupMerge(ME, MINE_OLD, side('x', ME, 2, true, true)).ok).toBe(false);
        expect(decideDedupMerge(ME, MINE_OLD, null).ok).toBe(false);
        expect(decideDedupMerge(ME, MINE_OLD, MINE_OLD).ok).toBe(false);
    });
});

describe('isOpenDuplicateFlag', () => {
    const f = (o: Partial<{ adopterId: string; targetAdopterId: string | null; reason: string | null; details: string | null }>) =>
        ({ adopterId: 'a', targetAdopterId: 'b', reason: 'duplicate', details: null, ...o });
    it('an open duplicate flag', () => expect(isOpenDuplicateFlag(f({}))).toBe(true));
    it('merged (annotated by mergeAdopters)', () => expect(isOpenDuplicateFlag(f({ details: 'Merged into b by x@example.com' }))).toBe(false));
    it('self-pointing after a merge re-pointed it', () => expect(isOpenDuplicateFlag(f({ targetAdopterId: 'a' }))).toBe(false));
    it('no target, or another reason', () => {
        expect(isOpenDuplicateFlag(f({ targetAdopterId: null }))).toBe(false);
        expect(isOpenDuplicateFlag(f({ reason: 'inaccurate_information' }))).toBe(false);
    });
});
