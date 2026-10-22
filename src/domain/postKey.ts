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
 * These are the ones that DO identify a page there, wherever they appear
 * (profile.php?id, groups/…?view=permalink&id, video.php?v, media/set?set,
 * photos?album_id, search?q, events?event_time_id, sharer.php?u). Dropping
 * them merged different pages (final review of 2.56.215, item 1).
 */
const META_IDENTIFYING = new Set(['id', 'v', 'set', 'album_id', 'story_fbid', 'fbid', 'q', 'u', 'event_time_id']);

/**
 * Characters never percent-encoded anywhere in a URL. No '/' and no '~': both
 * are encoded inside a wrapped link (l.php?u=https%3A%2F%2F…) or by some
 * clients, and the needle must be found in every stored form (item 2).
 */
const UNRESERVED_RUN = /[A-Za-z0-9._-]+/g;

/**
 * The longest stretch of unreserved characters in the DECODED text: such a
 * stretch reads the same in the link as pasted (encoded) and as typed
 * (decoded), so `instr` finds it in either (re-review of 2.56.214, B).
 */
function longestRun(text: string): string {
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch { /* keep as is */ }
    const runs = decoded.match(UNRESERVED_RUN) ?? [];
    return runs.reduce((best, r) => (r.length > best.length ? r : best), '');
}

export function postKey(input: string): PostKey | null {
    const u = parse(input);
    if (!u) return null;
    // www./m./mobile. mirrors are the same page on any site (as before 2.56.214);
    // web./mbasic. only on Facebook.
    // Locale (es-la.) and touch. mirrors and fb.com are facebook.com too.
    const host = u.hostname.toLowerCase()
        .replace(/^(web|mbasic|touch|[a-z]{2}-[a-z]{2})\.(?=(facebook|fb)\.com$)/, '')
        .replace(/^(www|m|mobile)\./, '')
        .replace(/^fb\.com$/, 'facebook.com');
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

    // A login wall stands for the page it guards (?next=/p/AAA/ or a full link).
    const next = q.get('next');
    if (next && (isFb || isIg) && parts.some(p => p === 'login' || p === 'login.php' || p === 'checkpoint')) {
        try { return postKey(new URL(next, `https://${u.hostname}`).toString()); } catch { /* not a link: fall through */ }
    }

    if (isFb) {
        const at = (seg: string) => {
            const i = parts.indexOf(seg);
            return i >= 0 && parts[i + 1] ? parts[i + 1] : null;
        };
        // Path-identified kinds first: a reel link can carry an unrelated ?fbid=.
        // Under /videos/ the id is the last numeric segment (older links put a
        // vb.<page> or a title slug before it).
        const videosAt = parts.indexOf('videos');
        const videoId = videosAt >= 0 ? [...parts.slice(videosAt + 1)].reverse().find(p => /^\d+$/.test(p)) ?? parts[videosAt + 1] : null;
        const video = videoId ?? at('reel') ?? (parts[0] === 'watch' || parts[0] === 'video.php' ? q.get('v') : null);
        if (video) return { key: `fb:video:${video}`, needle: video };
        const story = q.get('story_fbid');
        if (story) return { key: `fb:post:${story}`, needle: story };
        const post = at('posts') ?? at('permalink') ?? q.get('multi_permalinks')
            ?? (parts[0] === 'groups' && q.get('view') === 'permalink' ? q.get('id') : null);
        if (post) return { key: `fb:post:${post}`, needle: post };
        // /<page>/photos/<album>/<photo id>/ — the last segment is the photo.
        // /<page>/photos/<photo id>/ (no album) when that segment is numeric.
        const photosAt = parts.indexOf('photos');
        const albumPhoto = photosAt >= 0 && parts.length >= photosAt + 3 ? parts[photosAt + 2]
            : photosAt >= 0 && /^\d+$/.test(parts[photosAt + 1] ?? '') ? parts[photosAt + 1] : null;
        const fbid = q.get('fbid') ?? albumPhoto;
        if (fbid) return { key: `fb:photo:${fbid}`, needle: fbid };
        // /people/<name>/<id>/ is profile.php?id=<id>.
        if (parts[0] === 'people' && /^\d+$/.test(parts[2] ?? '')) {
            return { key: `url:facebook.com/profile.php?id=${parts[2]}`, needle: parts[2] };
        }
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
    // Profile, page and group names are case-insensitive on Facebook/Instagram;
    // post codes and ids are not, and are keyed above.
    const path = parts.map((seg, i) => {
        let d = seg;
        try { d = decodeURIComponent(seg); } catch { /* keep */ }
        return (isFb || isIg) && i === 0 ? d.toLowerCase() : d;
    }).join('/');
    const bare = path ? `${host}/${path}` : host;
    const kept = [...q.entries()]
        .filter(([k]) => (isFb || isIg ? META_IDENTIFYING.has(k) : !TRACKING.test(k)))
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
