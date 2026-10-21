import { describe, it, expect } from 'vitest';
import { splitLinkAndText, appendContext } from './importInput';

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
