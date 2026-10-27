import { describe, it, expect } from 'vitest';
import { canRemoveMembership, currentAge, householdForAdd, householdLineGroups, titledHomes, householdNameKey, isMinor, membershipLabel } from './households';

// Pedro's household: Marta is Pedro's partner, Lucas is Pedro's child. Pedro is
// the person the relationships point at (his own row has none).
const PEDRO = { adopterId: 'pedro', relationship: 'unknown', relativeToAdopterId: null };
const MARTA = { adopterId: 'marta', relationship: 'partner', relativeToAdopterId: 'pedro' };
const LUCAS = { adopterId: 'lucas', relationship: 'child', relativeToAdopterId: 'pedro' };
const NAMES = { pedro: 'Pedro Paez', marta: 'Marta Paez', lucas: 'Lucas Paez' };

describe('membershipLabel', () => {
    it("on Pedro's profile Marta is «pareja» and Lucas «hijo/a»", () => {
        expect(membershipLabel('pedro', MARTA, NAMES, PEDRO)).toEqual({ key: 'adopter.hh_rel_partner', params: {} });
        expect(membershipLabel('pedro', LUCAS, NAMES, PEDRO)).toEqual({ key: 'adopter.hh_rel_child', params: {} });
    });

    it("on Lucas's profile Marta is «pareja de Pedro» and Pedro has no label (no reverse labels)", () => {
        expect(membershipLabel('lucas', MARTA, NAMES, LUCAS)).toEqual({
            key: 'adopter.hh_rel_of', params: { rel: 'adopter.hh_rel_partner', name: 'Pedro Paez' },
        });
        expect(membershipLabel('lucas', PEDRO, NAMES, LUCAS)).toBeNull();
    });

    it("on Marta's profile Pedro is «pareja» (partner is symmetric)", () => {
        expect(membershipLabel('marta', PEDRO, NAMES, MARTA)).toEqual({ key: 'adopter.hh_rel_partner', params: {} });
        // Without the viewed profile's own membership there is nothing to say.
        expect(membershipLabel('marta', PEDRO, NAMES)).toBeNull();
    });

    it('sibling is symmetric too; child, parent and the rest are not reversed', () => {
        const ana = { adopterId: 'ana', relationship: 'sibling', relativeToAdopterId: 'pedro' };
        expect(membershipLabel('ana', PEDRO, NAMES, ana)).toEqual({ key: 'adopter.hh_rel_sibling', params: {} });
        for (const rel of ['child', 'parent', 'other_relative', 'housemate']) {
            expect(membershipLabel('x', PEDRO, NAMES, { adopterId: 'x', relationship: rel, relativeToAdopterId: 'pedro' }), rel).toBeNull();
        }
    });

    it('unknown relationship → no label; a relative who is no longer in the household → no label (never a wrong «pareja»)', () => {
        expect(membershipLabel('pedro', { adopterId: 'z', relationship: 'unknown', relativeToAdopterId: 'pedro' }, NAMES)).toBeNull();
        expect(membershipLabel('lucas', { adopterId: 'z', relationship: 'partner', relativeToAdopterId: 'gone' }, NAMES)).toBeNull();
    });

    it('a relationship that points at nobody stands alone; a garbage relationship is treated as unknown', () => {
        expect(membershipLabel('pedro', { adopterId: 'z', relationship: 'housemate', relativeToAdopterId: null }, NAMES))
            .toEqual({ key: 'adopter.hh_rel_housemate', params: {} });
        expect(membershipLabel('pedro', { adopterId: 'z', relationship: 'enemy', relativeToAdopterId: 'pedro' }, NAMES)).toBeNull();
    });

    it('the viewed profile itself gets no label', () => {
        expect(membershipLabel('marta', MARTA, NAMES, MARTA)).toBeNull();
    });
});

describe('canRemoveMembership', () => {
    // Pedro's own (anchor) row has no adder; Marta was added next to Pedro by ADDER.
    const HOUSEHOLD = [{ adopterId: 'pedro', addedBy: null }, { adopterId: 'marta', addedBy: 'Adder@Example.com' }];
    const m = { addedBy: 'Adder@Example.com', relativeToAdopterId: 'pedro' };
    const viewer = (email: string | null, privileged: string[] = [], isAdmin = false, team: string[] = []) => ({
        email, isAdmin, privilegedOn: (id: string) => privileged.includes(id),
        isOwnTeam: (e: string | null | undefined) => !!e && team.includes(e.toLowerCase()),
    });

    it('the adder may (case-insensitive)', () => {
        expect(canRemoveMembership(viewer('adder@example.com'), m, HOUSEHOLD)).toBe(true);
    });
    it("the team of any profile in the household may (a housemate's team)", () => {
        expect(canRemoveMembership(viewer('team@example.com', ['pedro']), m, HOUSEHOLD)).toBe(true);
    });
    it('an admin or moderator may', () => {
        expect(canRemoveMembership(viewer('admin@example.com', [], true), m, HOUSEHOLD)).toBe(true);
    });
    it('a stranger may not; privileged only on a profile outside the household may not', () => {
        expect(canRemoveMembership(viewer('stranger@example.com'), m, HOUSEHOLD)).toBe(false);
        expect(canRemoveMembership(viewer('stranger@example.com', ['elsewhere']), m, HOUSEHOLD)).toBe(false);
    });
    it('nobody signed in, or a sentinel, never matches a sentinel adder', () => {
        expect(canRemoveMembership(viewer(null), { addedBy: 'anonymous', relativeToAdopterId: 'pedro' }, HOUSEHOLD)).toBe(false);
        expect(canRemoveMembership(viewer('anonymous'), { addedBy: 'anonymous', relativeToAdopterId: 'pedro' }, HOUSEHOLD)).toBe(false);
        expect(canRemoveMembership(viewer(null, ['pedro'], true), m, HOUSEHOLD)).toBe(false);
    });
    it("the adder rule never applies to a profile's own (anchor) row — added next to nobody", () => {
        const anchorRow = { addedBy: 'stranger@example.com', relativeToAdopterId: null };
        expect(canRemoveMembership(viewer('stranger@example.com'), anchorRow, HOUSEHOLD)).toBe(false);
        // Pedro's team still may.
        expect(canRemoveMembership(viewer('team@example.com', ['pedro']), anchorRow, HOUSEHOLD)).toBe(true);
    });
    it('standing is never self-granted: a profile the viewer (or their team) put in the household gives them none', () => {
        // STRANGER linked their own S into Pedro's household, then targets Marta.
        const household = [...HOUSEHOLD, { adopterId: 's', addedBy: 'Stranger@Example.com' }];
        const marta = { addedBy: 'owner@example.com', relativeToAdopterId: 'pedro' };
        expect(canRemoveMembership(viewer('stranger@example.com', ['s']), marta, household)).toBe(false);
        // Same when a teammate of theirs did the linking.
        const viaMate = [...HOUSEHOLD, { adopterId: 's', addedBy: 'mate@example.com' }];
        expect(canRemoveMembership(viewer('stranger@example.com', ['s'], false, ['mate@example.com']), marta, viaMate)).toBe(false);
        // Someone else linking S does give S's team standing.
        const byOther = [...HOUSEHOLD, { adopterId: 's', addedBy: 'owner@example.com' }];
        expect(canRemoveMembership(viewer('stranger@example.com', ['s']), marta, byOther)).toBe(true);
    });
});

describe('currentAge / isMinor', () => {
    const today = new Date('2026-10-27T12:00:00Z');

    it('the age goes up by itself from the day it was given', () => {
        expect(currentAge({ age: 12, ageAsOf: '2020-10-27' }, today)).toBe(18);
        expect(currentAge({ age: 12, ageAsOf: '2020-10-28' }, today)).toBe(17);
        expect(currentAge({ age: 30, ageAsOf: null }, today)).toBe(30);
        expect(currentAge({ age: null, ageAsOf: '2020-01-01' }, today)).toBeNull();
    });

    it('age 12 → minor', () => {
        expect(isMinor({ age: 12, ageAsOf: '2026-10-27', isMinor: 1 }, today)).toBe(true);
        expect(isMinor({ age: 12, ageAsOf: '2026-10-27', isMinor: 0 }, today)).toBe(true);
    });

    it('at 18 by age + time the tag drops, even though the box was ticked when the age was entered', () => {
        expect(isMinor({ age: 12, ageAsOf: '2020-10-27', isMinor: 1 }, today)).toBe(false);
        // One day before the 18th birthday: still a minor.
        expect(isMinor({ age: 12, ageAsOf: '2020-10-28', isMinor: 1 }, today)).toBe(true);
    });

    it('no age: the checkbox decides', () => {
        expect(isMinor({ age: null, ageAsOf: null, isMinor: 1 }, today)).toBe(true);
        expect(isMinor({ age: null, ageAsOf: null, isMinor: true }, today)).toBe(true);
        expect(isMinor({ age: null, ageAsOf: null, isMinor: 0 }, today)).toBe(false);
        expect(isMinor({ age: undefined, ageAsOf: undefined, isMinor: null }, today)).toBe(false);
    });

    it('a malformed age_as_of never fails open: the current age is unknown and the checkbox decides', () => {
        expect(currentAge({ age: 12, ageAsOf: '27/10/2026' }, today)).toBeNull();
        expect(isMinor({ age: 12, ageAsOf: '27/10/2026', isMinor: 1 }, today)).toBe(true);
        expect(isMinor({ age: 12, ageAsOf: '27/10/2026', isMinor: 0 }, today)).toBe(false);
        expect(isMinor({ age: 12, ageAsOf: 'garbage', isMinor: 1 }, today)).toBe(true);
    });

    it('an adult age is not a minor', () => {
        expect(isMinor({ age: 40, ageAsOf: '2026-01-01', isMinor: 0 }, today)).toBe(false);
    });
});

describe('householdNameKey', () => {
    it('ignores case, accents and spacing; keeps different names apart', () => {
        expect(householdNameKey('  laura   PÁEZ ')).toBe(householdNameKey('Laura Paez'));
        expect(householdNameKey('Laura Paez')).not.toBe(householdNameKey('Laura Pérez'));
        expect(householdNameKey(null)).toBe('');
    });
});

describe('householdLineGroups (the card line: «Convive con» / «En otro hogar, con»)', () => {
    const line = (profileId: string, householdId: string, isGift = false) =>
        ({ name: profileId, profileId, rating: null, openAlerts: 0, isMinor: false, isGift, householdId });
    it('groups by home in order and leaves gift-only lines out', () => {
        expect(householdLineGroups([line('pedro', 'h1'), line('ana', 'h2'), line('marta', 'h1'), line('rosa', 'g1', true)]))
            .toEqual([[line('pedro', 'h1'), line('marta', 'h1')], [line('ana', 'h2')]]);
    });
    it('nothing → no groups', () => {
        expect(householdLineGroups(undefined)).toEqual([]);
        expect(householdLineGroups([line('rosa', 'g1', true)])).toEqual([]);
    });
});

describe('household add target and titles (Task 8, coordinator ruling)', () => {
    const home = (id: string, isAnchor: boolean) => ({ id, self: { isAnchor } });
    it('a block\'s «Agregar» adds into THAT household, always (explicit id)', () => {
        expect(householdForAdd(home('hh-pedro', true))).toBe('hh-pedro');
        expect(householdForAdd(home('hh-x', false))).toBe('hh-x');
    });
    it('a profile-level add (no household of any kind) names none: the server starts the profile\'s own home', () => {
        expect(householdForAdd(null)).toBeUndefined();
    });
    it('blocks are titled for 2+ homes, and for a single home the profile does not anchor (so the user sees whose home it is)', () => {
        expect(titledHomes([home('a', true)])).toBe(false);
        expect(titledHomes([])).toBe(false);
        expect(titledHomes([home('x', false)])).toBe(true);
        expect(titledHomes([home('a', true), home('b', false)])).toBe(true);
    });
});
