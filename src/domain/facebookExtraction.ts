/**
 * What counts as usable content from a fetched Facebook post.
 *
 * Facebook answers a request for a NON-PUBLIC post with `og:title` — the
 * poster's profile name — and no `og:description`. So an author with no text and
 * no images does not mean "a post we partly read"; it means "Facebook served us
 * the name and withheld the post". There is nothing for the AI to extract, and
 * the source is demonstrably not public.
 *
 * This lived inline in the fetch-post route as
 * `text || images.length > 0 || author`, which made the route's own
 * "restricted post" guard unreachable: every such post returned an empty success
 * and the import silently dead-ended. The leniency was meant for video posts
 * only, exactly as the comment beside it said.
 */

export interface ExtractedPost {
    text?: string;
    author?: string;
    images?: string[];
    /** From `og:type` in the fetched HTML. */
    isVideo?: boolean;
    /**
     * A crawler placeholder seen in og:image, parked outside `images` for the
     * reel-thumbnail fetch. Its presence is wall evidence and MUST count as
     * such here — moving the stub out of `images` without this field silently
     * disarmed the wall check (v2.54.5 field report).
     */
    crawlerThumbnailUrl?: string;
}

/**
 * Text Facebook renders on its wall and error pages, which the DOM/OG harvest
 * can scoop up as if it were the post's caption. The GraphQL error banner
 * ("A server error field_exception occured. Check server logs for details." —
 * typo is Facebook's) is 71 characters, comfortably over every
 * "meaningful content" length bar, and reached the wizard verbatim.
 *
 * Boilerplate phrases only condemn SHORT text: a real caption can legitimately
 * tell an adopter to log in somewhere, so anything long enough to be a caption
 * is left alone. The error banner is damning at any length.
 */
const FB_ERROR_BANNER = /a server error \w+ occured\.? check server logs/i;
const FB_WALL_BOILERPLATE = [
    /^see more of .{1,80} on facebook/i,
    /^ver más de .{1,80} en facebook/i,
    /log in (or sign up )?to (see|view|continue)/i,
    /^log in to see/i,
    /^inicia sesión para/i,
    /^iniciar sesión/i,
    /you must log in/i,
    /this content isn'?t available/i,
    /este contenido no está disponible/i,
];

export function isWallOrErrorText(text: string): boolean {
    const t = text.trim();
    if (!t) return false;
    if (FB_ERROR_BANNER.test(t)) return true;
    if (t.length > 200) return false;
    return FB_WALL_BOILERPLATE.some(re => re.test(t));
}

/** Trimmed post text, with wall/error boilerplate blanked to nothing. */
export function sanitizePostText(text: string | undefined | null): string {
    const t = (text ?? '').trim();
    return isWallOrErrorText(t) ? '' : t;
}

/**
 * A video post is lenient: the caption is often empty and the rescuer supplies
 * screenshots, so the author alone is enough to proceed.
 *
 * Video-ness is taken from EITHER signal. `isVideo` is parsed from `og:type` in
 * the same HTML that may be withholding everything, and `isVideoUrl` only
 * catches the URL shapes we know (`/reel/`, `/videos/`, `/share/r/`), so a reel
 * can arrive with neither. Requiring both would reject video posts that work
 * today.
 */
export function isVideoPost(post: ExtractedPost, isVideoUrl = false): boolean {
    return Boolean(post.isVideo) || isVideoUrl;
}

/**
 * A crawler placeholder is Facebook's stand-in for a photo it is withholding.
 *
 * A login-walled post's HTML still carries an `og:image` — but it points at
 * `lookaside.fbsbx.com/lookaside/crawler/media/`, an endpoint that answers a
 * browser with a few hundred bytes of text/html, never image bytes. It renders
 * as a broken thumbnail and, worse, it counts as "an image" to any
 * `images.length > 0` check, which is exactly how a walled post used to pass
 * for a successful extraction (share/19EN1HpufE, 2026-09-04).
 */
export function isPlaceholderAssetUrl(url: string): boolean {
    return /lookaside\.fbsbx\.com\/lookaside\/crawler\//i.test(url);
}

/** The images that are actually photos — crawler placeholders dropped. */
export function realImages(urls: string[] | undefined): string[] {
    return (urls ?? []).filter(u => !isPlaceholderAssetUrl(u));
}

/**
 * True when the fetch produced something worth importing.
 *
 * Regular posts need text or REAL images — a crawler placeholder (see
 * `isPlaceholderAssetUrl`) is evidence of a login wall, not content.
 *
 * Only video posts may pass on the author alone, and the two video signals are
 * no longer equally trusted: `isVideoUrl` comes from the URL the rescuer typed,
 * but `post.isVideo` comes from `og:type` in the fetched HTML — and a login
 * wall FABRICATES `og:type: video.other` on posts that are not videos at all.
 * So when the same HTML also served a crawler placeholder, its og:type claim is
 * disqualified: that combination is the wall's signature, and honoring it
 * manufactured author-only "successes" out of unreadable posts. A genuine video
 * post unlucky enough to be walled still passes via its URL shape.
 */
export function hasExtractableContent(post: ExtractedPost, isVideoUrl = false): boolean {
    if (sanitizePostText(post.text)) return true;
    if (realImages(post.images).length > 0) return true;
    const sawWallPlaceholder = (post.images ?? []).some(isPlaceholderAssetUrl)
        || Boolean(post.crawlerThumbnailUrl);
    const videoSignal = isVideoUrl || (Boolean(post.isVideo) && !sawWallPlaceholder);
    return videoSignal && Boolean(post.author);
}

/**
 * A stable identity for a Facebook CDN image, for de-duplication.
 *
 * The same photo is served under many URLs: Facebook varies the size params
 * (`stp`, `cstp`), the cache hints (`_nc_ohc`, `_nc_gid`) and the per-request
 * signature (`oh`, `oe`) on every render, so two links to one photo rarely match
 * as strings. De-duplicating on the exact URL therefore let the same image
 * appear several times in the import review grid.
 *
 * The filename carries the photo's real identity — `738546332_2216399502449551_
 * 8877869079595647378_n.jpg` — so key on the path's last segment and drop the
 * query entirely. Non-CDN or unparseable values fall back to the whole string,
 * which is no worse than the previous behaviour.
 */
export function imageIdentity(url: string): string {
    if (!url) return url;
    // data: URIs are their own identity; they have no meaningful path.
    if (url.startsWith('data:')) return url;
    const withoutQuery = url.split('?')[0];
    const lastSegment = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
    return lastSegment || url;
}

/** Collapse URLs that point at the same photo, keeping first-seen order. */
export function dedupeImages(urls: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const url of urls) {
        const id = imageIdentity(url);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(url);
    }
    return out;
}

/** Did Facebook give us the post's own words? */
export function hasPostText(post: ExtractedPost): boolean {
    return Boolean(post.text && post.text.trim());
}

/**
 * True when Facebook identified the poster but served none of the post's text —
 * our evidence that the source is not publicly readable.
 *
 * Deliberately ignores images. Facebook serves `og:image` for restricted posts
 * too (it is the link-preview thumbnail), so a photo is NOT evidence that the
 * content was public. The adopter's details live in the caption, and the caption
 * is what was withheld. Keying this off images was what let a non-public post
 * look like a successful import: photo + poster name, no caption, nothing for
 * the AI to read.
 *
 * The import still proceeds — the rescuer pastes the text by hand and keeps or
 * drops whatever we did scrape — but the profile must NOT default to public. The
 * public-visibility toggle rests on the premise that the data was already
 * public, and here we could not read it at all.
 *
 * This is a proxy, not proof: a transient block or rate-limit produces the same
 * shape, which is why the rescuer keeps the ability to override it.
 */
export function isSourceNotPublic(post: ExtractedPost): boolean {
    return !hasPostText(post) && Boolean(post.author);
}
