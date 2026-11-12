import { describe, it, expect } from 'vitest';
import { shownInCountrySearch, normalizedTeam } from './searchCountry';

const team = ['me@example.com', 'Mate@Example.com '];

describe('shownInCountrySearch', () => {
    it('shows a profile of the viewer\'s current country', () => {
        expect(shownInCountrySearch({ country: 'AR', addedBy: 'stranger@example.com' }, 'AR', team)).toBe(true);
    });
    it('hides another country\'s profile loaded by someone outside the group', () => {
        expect(shownInCountrySearch({ country: 'CL', addedBy: 'stranger@example.com' }, 'AR', team)).toBe(false);
    });
    it('always shows the viewer\'s own profile, from any country', () => {
        expect(shownInCountrySearch({ country: 'CL', addedBy: 'me@example.com' }, 'AR', team)).toBe(true);
    });
    it('always shows a group-mate\'s profile, from any country, whatever the email case', () => {
        expect(shownInCountrySearch({ country: 'CL', addedBy: 'MATE@example.com' }, 'AR', team)).toBe(true);
    });
    it('hides a profile with no country and no group creator', () => {
        expect(shownInCountrySearch({ country: null, addedBy: null }, 'AR', team)).toBe(false);
    });
    it('filters nothing when the viewer has no country', () => {
        expect(shownInCountrySearch({ country: 'CL', addedBy: 'stranger@example.com' }, null, team)).toBe(true);
    });
});

describe('normalizedTeam', () => {
    it('trims, lowercases, dedupes and drops blanks', () => {
        expect(normalizedTeam([' A@x.com', 'a@x.com', '', 'B@x.com'])).toEqual(['a@x.com', 'b@x.com']);
    });
});
