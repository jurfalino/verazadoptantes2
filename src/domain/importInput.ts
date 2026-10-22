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
    const found = trimmed.match(LINK) ?? [];
    // The same link twice (some apps put it in both share fields) is one link.
    const links = [...new Set(found.map(l => l.replace(TRAILING, '')))];
    // Zero links is plain text. Two or more different ones is a pasted
    // conversation: opening one would silently drop the other, so let the AI
    // read it all instead.
    if (links.length !== 1) return { url: null, text: trimmed };
    const url = links[0];
    const text = found
        .reduce((acc, raw) => acc.replace(raw, ' '), trimmed)
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

/** Contact kinds that identify one person on their own (an address alone does not). */
const STRONG_IDENTIFIERS = new Set(['phone', 'email', 'social', 'id']);

/**
 * Can the import wizard save this profile? A name, or — for posts that only
 * show a handle — at least one strong identifier (decision B4, 2026-10-21).
 * The API already accepts a nameless profile; the wizard used to disable
 * "Guardar" with no explanation whenever the name was empty.
 */
export function canSaveImportedProfile(name: string | undefined, entries: Array<{ type: string; value: string }>): boolean {
    if (name?.trim()) return true;
    return entries.some(e => STRONG_IDENTIFIERS.has(e.type) && e.value.trim().length > 0);
}

/** The record types an import can create. One default for the pills and the save. */
export const IMPORT_RECORD_TYPES = ['adoption', 'adoption_request', 'returned_pet', 'follow_up', 'observation'] as const;
export type ImportRecordType = typeof IMPORT_RECORD_TYPES[number];

/**
 * The record type to show selected and to save. The pills used to default to
 * 'adoption' while the save defaulted to 'observation', so an untouched form
 * saved something other than what it showed.
 */
export function importRecordType(aiType: string | undefined | null): ImportRecordType {
    return (IMPORT_RECORD_TYPES as readonly string[]).includes(aiType ?? '') ? aiType as ImportRecordType : 'observation';
}

/** Record types that describe an animal changing hands — they get the animal/rating/date fields. */
export function recordTypeHasAnimal(type: ImportRecordType): boolean {
    return type !== 'observation';
}

/** Lowercase, accents and extra spaces removed — for comparing two spellings of a name. */
function foldName(name: string): string {
    return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The post's name to keep as an alias when it is merged into a profile that goes
 * by another name (decision B8, 2026-10-21) — "Mari G" into "María Gómez".
 * Null when there is no name or it is the same name spelled the same way.
 */
export function aliasForMerge(postName: string | undefined, targetName: string | undefined): string | null {
    const name = postName?.trim();
    if (!name) return null;
    return foldName(name) === foldName(targetName ?? '') ? null : name;
}
