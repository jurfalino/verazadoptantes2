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

/** Parameters that only track the click and never identify the page (non-Facebook sites). */
const TRACKING = /^(utm.*|fbclid|gclid|igsh|igshid|mibextid|rdid|share_url|ref|refsrc|__cft__.*|__tn__|_rdr|hc_ref|sfnsn|wtsid|s|si)$/i;

/**
 * On Facebook and Instagram nearly every parameter is noise (_rdc, refid, sk,
 * hl, locale, __xts__…), and keeping them split one page into many keys — the
 * same silent duplicate the check exists to stop (re-review of 2.56.214, A).
 * Only these identify a page there.
 */
const META_KEEP: Record<string, string[]> = { 'profile.php': ['id'], 'set': ['set'] };

/** Characters never percent-encoded in a path, plus '/'. */
const UNRESERVED_RUN = /[A-Za-z0-9._~\/-]+/g;

/**
 * The longest stretch of unreserved characters in the DECODED text: such a
 * stretch reads the same in the link as pasted (encoded) and as typed
 * (decoded), so `instr` finds it in either (re-review of 2.56.214, B).
 */
function longestRun(text: string): string {
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch { /* keep as is */ }
    const runs = decoded.match(UNRESERVED_RUN) ?? [];
    return runs.map(r => r.replace(/^\/+|\/+$/g, '')).reduce((best, r) => (r.length > best.length ? r : best), '');
}

export function postKey(input: string): PostKey | null {
    const u = parse(input);
    if (!u) return null;
    // www./m./mobile. mirrors are the same page on any site (as before 2.56.214);
    // web./mbasic. only on Facebook.
    const host = u.hostname.toLowerCase().replace(/^(web|mbasic)\.(?=(facebook|fb)\.)/, '').replace(/^(www|m|mobile)\./, '');
    const q = u.searchParams;
    const parts = u.pathname.split('/').filter(Boolean);
    const isFb = FB_HOST.test(host) || /^l[a-z]?\.facebook\.com$/.test(host);
    const isIg = IG_HOST.test(host);

    // Outbound redirect wrappers (l./lm./www.facebook.com/l.php?u=…,
    // l.instagram.com/?u=…) stand for the page they point at.
    const wrapped = q.get('u');
    if (wrapped && ((isFb && (parts[0] === 'l.php' || /^l[a-z]?\./.test(host))) || host === 'l.instagram.com')) {
        return postKey(wrapped);
    }

    if (isFb) {
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
        // /<page>/photos/<album>/<photo id>/ — the last segment is the photo.
        const photosAt = parts.indexOf('photos');
        const albumPhoto = photosAt >= 0 && parts.length >= photosAt + 3 ? parts[photosAt + 2] : null;
        const fbid = q.get('fbid') ?? albumPhoto;
        if (fbid) return { key: `fb:photo:${fbid}`, needle: fbid };
        if (parts[0] === 'share' && parts.length >= 2) {
            const code = parts[parts.length - 1];
            return { key: `fb:share:${code}`, needle: code };
        }
    }

    if (isIg) {
        const i = parts.findIndex(p => p === 'p' || p === 'reel' || p === 'reels' || p === 'tv');
        if (i >= 0 && parts[i + 1]) return { key: `ig:${parts[i + 1]}`, needle: parts[i + 1] };
    }

    // Anything else (a profile, a page, an article, another site): the link
    // without scheme, www, fragment or trailing slash. On Facebook/Instagram only
    // the identifying parameters stay; elsewhere everything but tracking does
    // (?v=, ?set=, ?id= often ARE the page there).
    const path = parts.map(seg => { try { return decodeURIComponent(seg); } catch { return seg; } }).join('/');
    const bare = path ? `${host}/${path}` : host;
    const metaAllow = isFb || isIg ? (META_KEEP[parts[parts.length - 1] ?? ''] ?? META_KEEP[parts[0] === 'media' ? 'set' : ''] ?? []) : null;
    const kept = [...q.entries()]
        .filter(([k]) => (metaAllow ? metaAllow.includes(k) : !TRACKING.test(k)))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    // The kept parameter is the more specific needle when there is one
    // (profile.php?id=…, watch?v=…); otherwise the whole path.
    const fromQuery = longestRun(kept.split('&').map(kv => kv.split('=')[1] ?? '').join(' '));
    const needle = (fromQuery.length >= 3 ? fromQuery : '') || longestRun(u.pathname) || fromQuery || host;
    return { key: `url:${bare}${kept ? `?${kept}` : ''}`, needle };
}

/** True when both links point to the same post. */
export function samePost(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    const ka = postKey(a);
    const kb = postKey(b);
    return !!ka && !!kb && ka.key === kb.key;
}
