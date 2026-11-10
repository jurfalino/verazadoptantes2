/**
 * «venció hace 39 días» → the number stays on one line with the words around
 * it (non-breaking spaces), so a narrow card never leaves «días» alone on a
 * line of its own.
 */
export function keepNumberWithUnit(text: string): string {
    return text.replace(/(\S) (\d+) (\S)/g, '$1 $2 $3');
}

/**
 * A home card summary («5 disponibles · 278 adoptados») may wrap only after
 * «·»: each count stays with its word, and «·» stays at the end of the first
 * line — never «278» / «adoptados» (Jon 2026-11-09).
 */
export function keepCountsTogether(text: string): string {
    return text.replace(/(\d+) (\S)/g, '$1 $2').replace(/ ·/g, ' ·');
}
