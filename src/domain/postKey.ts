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

/** Parameters that only track the click and never identify the page. */
const TRACKING = /^(utm.*|fbclid|gclid|igsh|igshid|mibextid|rdid|share_url|ref|refsrc|__cft__.*|__tn__|_rdr|hc_ref|sfnsn|wtsid|s|si)$/i;

export function postKey(input: string): PostKey | null {
    const u = parse(input);
    if (!u) return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m|web|mbasic)\./, '');
    const q = u.searchParams;

    // Outbound redirect wrappers (l.facebook.com/l.php?u=…, l.instagram.com/?u=…)
    // stand for the page they point at.
    if (/^l\.(facebook|instagram)\.com$/.test(host) && q.get('u')) return postKey(q.get('u')!);

    const parts = u.pathname.split('/').filter(Boolean);

    if (FB_HOST.test(host)) {
        const at = (seg: string) => {
            const i = parts.indexOf(seg);
            return i >= 0 && parts[i + 1] ? parts[i + 1] : null;
        };
        // Path-identified kinds first: a reel link can carry an unrelated ?fbid=.
        const video = at('videos') ?? at('reel') ?? (parts[0] === 'watch' ? q.get('v') : null);
        if (video) return { key: `fb:video:${video}`, needle: video };
        const story = q.get('story_fbid');
        if (story) return { key: `fb:post:${story}`, needle: story };
        const post = at('posts') ?? at('permalink') ?? q.get('multi_permalinks');
        if (post) return { key: `fb:post:${post}`, needle: post };
        const fbid = q.get('fbid');
        if (fbid) return { key: `fb:photo:${fbid}`, needle: fbid };
        if (parts[0] === 'share' && parts.length >= 2) {
            const code = parts[parts.length - 1];
            return { key: `fb:share:${code}`, needle: code };
        }
    }

    if (IG_HOST.test(host)) {
        const i = parts.findIndex(p => p === 'p' || p === 'reel' || p === 'reels' || p === 'tv');
        if (i >= 0 && parts[i + 1]) return { key: `ig:${parts[i + 1]}`, needle: parts[i + 1] };
    }

    // Anything else (a profile, a page, an article, another site): the link
    // without scheme, www, fragment, trailing slash or tracking parameters. The
    // rest of the query stays — it often IS the identity (?v=, ?set=, ?id=).
    const path = parts.join('/');
    const bare = path ? `${host}/${path}` : host;
    const kept = [...q.entries()]
        .filter(([k]) => !TRACKING.test(k))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    // The needle is the most specific piece every stored form contains.
    const needle = kept ? (kept.split('&')[0].split('=')[1] || path || host) : (parts[parts.length - 1] || host);
    return { key: `url:${bare}${kept ? `?${kept}` : ''}`, needle };
}

/** True when both links point to the same post. */
export function samePost(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    const ka = postKey(a);
    const kb = postKey(b);
    return !!ka && !!kb && ka.key === kb.key;
}
