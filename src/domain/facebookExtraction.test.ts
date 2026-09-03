import { describe, it, expect } from 'vitest';
import { hasExtractableContent, hasPostText, isSourceNotPublic, isVideoPost } from './facebookExtraction';

describe('hasExtractableContent', () => {
    // The regression this module exists for. Facebook answers a non-public post
    // with og:title (the poster's name) and no og:description; the old inline
    // predicate counted that author as content, so the route's "restricted post"
    // guard never fired and the import dead-ended on an empty success.
    it('rejects an author with no text and no images on a regular post', () => {
        expect(hasExtractableContent({ author: 'Zulma Barragan', images: [] })).toBe(false);
    });

    it('accepts text', () => {
        expect(hasExtractableContent({ text: 'Busco hogar para...', images: [] })).toBe(true);
    });

    it('accepts images with no text', () => {
        expect(hasExtractableContent({ images: ['https://x/1.jpg'] })).toBe(true);
    });

    it('rejects a completely empty post', () => {
        expect(hasExtractableContent({ text: '', author: '', images: [] })).toBe(false);
    });

    // Video posts stay lenient — the caption is often empty and the rescuer adds
    // screenshots. Tightening the guard must not regress these.
    it('accepts an author-only post when og:type said video', () => {
        expect(hasExtractableContent({ author: 'Refugio', images: [], isVideo: true })).toBe(true);
    });

    it('accepts an author-only post when the URL is a reel', () => {
        expect(hasExtractableContent({ author: 'Refugio', images: [] }, true)).toBe(true);
    });

    // The two video signals are independent: og:type comes from the same HTML
    // that may be withholding everything, and the URL check only knows the
    // shapes we listed. Either alone must be enough.
    it('accepts a video with no author only when it has real content', () => {
        expect(hasExtractableContent({ images: [] }, true)).toBe(false);
        expect(hasExtractableContent({ text: 'algo', images: [] }, true)).toBe(true);
    });
});

describe('isVideoPost', () => {
    it('is true from either signal alone', () => {
        expect(isVideoPost({ isVideo: true })).toBe(true);
        expect(isVideoPost({}, true)).toBe(true);
    });

    it('is false when neither signal is present', () => {
        expect(isVideoPost({})).toBe(false);
    });
});

describe('hasPostText', () => {
    it('requires the post to have actual words', () => {
        expect(hasPostText({ text: 'Busco hogar' })).toBe(true);
        expect(hasPostText({ text: '' })).toBe(false);
        expect(hasPostText({})).toBe(false);
    });

    it('does not count whitespace as text', () => {
        expect(hasPostText({ text: '   \n  ' })).toBe(false);
    });
});

describe('isSourceNotPublic', () => {
    // Drives the import to a PROTECTED profile: the public-visibility toggle
    // asserts the data was already public, which is false for these.
    it('is true when Facebook named the poster but served no post text', () => {
        expect(isSourceNotPublic({ author: 'Zulma Barragan', images: [] })).toBe(true);
    });

    // The reported case. Facebook served og:image (the link-preview thumbnail is
    // sent for restricted posts too) and og:title, but no caption. Keying this off
    // images made it look like a successful import: a photo, a name, and nothing
    // for the AI to read.
    it('is true when a photo came through but the caption did not', () => {
        expect(isSourceNotPublic({
            author: 'Zulma Barragan',
            images: ['https://scontent.fbcdn.net/v/t39.30808-6/738546332.jpg'],
        })).toBe(true);
    });

    it('is false when the post text was readable', () => {
        expect(isSourceNotPublic({ author: 'Zulma Barragan', text: 'hola', images: [] })).toBe(false);
    });

    // Nothing at all came back — a dead or malformed URL, not evidence about
    // the post's audience.
    it('is false when there is no author either', () => {
        expect(isSourceNotPublic({ images: [] })).toBe(false);
    });

    // A captionless video is also a source we could not read. It still imports
    // (the rescuer adds screenshots) but must not claim a public origin.
    it('is true for a captionless video with a known poster', () => {
        expect(isSourceNotPublic({ author: 'Refugio', images: [], isVideo: true })).toBe(true);
    });
});
