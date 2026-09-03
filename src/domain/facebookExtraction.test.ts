import { describe, it, expect } from 'vitest';
import { hasExtractableContent, isSourceNotPublic, isVideoPost } from './facebookExtraction';

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

describe('isSourceNotPublic', () => {
    // Drives the import to a PROTECTED profile: the public-visibility toggle
    // asserts the data was already public, which is false for these.
    it('is true when Facebook named the poster but served no post', () => {
        expect(isSourceNotPublic({ author: 'Zulma Barragan', images: [] })).toBe(true);
    });

    it('is false when the post was readable', () => {
        expect(isSourceNotPublic({ author: 'Zulma Barragan', text: 'hola', images: [] })).toBe(false);
    });

    // Nothing at all came back — a dead or malformed URL, not evidence about
    // the post's audience.
    it('is false when there is no author either', () => {
        expect(isSourceNotPublic({ images: [] })).toBe(false);
    });

    it('is false for an author-only video, which is a normal readable case', () => {
        expect(isSourceNotPublic({ author: 'Refugio', images: [], isVideo: true })).toBe(false);
    });
});
