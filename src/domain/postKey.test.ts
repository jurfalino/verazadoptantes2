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

    // Re-review of 2.56.214, item A: on Facebook/Instagram most parameters are
    // noise, and keeping them broke matches that worked before.
    it('ignores non-identifying Facebook and Instagram parameters', () => {
        expect(samePost('https://m.facebook.com/somepage?_rdc=1&_rdr', 'https://www.facebook.com/somepage')).toBe(true);
        expect(samePost('https://www.facebook.com/profile.php?id=100&sk=photos', 'https://www.facebook.com/profile.php?id=100')).toBe(true);
        expect(samePost('https://www.instagram.com/someuser/?hl=es', 'https://instagram.com/someuser')).toBe(true);
        expect(samePost('https://www.facebook.com/somepage?refid=8&__xts__[0]=x&eav=1&paipv=0&locale=es_LA&app=fbl', 'https://www.facebook.com/somepage/')).toBe(true);
    });

    it('keys a photo inside an album by the photo id', () => {
        expect(samePost('https://www.facebook.com/somepage/photos/a.1/2/?type=3', 'https://www.facebook.com/somepage/photos/a.1/2')).toBe(true);
        expect(postKey('https://www.facebook.com/somepage/photos/a.1/2/?type=3')?.key).toBe('fb:photo:2');
    });

    it('unwraps l.php on any Facebook host', () => {
        const target = 'https://example.com/nota/9';
        expect(samePost('https://lm.facebook.com/l.php?u=' + encodeURIComponent(target), target)).toBe(true);
        expect(samePost('https://www.facebook.com/l.php?u=' + encodeURIComponent(target), target)).toBe(true);
    });

    // Item B: the needle must be found in the link however it was stored.
    it('picks a needle found in both the encoded and the decoded link', () => {
        for (const [a, b] of [
            ['https://example.com/b?q=hola%20mundo', 'https://example.com/b?q=hola mundo'],
            ['https://example.com/caf%C3%A9', 'https://example.com/café'],
        ]) {
            const { needle } = postKey(a)!;
            expect(a.includes(needle)).toBe(true);
            expect(b.includes(needle)).toBe(true);
            expect(postKey(b)!.needle).toBe(needle);
        }
    });

    it('prefers the whole path as the needle', () => {
        expect(postKey('https://www.facebook.com/somepage/about')?.needle).toBe('somepage/about');
    });

    it('uses the identifying parameter as the needle when there is one', () => {
        expect(postKey('https://www.facebook.com/profile.php?id=100045&sk=photos')?.needle).toBe('100045');
    });
});
