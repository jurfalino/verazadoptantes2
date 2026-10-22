import { describe, it, expect } from 'vitest';
import { postKey, samePost } from './postKey';

describe('postKey', () => {
    it('ignores the Facebook subdomain and tracking parameters', () => {
        expect(samePost(
            'https://www.facebook.com/groups/123/posts/456/',
            'https://m.facebook.com/groups/123/posts/456?mibextid=abc&rdid=x',
        )).toBe(true);
    });

    it('matches a permalink to the same post id', () => {
        expect(samePost(
            'https://www.facebook.com/permalink.php?story_fbid=pfbid0abc&id=99',
            'https://facebook.com/story.php?story_fbid=pfbid0abc&id=99',
        )).toBe(true);
    });

    it('matches a group permalink to the group post link', () => {
        expect(samePost(
            'https://www.facebook.com/groups/123/permalink/456/',
            'https://www.facebook.com/groups/123/posts/456/',
        )).toBe(true);
    });

    // The trap that broke a first attempt at this: stripping the query string
    // made every permalink.php / profile.php link look like the same page.
    it('keeps different permalinks and profiles apart', () => {
        expect(samePost(
            'https://www.facebook.com/permalink.php?story_fbid=1&id=9',
            'https://www.facebook.com/permalink.php?story_fbid=2&id=9',
        )).toBe(false);
        expect(samePost(
            'https://www.facebook.com/profile.php?id=1',
            'https://www.facebook.com/profile.php?id=2',
        )).toBe(false);
    });

    it('keys photos and videos by their own ids', () => {
        expect(postKey('https://www.facebook.com/photo/?fbid=777&set=a.1')?.key).toBe('fb:photo:777');
        expect(postKey('https://www.facebook.com/reel/888')?.key).toBe('fb:video:888');
        expect(postKey('https://www.facebook.com/watch/?v=999')?.key).toBe('fb:video:999');
    });

    it('treats a share code as its own key (it names the share, not the post)', () => {
        expect(postKey('https://www.facebook.com/share/p/1AbCd/')).toEqual({ key: 'fb:share:1AbCd', needle: '1AbCd' });
    });

    it('keys Instagram posts and reels by shortcode', () => {
        expect(samePost('https://www.instagram.com/p/Cxyz/?igsh=1', 'https://instagram.com/p/Cxyz')).toBe(true);
        expect(postKey('https://www.instagram.com/reel/Rabc/')?.key).toBe('ig:Rabc');
    });

    it('falls back to the bare link for anything else', () => {
        expect(samePost('https://example.com/a/?utm=1', 'http://www.example.com/a')).toBe(true);
    });

    it('returns null for something that is not a web link', () => {
        expect(postKey('not a link')).toBeNull();
        expect(postKey('javascript:alert(1)')).toBeNull();
    });

    it('gives a needle every stored form of the post contains', () => {
        const { needle } = postKey('https://m.facebook.com/groups/1/posts/456?x=1')!;
        expect('https://www.facebook.com/groups/1/posts/456/'.includes(needle)).toBe(true);
    });

    // Review of 2.56.213, item 3: the catch-all dropped the whole query string.
    it('keeps a query that identifies the page, drops tracking parameters', () => {
        expect(samePost('https://www.youtube.com/watch?v=AAA', 'https://www.youtube.com/watch?v=BBB')).toBe(false);
        expect(samePost('https://www.youtube.com/watch?v=AAA&utm_source=x', 'https://youtube.com/watch?v=AAA')).toBe(true);
        expect(samePost('https://www.facebook.com/media/set/?set=a.1', 'https://www.facebook.com/media/set/?set=a.2')).toBe(false);
    });

    it('reads a group multi_permalinks link as that post', () => {
        expect(samePost(
            'https://www.facebook.com/groups/123/?multi_permalinks=456&ref=share',
            'https://www.facebook.com/groups/123/posts/456/',
        )).toBe(true);
        expect(samePost('https://www.facebook.com/groups/123/?multi_permalinks=456', 'https://www.facebook.com/groups/123/')).toBe(false);
    });

    it('unwraps Facebook and Instagram outbound redirect links', () => {
        const wrapped = 'https://l.facebook.com/l.php?u=' + encodeURIComponent('https://example.com/nota/1') + '&h=AT0';
        expect(samePost(wrapped, 'https://example.com/nota/1')).toBe(true);
        const igWrapped = 'https://l.instagram.com/?u=' + encodeURIComponent('https://example.com/nota/2');
        expect(samePost(igWrapped, 'https://example.com/nota/2')).toBe(true);
    });

    it('keys a reel by its path even when the link carries an fbid', () => {
        expect(postKey('https://www.facebook.com/reel/888?fbid=1')?.key).toBe('fb:video:888');
    });

    it('reads ?v= as a video only on watch links', () => {
        expect(postKey('https://www.facebook.com/somepage?v=1')?.key).not.toBe('fb:video:1');
    });

    it('treats fb.com share links like facebook.com ones', () => {
        expect(postKey('https://fb.com/share/p/1AbCd/')?.key).toBe('fb:share:1AbCd');
    });
});
