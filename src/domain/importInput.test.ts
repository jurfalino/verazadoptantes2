import { describe, it, expect } from 'vitest';
import { splitLinkAndText, appendContext, canSaveImportedProfile, suggestedRating, monthOf, recordDateFrom, aliasForMerge, cleanOtherPeople, matchedOnName } from './importInput';

describe('splitLinkAndText', () => {
    it('reads a bare link as a link with no extra text', () => {
        expect(splitLinkAndText('https://www.facebook.com/groups/1/posts/2/'))
            .toEqual({ url: 'https://www.facebook.com/groups/1/posts/2/', text: '' });
    });

    // The paste that used to go to the AI as plain text without the post ever
    // being opened (audit 2026-10-21, A4).
    it('pulls the link out of a caption and keeps the rest as text', () => {
        expect(splitLinkAndText('Mirá este post https://facebook.com/share/p/abc quiere adoptar'))
            .toEqual({ url: 'https://facebook.com/share/p/abc', text: 'Mirá este post quiere adoptar' });
    });

    it('drops sentence punctuation stuck to the end of the link', () => {
        expect(splitLinkAndText('Ojo con esta persona (https://instagram.com/p/XyZ).').url)
            .toBe('https://instagram.com/p/XyZ');
    });

    it('keeps query strings that identify the post', () => {
        expect(splitLinkAndText('https://www.facebook.com/permalink.php?story_fbid=1&id=2').url)
            .toBe('https://www.facebook.com/permalink.php?story_fbid=1&id=2');
    });

    it('returns no link for plain text', () => {
        expect(splitLinkAndText('Juan, tel 11 0000 0000, quiere un gato'))
            .toEqual({ url: null, text: 'Juan, tel 11 0000 0000, quiere un gato' });
    });

    // Two links means the rescuer pasted a conversation, not a post to fetch:
    // guessing which one to open would silently drop the other.
    it('returns no link when the text carries more than one', () => {
        expect(splitLinkAndText('https://a.com/x y https://b.com/y').url).toBeNull();
    });

    it('counts the same link twice as one link', () => {
        expect(splitLinkAndText('Ojo https://fb.com/p/1\nhttps://fb.com/p/1'))
            .toEqual({ url: 'https://fb.com/p/1', text: 'Ojo' });
    });

    it('treats empty input as nothing', () => {
        expect(splitLinkAndText('   ')).toEqual({ url: null, text: '' });
    });
});

describe('appendContext', () => {
    it('adds the rescuer\'s own text below the fetched post', () => {
        expect(appendContext('Texto del post', 'Mirá esto')).toBe('Texto del post\n\n---\nMirá esto');
    });

    it('leaves the fetched text alone when there is nothing to add', () => {
        expect(appendContext('Texto del post', '  ')).toBe('Texto del post');
    });

    it('uses the context alone when the post had no text', () => {
        expect(appendContext('', 'Mirá esto')).toBe('Mirá esto');
    });
});


describe('canSaveImportedProfile', () => {
    it('saves with a name', () => {
        expect(canSaveImportedProfile('Juan', [])).toBe(true);
    });

    it('saves a nameless profile that has a phone, email, social handle or ID', () => {
        for (const type of ['phone', 'email', 'social', 'id']) {
            expect(canSaveImportedProfile('', [{ type, value: 'x' }])).toBe(true);
        }
    });

    it('does not save a nameless profile with only an address or a note', () => {
        expect(canSaveImportedProfile('  ', [{ type: 'address', value: 'Calle 1' }, { type: 'other', value: 'algo' }])).toBe(false);
    });

    it('ignores blank identifiers', () => {
        expect(canSaveImportedProfile('', [{ type: 'phone', value: '  ' }])).toBe(false);
    });
});

describe('suggestedRating', () => {
    it('keeps a whole 1–5 rating', () => {
        expect(suggestedRating(1)).toBe(1);
        expect(suggestedRating(5)).toBe(5);
    });

    it('drops anything else instead of inventing one', () => {
        for (const v of [0, 6, 2.5, null, undefined, '1', NaN]) expect(suggestedRating(v)).toBeNull();
    });
});

describe('monthOf / recordDateFrom', () => {
    it('reads the month of a date', () => {
        expect(monthOf('2026-03-14')).toBe('2026-03');
        expect(monthOf('2026-03')).toBe('2026-03');
        expect(monthOf('marzo')).toBe('');
        expect(monthOf('2026-13-01')).toBe('');
    });

    it('keeps a full day, saves a month as its 1st, and no date when empty', () => {
        expect(recordDateFrom('2026-03-14')).toBe('2026-03-14');
        expect(recordDateFrom('2026-03')).toBe('2026-03-01');
        expect(recordDateFrom('')).toBeUndefined();
    });
});

describe('aliasForMerge', () => {
    it('keeps a different name from the post', () => {
        expect(aliasForMerge('Mari G', 'María Gómez')).toBe('Mari G');
    });

    it('skips the same name with other accents, case or spacing', () => {
        expect(aliasForMerge('maria  gomez', 'María Gómez')).toBeNull();
    });

    it('skips when the post had no name', () => {
        expect(aliasForMerge('  ', 'María Gómez')).toBeNull();
    });
});

describe('cleanOtherPeople', () => {
    it('keeps named people with a known relationship and their own contacts', () => {
        expect(cleanOtherPeople([{ name: 'Ana Gómez', relationship: 'partner', phones: ['11 2222'], socialProfiles: [] }], 'Juan Pérez'))
            .toEqual([{ name: 'Ana Gómez', relationship: 'partner', phones: ['11 2222'], socialProfiles: [] }]);
    });

    it('drops the main person, repeats, nameless entries and junk', () => {
        const out = cleanOtherPeople([
            { name: 'juan perez' }, { name: 'Ana' }, { name: 'ANA' }, { name: '' }, null, 'x', { name: 'Leo', relationship: 'boss' },
        ], 'Juan Pérez');
        expect(out.map(p => p.name)).toEqual(['Ana', 'Leo']);
        expect(out[1].relationship).toBe('unknown');
    });

    it('is empty for anything that is not a list', () => {
        expect(cleanOtherPeople(undefined, 'x')).toEqual([]);
        expect(cleanOtherPeople({ name: 'Ana' }, 'x')).toEqual([]);
    });
});

describe('matchedOnName', () => {
    it('is true when a name signal is among the match types', () => {
        expect(matchedOnName(['phone', 'name_word'])).toBe(true);
    });

    it('is false for phone, email or address only', () => {
        expect(matchedOnName(['phone_suffix', 'address_word'])).toBe(false);
        expect(matchedOnName(undefined)).toBe(false);
    });
});
