import { describe, it, expect } from 'vitest';
import { pairKey, decideDedupMerge, decideDedupAction, decideMergeRequestAnswer, canRequestAgain, keepOptions, isOpenDuplicateFlag, KEPT_SEPARATE_FLAG_DETAILS_PREFIX, realOwner, type DedupSide } from './dedupPair';

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
    it('kept separate (a declined merge request)', () => expect(isOpenDuplicateFlag(f({ details: `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}3f2b9c1e-request-id` }))).toBe(false));
    it('self-pointing after a merge re-pointed it', () => expect(isOpenDuplicateFlag(f({ targetAdopterId: 'a' }))).toBe(false));
    it('no target, or another reason', () => {
        expect(isOpenDuplicateFlag(f({ targetAdopterId: null }))).toBe(false);
        expect(isOpenDuplicateFlag(f({ reason: 'inaccurate_information' }))).toBe(false);
    });    it("a profile page's flag rows (optional fields, as AdopterFlagging gets them)", () => {
        expect(isOpenDuplicateFlag({ adopterId: 'a', reason: 'duplicate', targetAdopterId: 'b' })).toBe(true);
        expect(isOpenDuplicateFlag({ adopterId: 'a', reason: 'duplicate', targetAdopterId: 'b', details: 'Merged into b by x@example.com' })).toBe(false);
        expect(isOpenDuplicateFlag({ adopterId: 'a', reason: 'duplicate', targetAdopterId: 'b', details: `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}req-1` })).toBe(false);
        expect(isOpenDuplicateFlag({ adopterId: 'a', reason: 'duplicate' })).toBe(false);
    });
});

describe('realOwner', () => {
    it('a real email is the owner', () => expect(realOwner('owner@example.com')).toBe('owner@example.com'));
    it('null, empty and anonymous have no owner', () => {
        expect(realOwner(null)).toBeNull();
        expect(realOwner(undefined)).toBeNull();
        expect(realOwner('')).toBeNull();
        expect(realOwner('anonymous')).toBeNull();
    });
    it('a system marker without @ (prod has system-demo) has no owner', () => {
        expect(realOwner('system-demo')).toBeNull();
        expect(realOwner('system')).toBeNull();
    });
});

describe('decideDedupAction', () => {
    it('refuses like decideDedupMerge: unauthenticated / not_found / not_yours', () => {
        expect(decideDedupAction(null, MINE_OLD, MINE_NEW, 'detected')).toEqual({ kind: 'refuse', reason: 'unauthenticated' });
        expect(decideDedupAction(ME, MINE_OLD, null as unknown as DedupSide, 'detected')).toEqual({ kind: 'refuse', reason: 'not_found' });
        expect(decideDedupAction('stranger@example.com', MINE_OLD, FOREIGN_NEW, 'detected')).toEqual({ kind: 'refuse', reason: 'not_yours' });
    });

    it('both sides team-owned: merge, older survives, nobody to notify (detected and flag)', () => {
        for (const src of ['detected', 'flag'] as const) {
            expect(decideDedupAction(ME, MINE_NEW, MINE_OLD, src))
                .toEqual({ kind: 'merge', primaryId: 'mine-old', secondaryId: 'mine-new', notifyOwner: null });
        }
    });

    it('flag across rescuers where mine is newer: request, not merge', () => {
        expect(decideDedupAction(ME, MINE_NEW, FOREIGN_OLD, 'flag'))
            .toEqual({ kind: 'request', primaryId: 'foreign-old', secondaryId: 'mine-new', ownerEmail: 'other@example.com' });
    });

    it('flag across rescuers where mine is older: request to the other owner', () => {
        expect(decideDedupAction(ME, MINE_OLD, FOREIGN_NEW, 'flag'))
            .toEqual({ kind: 'request', primaryId: 'mine-old', secondaryId: 'foreign-new', ownerEmail: 'other@example.com' });
    });

    it('detected, mine newer, theirs older: merge and notify their owner', () => {
        expect(decideDedupAction(ME, MINE_NEW, FOREIGN_OLD, 'detected'))
            .toEqual({ kind: 'merge', primaryId: 'foreign-old', secondaryId: 'mine-new', notifyOwner: 'other@example.com' });
    });

    it('detected, mine older: request to their email', () => {
        expect(decideDedupAction(ME, MINE_OLD, FOREIGN_NEW, 'detected'))
            .toEqual({ kind: 'request', primaryId: 'mine-old', secondaryId: 'foreign-new', ownerEmail: 'other@example.com' });
    });

    it('anonymous / empty / null owner normalizes to null', () => {
        for (const who of ['anonymous', '', null]) {
            const theirs = side('t', who, 2_000, false);
            expect(decideDedupAction(ME, MINE_OLD, theirs, 'detected'))
                .toEqual({ kind: 'request', primaryId: 'mine-old', secondaryId: 't', ownerEmail: null });
            const theirsOld = side('t', who, 500, false);
            expect(decideDedupAction(ME, MINE_NEW, theirsOld, 'detected'))
                .toEqual({ kind: 'merge', primaryId: 't', secondaryId: 'mine-new', notifyOwner: null });
        }
    });
});

describe('decideMergeRequestAnswer', () => {
    const base = { actorIsRequester: false, actorOnOwnerTeam: false, actorIsAdmin: false };
    const ok = (nextStatus: string, merges: boolean) => ({ ok: true, nextStatus, merges });
    const no = (reason: string) => ({ ok: false, reason });

    it('requester cancels own pending request', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsRequester: true, decision: 'cancel' })).toEqual(ok('cancelled', false));
    });
    it('admin requester can cancel too; non-requester cannot cancel', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsRequester: true, actorIsAdmin: true, decision: 'cancel' })).toEqual(ok('cancelled', false));
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorOnOwnerTeam: true, decision: 'cancel' })).toEqual(no('not_allowed'));
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsAdmin: true, decision: 'cancel' })).toEqual(no('not_allowed'));
    });
    it('owner team accepts / declines pending', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorOnOwnerTeam: true, decision: 'accept' })).toEqual(ok('accepted', true));
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorOnOwnerTeam: true, decision: 'decline' })).toEqual(ok('declined', false));
    });
    it('requester cannot accept or decline own request (non-admin)', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsRequester: true, actorOnOwnerTeam: true, decision: 'accept' })).toEqual(no('not_allowed'));
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsRequester: true, decision: 'decline' })).toEqual(no('not_allowed'));
    });
    it('a stranger cannot answer', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', decision: 'accept' })).toEqual(no('not_allowed'));
    });
    it('admin approves / declines pending', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsAdmin: true, decision: 'accept' })).toEqual(ok('admin_approved', true));
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsAdmin: true, decision: 'decline' })).toEqual(ok('admin_declined', false));
    });
    it('admin who is the requester approves from pending -> admin_approved', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsAdmin: true, actorIsRequester: true, decision: 'accept' })).toEqual(ok('admin_approved', true));
    });
    it('admin on the owner team acts as owner while pending', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsAdmin: true, actorOnOwnerTeam: true, decision: 'accept' })).toEqual(ok('accepted', true));
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsAdmin: true, actorOnOwnerTeam: true, decision: 'decline' })).toEqual(ok('declined', false));
    });
    it('admin approves after declined; requester and strangers cannot', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'declined', actorIsAdmin: true, decision: 'accept' })).toEqual(ok('admin_approved', true));
        expect(decideMergeRequestAnswer({ ...base, status: 'declined', actorIsRequester: true, decision: 'accept' })).toEqual(no('not_open'));
        expect(decideMergeRequestAnswer({ ...base, status: 'declined', decision: 'accept' })).toEqual(no('not_open'));
        expect(decideMergeRequestAnswer({ ...base, status: 'declined', actorIsAdmin: true, decision: 'decline' })).toEqual(no('not_open'));
    });
    it('the owner team changes its mind: accept from declined merges (D43)', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'declined', actorOnOwnerTeam: true, decision: 'accept' })).toEqual(ok('accepted', true));
        expect(decideMergeRequestAnswer({ ...base, status: 'declined', actorOnOwnerTeam: true, decision: 'decline' })).toEqual(no('not_open'));
        expect(decideMergeRequestAnswer({ ...base, status: 'declined', actorOnOwnerTeam: true, decision: 'flip' })).toEqual(no('not_open'));
        expect(decideMergeRequestAnswer({ ...base, status: 'declined', actorOnOwnerTeam: true, decision: 'cancel' })).toEqual(no('not_open'));
    });
    it('flip («Conservar el mío») by the owner team while pending: accepted, merges swapped (D26)', () => {
        const flipped = { ok: true, nextStatus: 'accepted', merges: true, swap: true };
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorOnOwnerTeam: true, decision: 'flip' })).toEqual(flipped);
    });
    it('an admin flips as admin: admin_approved, merges swapped; an admin on the owner team acts as owner', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsAdmin: true, decision: 'flip' }))
            .toEqual({ ok: true, nextStatus: 'admin_approved', merges: true, swap: true });
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsAdmin: true, actorOnOwnerTeam: true, decision: 'flip' }))
            .toEqual({ ok: true, nextStatus: 'accepted', merges: true, swap: true });
    });
    it('the requester (non-admin) or a stranger cannot flip', () => {
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsRequester: true, decision: 'flip' })).toEqual(no('not_allowed'));
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', actorIsRequester: true, actorOnOwnerTeam: true, decision: 'flip' })).toEqual(no('not_allowed'));
        expect(decideMergeRequestAnswer({ ...base, status: 'pending', decision: 'flip' })).toEqual(no('not_allowed'));
    });
    it('accept and decline never carry swap', () => {
        const r = decideMergeRequestAnswer({ ...base, status: 'pending', actorOnOwnerTeam: true, decision: 'accept' });
        expect(r.ok && r.swap).toBeFalsy();
    });
    it('anything on accepted/cancelled/closed/admin_* is not_open', () => {
        for (const status of ['accepted', 'cancelled', 'closed', 'admin_approved', 'admin_declined'] as const) {
            for (const decision of ['accept', 'decline', 'cancel', 'flip'] as const) {
                expect(decideMergeRequestAnswer({ status, actorIsRequester: true, actorOnOwnerTeam: true, actorIsAdmin: true, decision })).toEqual(no('not_open'));
            }
        }
    });
});

describe('decideDedupAction with a chosen survivor (keepId, D24/D41/D42)', () => {
    const ANON_OLD = side('anon-old', 'anonymous', 500, false);

    it('detected: keeping the other rescuer\'s profile folds mine in and notifies them', () => {
        expect(decideDedupAction(ME, MINE_OLD, FOREIGN_NEW, 'detected', 'foreign-new'))
            .toEqual({ kind: 'merge', primaryId: 'foreign-new', secondaryId: 'mine-old', notifyOwner: 'other@example.com' });
    });

    it('keeping mine against another rescuer\'s: a request to them, whatever the ages', () => {
        expect(decideDedupAction(ME, MINE_NEW, FOREIGN_OLD, 'detected', 'mine-new'))
            .toEqual({ kind: 'request', primaryId: 'mine-new', secondaryId: 'foreign-old', ownerEmail: 'other@example.com' });
        expect(decideDedupAction(ME, MINE_OLD, FOREIGN_NEW, 'detected', 'mine-old'))
            .toEqual({ kind: 'request', primaryId: 'mine-old', secondaryId: 'foreign-new', ownerEmail: 'other@example.com' });
    });

    it('hand-flagged pair, keeping the other\'s profile: immediate merge, owner notified (D41)', () => {
        expect(decideDedupAction(ME, MINE_NEW, FOREIGN_OLD, 'flag', 'foreign-old'))
            .toEqual({ kind: 'merge', primaryId: 'foreign-old', secondaryId: 'mine-new', notifyOwner: 'other@example.com' });
        expect(decideDedupAction(ME, MINE_OLD, FOREIGN_NEW, 'flag', 'mine-old'))
            .toEqual({ kind: 'request', primaryId: 'mine-old', secondaryId: 'foreign-new', ownerEmail: 'other@example.com' });
    });

    it('other side has no real owner: keeping it is refused, keeping mine asks the admins (D42)', () => {
        for (const who of ['anonymous', '', null, 'system-demo']) {
            const ownerless = side('t', who, 500, false);
            expect(decideDedupAction(ME, MINE_NEW, ownerless, 'detected', 't')).toEqual({ kind: 'refuse', reason: 'keep_not_allowed' });
            expect(decideDedupAction(ME, MINE_NEW, ownerless, 'flag', 't')).toEqual({ kind: 'refuse', reason: 'keep_not_allowed' });
            expect(decideDedupAction(ME, MINE_NEW, ownerless, 'detected', 'mine-new'))
                .toEqual({ kind: 'request', primaryId: 'mine-new', secondaryId: 't', ownerEmail: null });
        }
        expect(decideDedupAction(ME, ANON_OLD, MINE_NEW, 'detected', 'anon-old')).toEqual({ kind: 'refuse', reason: 'keep_not_allowed' });
    });

    it('same team: immediate either way, the chosen side survives', () => {
        expect(decideDedupAction(ME, MINE_OLD, MATE_NEW, 'detected', 'mate-new'))
            .toEqual({ kind: 'merge', primaryId: 'mate-new', secondaryId: 'mine-old', notifyOwner: null });
        expect(decideDedupAction(ME, MINE_OLD, MINE_NEW, 'flag', 'mine-new'))
            .toEqual({ kind: 'merge', primaryId: 'mine-new', secondaryId: 'mine-old', notifyOwner: null });
    });

    it('a keepId outside the pair: not found', () => {
        expect(decideDedupAction(ME, MINE_OLD, FOREIGN_NEW, 'detected', 'someone-else')).toEqual({ kind: 'refuse', reason: 'not_found' });
        expect(decideDedupAction(ME, MINE_OLD, FOREIGN_NEW, 'detected', '')).toEqual({ kind: 'refuse', reason: 'not_found' });
    });

    it('the earlier refusals still come first', () => {
        expect(decideDedupAction(null, MINE_OLD, FOREIGN_NEW, 'detected', 'mine-old')).toEqual({ kind: 'refuse', reason: 'unauthenticated' });
        expect(decideDedupAction('stranger@example.com', MINE_OLD, FOREIGN_NEW, 'detected', 'mine-old')).toEqual({ kind: 'refuse', reason: 'not_yours' });
    });
});

describe('keepOptions', () => {
    it('against another rescuer: either side may stay', () => {
        expect(keepOptions(ME, MINE_OLD, FOREIGN_NEW)).toEqual({ a: true, b: true });
    });
    it('against an ownerless profile: only mine (D42)', () => {
        const anon = side('anon', 'anonymous', 500, false);
        expect(keepOptions(ME, MINE_NEW, anon)).toEqual({ a: true, b: false });
        expect(keepOptions(ME, anon, MINE_NEW)).toEqual({ a: false, b: true });
    });
    it('same team: either side', () => {
        expect(keepOptions(ME, MINE_OLD, MATE_NEW)).toEqual({ a: true, b: true });
    });
    it('a pair the viewer may not merge at all: neither', () => {
        expect(keepOptions(null, MINE_OLD, FOREIGN_NEW)).toEqual({ a: false, b: false });
        expect(keepOptions('stranger@example.com', MINE_OLD, FOREIGN_NEW)).toEqual({ a: false, b: false });
        expect(keepOptions(ME, MINE_OLD, null)).toEqual({ a: false, b: false });
    });
});

describe('canRequestAgain (D43)', () => {
    it('no earlier requests: yes', () => expect(canRequestAgain([], ME)).toBe(true));
    it('my own request was declined: no (case-insensitive)', () => {
        expect(canRequestAgain([{ requesterEmail: ME, status: 'declined' }], ME)).toBe(false);
        expect(canRequestAgain([{ requesterEmail: 'Me@Example.com ', status: 'declined' }], ME)).toBe(false);
    });
    it('someone else\'s request was declined: yes', () => {
        expect(canRequestAgain([{ requesterEmail: 'mate@example.com', status: 'declined' }], ME)).toBe(true);
    });
    it('my earlier request ended another way (cancelled / closed / admin_declined): yes', () => {
        expect(canRequestAgain([
            { requesterEmail: ME, status: 'cancelled' },
            { requesterEmail: ME, status: 'closed' },
            { requesterEmail: ME, status: 'admin_declined' },
        ], ME)).toBe(true);
    });
});

describe('pairKey', () => {
    it('is order-independent and joined with |', () => {
        expect(pairKey('b', 'a')).toBe('a|b');
        expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'));
    });
});
