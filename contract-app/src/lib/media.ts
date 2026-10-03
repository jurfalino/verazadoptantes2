/**
 * Photos and videos on the public animal surfaces.
 *
 * A rescuer can attach either, and the API sends both in one `images` list.
 * Everything here exists so a video never reaches an `<img>`: it is drawn by
 * its poster, and played only where there is a player.
 *
 * A video with NO poster is undrawable. It is not an error — it just cannot
 * represent the animal in a grid — so `posterOf` returns null and the callers
 * skip past it rather than rendering an empty tile.
 */

export interface Media {
    url: string
    caption?: string | null
    mediaType?: string | null
    thumbnailUrl?: string | null
}

export function isVideo(m: Media): boolean {
    return m.mediaType === 'video'
}

/** The still to draw for this item: the photo itself, or a video's poster. */
export function posterOf(m: Media): string | null {
    return isVideo(m) ? (m.thumbnailUrl || null) : (m.url || null)
}

/** The first item that can actually be drawn — what a card should lead with. */
export function firstShowable<T extends Media>(list: T[]): T | undefined {
    return list.find((m) => !!posterOf(m))
}

/** Every drawable still, for share previews and structured data: a crawler
 *  given a video URL as an image shows a broken card. */
export function posterUrls(list: Media[]): string[] {
    return list.map(posterOf).filter((u): u is string => !!u)
}
