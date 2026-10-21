/**
 * What the rescuer pasted into the import wizard's first step.
 *
 * A link shared from a phone rarely arrives alone — "Mirá este post https://…"
 * is the usual shape. The wizard used to fetch only when the whole field was a
 * URL, so a link with any words around it went to the AI as plain text and the
 * post (caption, photos) was never opened (audit 2026-10-21, A4).
 */

const LINK = /https?:\/\/[^\s<>"']+/gi;
/** Sentence punctuation that sticks to the end of a pasted link. */
const TRAILING = /[.,;:!?)\]}]+$/;

export interface LinkAndText {
    /** The one link to fetch, or null when there is none — or more than one. */
    url: string | null;
    /** Everything else the rescuer wrote, whitespace collapsed. */
    text: string;
}

export function splitLinkAndText(input: string): LinkAndText {
    const trimmed = input.trim();
    const links = trimmed.match(LINK) ?? [];
    // Zero links is plain text. Two or more is a pasted conversation: opening one
    // of them would silently drop the other, so let the AI read it all instead.
    if (links.length !== 1) return { url: null, text: trimmed };
    const raw = links[0];
    const url = raw.replace(TRAILING, '');
    const text = trimmed
        .replace(raw, ' ')
        .replace(/\(\s*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return { url, text };
}

/** The fetched post first, then what the rescuer wrote about it. */
export function appendContext(fetched: string, context: string): string {
    const extra = context.trim();
    if (!extra) return fetched;
    if (!fetched.trim()) return extra;
    return `${fetched}\n\n---\n${extra}`;
}
