/**
 * «venció hace 39 días» → the number stays on one line with the words around
 * it (non-breaking spaces), so a narrow card never leaves «días» alone on a
 * line of its own.
 */
export function keepNumberWithUnit(text: string): string {
    return text.replace(/(\S) (\d+) (\S)/g, '$1 $2 $3');
}
