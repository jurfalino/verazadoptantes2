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

    it('takes the longest plain stretch of the path as the needle', () => {
        expect(postKey('https://www.facebook.com/somepage/about')?.needle).toBe('somepage');
    });

    it('uses the identifying parameter as the needle when there is one', () => {
        expect(postKey('https://www.facebook.com/profile.php?id=100045&sk=photos')?.needle).toBe('100045');
    });

    // Final review of 2.56.215, item 1: identifying parameters on Meta hosts.
    it('keeps the parameters that identify a Facebook page apart', () => {
        const apart: Array<[string, string]> = [
            ['https://m.facebook.com/groups/123/?view=permalink&id=999', 'https://m.facebook.com/groups/123/?view=permalink&id=888'],
            ['https://m.facebook.com/groups/123/?view=permalink&id=999', 'https://www.facebook.com/groups/123/'],
            ['https://www.facebook.com/video.php?v=11', 'https://www.facebook.com/video.php?v=22'],
            ['https://www.facebook.com/page/photos/?tab=album&album_id=1', 'https://www.facebook.com/page/photos/?tab=album&album_id=2'],
            ['https://www.facebook.com/search/top?q=juan', 'https://www.facebook.com/search/top?q=ana'],
            ['https://www.facebook.com/events/66?event_time_id=1', 'https://www.facebook.com/events/66?event_time_id=2'],
            ['https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fa.com', 'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fb.com'],
        ];
        for (const [a, b] of apart) expect(samePost(a, b), `${a} vs ${b}`).toBe(false);
    });

    it('reads a login wall as the page it guards', () => {
        expect(samePost('https://www.instagram.com/accounts/login/?next=/p/AAA/', 'https://www.instagram.com/p/AAA/')).toBe(true);
        expect(samePost('https://www.instagram.com/accounts/login/?next=/p/AAA/', 'https://www.instagram.com/accounts/login/?next=/p/BBB/')).toBe(false);
        expect(samePost('https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fgroups%2F1%2Fposts%2F2%2F', 'https://www.facebook.com/groups/1/posts/2/')).toBe(true);
    });

    // Item 4: a page called "constructor" must not crash the lookup.
    it('does not throw on page names that are object built-ins', () => {
        expect(() => postKey('https://www.facebook.com/constructor?x=1')).not.toThrow();
        expect(() => postKey('https://www.instagram.com/toString/?hl=es')).not.toThrow();
        expect(() => postKey('https://www.facebook.com/__proto__?a=1')).not.toThrow();
    });

    // Item 2: the needle must be in every stored form, wrappers included.
    it('picks a needle found inside a stored redirect wrapper', () => {
        const target = 'https://example.com/nota/9';
        const stored = 'https://l.facebook.com/l.php?u=' + encodeURIComponent(target);
        expect(stored.includes(postKey(target)!.needle)).toBe(true);
        expect(stored.includes(postKey(stored)!.needle)).toBe(true);
    });

    // Review of 2.56.216.
    it('unwraps the mobile login.php and checkpoint walls', () => {
        const wall = (n: string) => 'https://m.facebook.com/login.php?next=' + encodeURIComponent(`https://m.facebook.com/groups/1/posts/${n}/`);
        expect(samePost(wall('456'), wall('789'))).toBe(false);
        expect(samePost(wall('456'), 'https://www.facebook.com/groups/1/posts/456/')).toBe(true);
        expect(samePost('https://www.facebook.com/checkpoint/?next=' + encodeURIComponent('https://www.facebook.com/groups/1/posts/456/'), 'https://www.facebook.com/groups/1/posts/456/')).toBe(true);
    });

    it('keys older video links by their numeric id', () => {
        expect(samePost('https://www.facebook.com/page/videos/vb.555/999/', 'https://www.facebook.com/page/videos/vb.555/998/')).toBe(false);
        expect(samePost('https://www.facebook.com/page/videos/rescate-gatito/999/', 'https://www.facebook.com/watch/?v=999')).toBe(true);
        expect(samePost('https://www.facebook.com/video.php?v=999', 'https://www.facebook.com/watch/?v=999')).toBe(true);
    });

    it('maps alternative forms to the same post, photo and profile', () => {
        expect(samePost('https://m.facebook.com/groups/123?view=permalink&id=456', 'https://www.facebook.com/groups/123/posts/456/')).toBe(true);
        expect(samePost('https://www.facebook.com/page/photos/777/', 'https://www.facebook.com/photo/?fbid=777')).toBe(true);
        expect(samePost('https://www.facebook.com/people/Juan-Perez/100045/', 'https://www.facebook.com/profile.php?id=100045')).toBe(true);
    });

    it('ignores letter case in profile and page names, not in post codes', () => {
        expect(samePost('https://www.facebook.com/Juan.Perez.123', 'https://www.facebook.com/juan.perez.123')).toBe(true);
        expect(samePost('https://www.instagram.com/SomeUser/', 'https://instagram.com/someuser')).toBe(true);
        expect(samePost('https://www.instagram.com/p/AbC/', 'https://www.instagram.com/p/abc/')).toBe(false);
    });

    it('treats locale and touch mirrors and fb.com as facebook.com', () => {
        expect(samePost('https://es-la.facebook.com/somepage', 'https://www.facebook.com/somepage')).toBe(true);
        expect(samePost('https://touch.facebook.com/somepage', 'https://fb.com/somepage')).toBe(true);
    });

    it('keeps fb.watch codes case-sensitive', () => {
        expect(samePost('https://fb.watch/AbCdEf/', 'https://fb.watch/abcdef/')).toBe(false);
    });
});
