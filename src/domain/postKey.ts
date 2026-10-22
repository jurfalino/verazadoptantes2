/**
 * Which post a link points to — so the same post shared twice is recognised.
 *
 * The import's "already imported" check compared links character for character
 * (audit 2026-10-21, D1). The same Facebook post arrives as `www.` / `m.` /
 * `web.`, with or without tracking parameters, as `/groups/…/posts/<id>` or
 * `/permalink.php?story_fbid=<id>`, and those never matched. A key built from
 * what identifies the post does.
 *
 * `/share/p/<code>` links carry a per-share code, not the post: two shares of
 * one post get two codes. They match only themselves unless the fetcher
 * resolved them to the post's own link first (see the Facebook fetch route).
 *
 * Returns `needle` too: a substring every stored form of the same post
 * contains, for a cheap LIKE pre-filter before comparing keys exactly.
 */

export interface PostKey {
    /** Stable identity, e.g. `fb:post:1234` / `ig:Cxyz` / `url:example.com/a`. */
    key: string;
    /** Substring present in every stored form of this post. */
    needle: string;
}

const FB_HOST = /(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i;
const IG_HOST = /(^|\.)instagram\.com$/i;

function parse(input: string): URL | null {
    try {
        const u = new URL(input.trim());
        return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
    } catch {
        return null;
    }
}

export function postKey(input: string): PostKey | null {
    const u = parse(input);
    if (!u) return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m|web|mbasic|l)\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    const q = u.searchParams;

    if (FB_HOST.test(host)) {
        const story = q.get('story_fbid');
        if (story) return { key: `fb:post:${story}`, needle: story };
        const at = (seg: string) => {
            const i = parts.indexOf(seg);
            return i >= 0 && parts[i + 1] ? parts[i + 1] : null;
        };
        const post = at('posts') ?? at('permalink');
        if (post) return { key: `fb:post:${post}`, needle: post };
        const fbid = q.get('fbid');
        if (fbid) return { key: `fb:photo:${fbid}`, needle: fbid };
        const video = at('videos') ?? at('reel') ?? q.get('v');
        if (video) return { key: `fb:video:${video}`, needle: video };
        if (parts[0] === 'share' && parts.length >= 2) {
            const code = parts[parts.length - 1];
            return { key: `fb:share:${code}`, needle: code };
        }
    }

    if (IG_HOST.test(host)) {
        const i = parts.findIndex(p => p === 'p' || p === 'reel' || p === 'reels' || p === 'tv');
        if (i >= 0 && parts[i + 1]) return { key: `ig:${parts[i + 1]}`, needle: parts[i + 1] };
    }

    // Anything else (a profile, a page, another site): the link without
    // scheme, www, query, fragment or trailing slash.
    const path = parts.join('/');
    const bare = path ? `${host}/${path}` : host;
    // profile.php?id= is a profile, identified by its query — keep it.
    const id = u.pathname.endsWith('profile.php') ? q.get('id') : null;
    return id ? { key: `url:${bare}?id=${id}`, needle: id } : { key: `url:${bare}`, needle: path || host };
}

/** True when both links point to the same post. */
export function samePost(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    const ka = postKey(a);
    const kb = postKey(b);
    return !!ka && !!kb && ka.key === kb.key;
}
