/**
 * How an adopter's name is shown to a logged-out visitor while
 * ENABLE_GUEST_NAME_MASK is on: the words they typed stay, every other word of
 * the name keeps its first letter and becomes "••••" — the same bullet the
 * contact line already uses ("15-50••-••••"). The bullet run is fixed, so the
 * mask does not give away how long a word is.
 *
 *   "María Rosa Rodríguez López", searched as "maria" → "María R•••• R•••• L••••"
 *
 * The same words are masked wherever they appear in the contact line
 * ("Conocido/a como: …", a social profile named after the person), so the name
 * can't be read there instead. Pure — the caller supplies the alias values.
 */

const BULLETS = '••••';

/** Accent- and case-insensitive form of one word, for comparing. */
function fold(word: string): string {
    return word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Words of two or more letters, folded. Initials can't identify anyone alone. */
function foldedWords(text: string): string[] {
    return (text.match(/[\p{L}\p{M}]+/gu) ?? []).map(fold).filter(w => w.length >= 2);
}

/** The words the visitor typed — they already know these, so they stay. */
export function typedWords(query: string): Set<string> {
    return new Set(foldedWords(query));
}

/** Every word that names this person: the name itself plus any aliases. */
export function guestNameWords(name: string, aliases: string[] = []): Set<string> {
    return new Set([name, ...aliases].flatMap(foldedWords));
}

function maskWord(word: string): string {
    return `${[...word][0] ?? ''}${BULLETS}`;
}

/** The name as a logged-out visitor sees it. */
export function maskGuestName(name: string, typed: Set<string>): string {
    return name.trim().split(/\s+/).filter(Boolean)
        .map(w => {
            const f = fold(w.replace(/[^\p{L}\p{M}]/gu, ''));
            return f.length >= 2 && typed.has(f) ? w : maskWord(w);
        })
        .join(' ');
}

/**
 * Mask each whole word of `text` that is one of the person's name words and
 * was not typed. Everything else (labels, already-masked values, punctuation)
 * is left exactly as it was.
 */
export function maskNameWordsInText(text: string, nameWords: Set<string>, typed: Set<string>): string {
    return text.replace(/[\p{L}\p{M}]+/gu, (w) => {
        const f = fold(w);
        return f.length >= 2 && nameWords.has(f) && !typed.has(f) ? maskWord(w) : w;
    });
}
