import { describe, it, expect } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { normalizeTeamScope, applicantScopeWhere, generalScopeWhere, teamApplicationsWhere, isInTeamScope, teammateVisibleAnimal } from './applicantScope';

/**
 * Which applicants belong to an animal (2026-09-30, product decision): a
 * `form_submissions` row counts when it targets the animal AND the form link
 * that produced it belongs to the animal owner's TEAM (owner + org-mates).
 *
 * Team-scoping is what keeps a forged `/form?u=<stranger>&animal=<yours>`
 * row off the list: the submit route never checks that `animal` belongs to
 * `u`. So the builder must fail CLOSED on an empty team — drizzle's `or()` of
 * nothing is `undefined`, and `and(x, undefined)` silently drops the clause,
 * which would list every row for the animal.
 */

const dialect = new SQLiteSyncDialect();
const compile = (animalId: string, team: ReadonlyArray<string | null | undefined>) => {
    const where = applicantScopeWhere(animalId, team);
    return where ? dialect.sqlToQuery(where) : null;
};

describe('normalizeTeamScope', () => {
    it('lower-cases, trims, dedupes and drops empties', () => {
        expect(normalizeTeamScope([' Owner@Example.com ', 'owner@example.com', 'MATE@example.com', '', '   ', null, undefined]))
            .toEqual(['owner@example.com', 'mate@example.com']);
    });

    it('is empty for an empty or all-blank team', () => {
        expect(normalizeTeamScope([])).toEqual([]);
        expect(normalizeTeamScope([null, '  ', undefined])).toEqual([]);
    });
});

describe('isInTeamScope', () => {
    const team = normalizeTeamScope(['owner@example.com', 'mate@example.com']);

    it('matches the form-link owner case-insensitively', () => {
        expect(isInTeamScope('Mate@Example.com', team)).toBe(true);
        expect(isInTeamScope(' owner@example.com ', team)).toBe(true);
    });

    it('rejects an outsider and blanks', () => {
        expect(isInTeamScope('stranger@example.com', team)).toBe(false);
        expect(isInTeamScope('', team)).toBe(false);
        expect(isInTeamScope(null, team)).toBe(false);
    });

    it('rejects everything for an empty team (fail closed)', () => {
        expect(isInTeamScope('owner@example.com', [])).toBe(false);
    });
});

describe('applicantScopeWhere', () => {
    it('targets the animal AND one case-insensitive user_id match per team email', () => {
        const q = compile('animal-1', ['Owner@Example.com', 'mate@example.com'])!;
        expect(q).not.toBeNull();
        expect(q.sql).toContain('"applications"."animal_id" = ?');
        const userMatches = q.sql.match(/lower\("form_submissions"\."user_id"\) = \?/g) ?? [];
        expect(userMatches).toHaveLength(2);
        expect(q.sql).toContain(' or ');
        expect(q.params).toEqual(['animal-1', 'owner@example.com', 'mate@example.com', 'replaced']);
    });

    it('never matches a «replaced» application (one scope rule for every caller)', () => {
        const q = compile('animal-1', ['a@example.com'])!;
        expect(q.sql).toContain('"applications"."state" <> ?');
        expect(q.params).toContain('replaced');
    });

    it('never binds an array (D1 binds it as ONE value)', () => {
        const q = compile('animal-1', ['a@example.com', 'b@example.com', 'c@example.com'])!;
        expect(q.params.some(p => Array.isArray(p))).toBe(false);
        expect(q.sql).not.toMatch(/\bin\s*\(/i);
    });

    it('dedupes the team before building the OR', () => {
        const q = compile('animal-1', ['a@example.com', 'A@example.com '])!;
        expect(q.params).toEqual(['animal-1', 'a@example.com', 'replaced']);
    });

    it('fails CLOSED (null, no query) for an empty or all-blank team', () => {
        expect(applicantScopeWhere('animal-1', [])).toBeNull();
        expect(applicantScopeWhere('animal-1', [null, '  ', undefined])).toBeNull();
    });

    it('fails CLOSED for a blank animal id', () => {
        expect(applicantScopeWhere('', ['owner@example.com'])).toBeNull();
    });
});

describe('generalScopeWhere', () => {
    it('matches animal-less applications and one user_id match per team email', () => {
        const q = dialect.sqlToQuery(generalScopeWhere(['Owner@Example.com', 'mate@example.com'])!);
        expect(q.sql).toContain('"applications"."animal_id" is null');
        expect(q.sql.match(/lower\("form_submissions"\."user_id"\) = \?/g)).toHaveLength(2);
        expect(q.params).toEqual(['owner@example.com', 'mate@example.com', 'replaced']);
        expect(q.sql).toContain('"applications"."state" <> ?');
        expect(q.sql).not.toMatch(/\bin\s*\(/i);
    });

    it('fails CLOSED for an empty team', () => {
        expect(generalScopeWhere([])).toBeNull();
        expect(generalScopeWhere([null, ' '])).toBeNull();
    });
});

describe('teamApplicationsWhere', () => {
    const q = (mode: 'animals' | 'any') => dialect.sqlToQuery(teamApplicationsWhere(['Owner@Example.com', 'mate@example.com'], mode)!);
    it("'animals': an animal application needs BOTH the form-link owner AND the animal's owner in the team", () => {
        const c = q('animals');
        expect(c.sql).toContain('"applications"."animal_id" is not null');
        expect(c.sql.match(/lower\("form_submissions"\."user_id"\) = \?/g)).toHaveLength(2);
        expect(c.sql.match(/lower\(trim\("animals"\."added_by"\)\) = \?/g)).toHaveLength(2);
        expect(c.sql).toContain('"applications"."state" <> ?');
        expect(c.sql).not.toMatch(/\bin\s*\(/i);
    });
    it("'any': a general application needs only the link owner; an animal one also the animal's owner", () => {
        const c = q('any');
        expect(c.sql).toContain('"applications"."animal_id" is null');
        expect(c.sql.match(/lower\(trim\("animals"\."added_by"\)\) = \?/g)).toHaveLength(2);
        expect(c.sql.match(/lower\("form_submissions"\."user_id"\) = \?/g)).toHaveLength(2);
    });
    it('fails CLOSED for an empty team', () => {
        expect(teamApplicationsWhere([], 'animals')).toBeNull();
        expect(teamApplicationsWhere([' '], 'any')).toBeNull();
    });
});

describe('teammateVisibleAnimal (form notification fan-out)', () => {
    const team = ['Owner@Example.com', 'mate@example.com'];

    it('keeps the animal when its owner is in the form-link owner\'s team (case-insensitive)', () => {
        expect(teammateVisibleAnimal({ id: 'a1', name: 'Luna', owner: 'MATE@example.com' }, team))
            .toEqual({ id: 'a1', name: 'Luna' });
    });

    it('withholds it for a forged ?animal= row (owner outside the team)', () => {
        expect(teammateVisibleAnimal({ id: 'a1', name: 'Luna', owner: 'stranger@example.com' }, team)).toBeNull();
    });

    it('withholds it when anything is missing or the team is empty (fail closed)', () => {
        expect(teammateVisibleAnimal({ id: 'a1', name: 'Luna', owner: null }, team)).toBeNull();
        expect(teammateVisibleAnimal({ id: null, name: 'Luna', owner: 'mate@example.com' }, team)).toBeNull();
        expect(teammateVisibleAnimal({ id: 'a1', name: null, owner: 'mate@example.com' }, team)).toBeNull();
        expect(teammateVisibleAnimal({ id: 'a1', name: 'Luna', owner: 'mate@example.com' }, [])).toBeNull();
    });
});
