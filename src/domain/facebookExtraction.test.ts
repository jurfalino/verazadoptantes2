import { describe, it, expect } from 'vitest';
import { dedupeImages, hasExtractableContent, hasPostText, imageIdentity, isPlaceholderAssetUrl, isSourceNotPublic, isVideoPost, realImages } from './facebookExtraction';

// The lookaside stub Facebook serves to crawlers in place of a login-walled
// post's real photo. Fetching it returns text/html, not an image.
const CRAWLER_STUB = 'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=2216399499116218';

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

    /**
     * Regression: the login wall for a walled personal-profile post
     * (facebook.com/share/19EN1HpufE/, 2026-09-04) carries og:title (the
     * poster's name), a lookaside CRAWLER STUB as og:image — a text/html
     * endpoint, not a photo — and a fabricated `og:type: video.other`. The stub
     * satisfied `images.length > 0` and the bogus og:type activated the video
     * leniency, so a page that withheld everything sailed through as a success
     * with no text, one broken image, and a manufactured "[Author]" caption.
     */
    describe('login-wall pages must not pass', () => {
        it('does not count the crawler stub as an image', () => {
            expect(hasExtractableContent({ author: 'Zulma Barragan', images: [CRAWLER_STUB] })).toBe(false);
        });

        it('does not grant the og:type video leniency when a crawler stub betrays a wall', () => {
            expect(hasExtractableContent({ author: 'Zulma Barragan', images: [CRAWLER_STUB], isVideo: true })).toBe(false);
        });

        it('still grants the leniency on a rescuer-typed video URL even behind a wall', () => {
            // The URL shape is the rescuer's own input, not the walled HTML's
            // claim — a real reel link stays on the lenient path.
            expect(hasExtractableContent({ author: 'Refugio', images: [CRAWLER_STUB] }, true)).toBe(true);
        });

        it('a real scontent photo alongside the stub still counts', () => {
            expect(hasExtractableContent({ images: [CRAWLER_STUB, 'https://scontent.faep24-1.fna.fbcdn.net/photo1.jpg'] })).toBe(true);
        });
    });
});

describe('isPlaceholderAssetUrl / realImages', () => {
    it('flags the lookaside crawler stub', () => {
        expect(isPlaceholderAssetUrl(CRAWLER_STUB)).toBe(true);
    });

    it('leaves real CDN photos, data URIs and odd values alone', () => {
        expect(isPlaceholderAssetUrl('https://scontent.faep24-1.fna.fbcdn.net/v/t39/738546332_n.jpg?stp=x')).toBe(false);
        expect(isPlaceholderAssetUrl('data:image/png;base64,AAAA')).toBe(false);
        expect(isPlaceholderAssetUrl('')).toBe(false);
    });

    it('realImages strips only the placeholders', () => {
        expect(realImages([CRAWLER_STUB, 'https://scontent.x/1.jpg'])).toEqual(['https://scontent.x/1.jpg']);
        expect(realImages([CRAWLER_STUB])).toEqual([]);
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

describe('imageIdentity / dedupeImages', () => {
    // Both taken from the same post: Facebook re-signs and re-sizes on every
    // render, so one photo arrives as several distinct strings.
    const a = 'https://scontent.faep24-1.fna.fbcdn.net/v/t39.30808-6/738546332_2216399502449551_887_n.jpg?stp=dst-jpg_tt6&cstp=mx589x1280&oh=00_AQLFknQ&oe=6A9F56BD';
    const b = 'https://scontent.faep24-2.fna.fbcdn.net/v/t39.30808-6/738546332_2216399502449551_887_n.jpg?stp=dst-jpg_s600x600&oh=00_ZZZZZZZ&oe=6B001111';

    it('treats the same photo under different signatures as one image', () => {
        expect(imageIdentity(a)).toBe(imageIdentity(b));
        expect(dedupeImages([a, b])).toEqual([a]);
    });

    it('keeps genuinely different photos', () => {
        const c = a.replace('738546332_2216399502449551_887_n.jpg', '999999999_1111111111111111_222_n.jpg');
        expect(dedupeImages([a, c])).toHaveLength(2);
    });

    it('preserves first-seen order', () => {
        const c = a.replace('738546332_2216399502449551_887_n.jpg', '999999999_1111111111111111_222_n.jpg');
        expect(dedupeImages([c, a, b])).toEqual([c, a]);
    });

    // The OCR thumbnail is a data: URI; it has no path to key on and must not
    // collapse into some other image.
    it('gives data URIs their own identity', () => {
        const d1 = 'data:image/jpeg;base64,AAAA';
        const d2 = 'data:image/jpeg;base64,BBBB';
        expect(dedupeImages([d1, d2])).toHaveLength(2);
    });

    it('does not crash on empty or odd values', () => {
        expect(imageIdentity('')).toBe('');
        expect(dedupeImages([])).toEqual([]);
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
