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
});
