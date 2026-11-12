/**
 * Pure Instagram helpers (no network, no browser) — tested in test/instagram.test.js.
 *
 * Why they exist (2026-11-12): imports of Instagram posts arrived with a 73-char
 * caption and a cropped photo. Instagram's link preview (og:description /
 * og:image) is a short header + the start of the caption, and a photo cropped
 * for preview cards; the scraper stopped there, and when it did open the post its
 * dedupe kept the cropped preview over the full-size copy of the same photo.
 */

/** Stable-ish id for an Instagram CDN image URL, so size variants of the same
 *  photo dedupe to one while distinct carousel slides stay separate. Keys on the
 *  first two id groups (`<photoId>_<mediaId>`), which are identical across the
 *  og:image (scontent host) and the image_versions2 (fbcdn host) URLs of the same
 *  slide — yet unique per slide. */
export function instagramImageId(u: string): string {
    const m = u.match(/\/([0-9]{6,}_[0-9]{6,})_[0-9]/);
    return m ? m[1] : u.split('?')[0];
}

/**
 * One URL per photo, `primary` first (the page's full-size copies), then any
 * `fallback` photo (the cropped link preview) the page did not have.
 */
export function mergeImagesPreferFullRes(primary: string[], fallback: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const u of [...primary, ...fallback]) {
        const id = instagramImageId(u);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(u);
    }
    return out;
}

/**
 * Harvest ALL Instagram carousel image URLs from page HTML/JSON and append the
 * new ones to `out`. Instagram embeds every slide in the Relay preload JSON under
 * `image_versions2.candidates[].url` (the first candidate is the full-res one).
 * Only the PRIMARY post emits these blocks. Dedupes by image id against `out`.
 * Escaped JSON slashes/ampersands are unescaped. Best-effort — markup evolves.
 */
export function harvestInstagramImages(html: string, out: string[]): void {
    const seen = new Set(out.map(instagramImageId));
    const consider = (raw: string) => {
        const u = raw
            .replace(/\\u0026/gi, '&')
            .replace(/\\u00253D/gi, '%3D')
            .replace(/\\\//g, '/');
        if (!/scontent|cdninstagram|fbcdn/i.test(u)) return;
        // Skip thumbnails, profile pics, emoji, and non-feed image classes.
        if (/(_s\.|_t\.|s150x150|150x150|\/profile|profile_pic|emoji|t51\.[0-9]+-19)/i.test(u)) return;
        const id = instagramImageId(u);
        if (seen.has(id)) return;
        seen.add(id);
        out.push(u);
    };
    for (const m of html.matchAll(/"image_versions2":\{"candidates":\[\{"url":"([^"]+)"/g)) consider(m[1]);
    for (const m of html.matchAll(/"display_url":"([^"]+)"/g)) consider(m[1]);
}

/**
 * Instagram's preview text is `<N> likes, <N> comments - <user> on <date>: "<caption…>"`
 * (or the Spanish `… Me gusta, … comentarios - <user> el <fecha>: "…"`). Returns the
 * quoted caption part; any other text unchanged.
 */
export function captionFromOgDescription(desc: string): string {
    const m = desc.match(/^[^"]*?:\s*["“]([\s\S]*)["”]\s*\.?\s*$/);
    return m && m[1].trim() ? m[1].trim() : desc;
}

/** The primary post's full caption from the page's embedded JSON (`"caption":{…"text":"…"}`). */
export function harvestInstagramCaption(html: string): string | undefined {
    const m = html.match(/"caption":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/);
    if (!m) return undefined;
    try {
        const text = JSON.parse(`"${m[1]}"`) as string;
        return text.trim() || undefined;
    } catch {
        return undefined;
    }
}

/** The embedded caption when the page had one; else the longer of the page text and the preview caption. */
export function chooseInstagramCaption(c: { embedded?: string; pageText?: string; preview?: string }): string {
    if (c.embedded && c.embedded.trim()) return c.embedded.trim();
    const page = (c.pageText ?? '').trim();
    const preview = (c.preview ?? '').trim();
    return page.length > preview.length ? page : preview;
}
