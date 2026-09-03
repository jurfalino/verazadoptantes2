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
 * True when the fetch produced something worth importing.
 *
 * Regular posts need text or images. Only video posts may pass on the author
 * alone.
 */
export function hasExtractableContent(post: ExtractedPost, isVideoUrl = false): boolean {
    if (post.text) return true;
    if (post.images && post.images.length > 0) return true;
    return isVideoPost(post, isVideoUrl) && Boolean(post.author);
}

/**
 * True when Facebook identified the poster but refused to serve the post — our
 * evidence that the source is not publicly visible.
 *
 * The import still proceeds (the rescuer pastes the text by hand) but the
 * resulting profile must NOT default to public: the public-visibility toggle
 * rests on the premise that the data was already public, and here it was not.
 *
 * Note this is a proxy, not proof. A transient block or rate-limit produces the
 * same shape, which is why the rescuer keeps the ability to override it.
 */
export function isSourceNotPublic(post: ExtractedPost, isVideoUrl = false): boolean {
    return !hasExtractableContent(post, isVideoUrl) && Boolean(post.author);
}
