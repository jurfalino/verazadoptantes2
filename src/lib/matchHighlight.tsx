/**
 * Match highlighting for the duplicate-peek side panel.
 *
 * Given a haystack (e.g. a record's contactInfo or name) and the matchValues
 * that fired for that record, returns React nodes with each matched fragment
 * wrapped in <mark>. Lets the rescuer eyeball *why* a record was surfaced —
 * especially useful when a match looks wrong and they want to see exactly
 * which characters triggered it.
 *
 * Normalizes both sides per token type so a stored token like "541115551234"
 * still highlights when the haystack has the phone with separators ("+54 11
 * 5555-1234"). Builds an index map from normalized → original positions so
 * the highlight bounds correctly span the original (formatted) text.
 */

import type { ReactNode } from 'react';
import type { MatchValue } from './matchChips';

type NormalizerFn = (c: string) => string;

const NORMALIZERS: Record<string, NormalizerFn> = {
    // Phones & ID numbers: keep digits (for IDs we also keep letters via a separate path below).
    phone: (c) => /\d/.test(c) ? c : '',
    phone_suffix: (c) => /\d/.test(c) ? c : '',
    id_number: (c) => /[a-zA-Z0-9]/.test(c) ? c.toLowerCase() : '',
    email: (c) => c.toLowerCase(),
    social: (c) => c.toLowerCase(),
    name_full: (c) => normalizeAccentedChar(c),
    name_word: (c) => normalizeAccentedChar(c),
    address_word: (c) => normalizeAccentedChar(c),
    source_url: (c) => c.toLowerCase(),
};

function normalizeAccentedChar(c: string): string {
    const lower = c.toLowerCase();
    if (!/[a-zA-ZÀ-ɏ]/.test(c)) return '';
    return lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Find all (start, end) ranges in `text` that, when normalized using the
 * given char-normalizer, contain `target`. `target` is assumed to already be
 * normalized to the same scheme.
 */
function findRanges(text: string, target: string, normalize: NormalizerFn): Array<[number, number]> {
    if (!target) return [];
    const offsetMap: number[] = []; // normalizedIndex -> originalIndex (start of that char)
    let normalized = '';
    for (let i = 0; i < text.length; i++) {
        const out = normalize(text[i]);
        if (out) {
            normalized += out;
            for (let j = 0; j < out.length; j++) offsetMap.push(i);
        }
    }
    if (normalized.length < target.length) return [];
    const ranges: Array<[number, number]> = [];
    let pos = 0;
    while (true) {
        const idx = normalized.indexOf(target, pos);
        if (idx === -1) break;
        const start = offsetMap[idx];
        const end = offsetMap[idx + target.length - 1] + 1;
        ranges.push([start, end]);
        pos = idx + target.length;
    }
    return ranges;
}

/** Merge overlapping or adjacent ranges. */
function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
    if (ranges.length === 0) return [];
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        if (sorted[i][0] <= last[1]) {
            last[1] = Math.max(last[1], sorted[i][1]);
        } else {
            merged.push(sorted[i]);
        }
    }
    return merged;
}

/**
 * Highlight matched fragments inside `text`. Only token types in `acceptTypes`
 * are highlighted (pass e.g. `['phone', 'phone_suffix', 'email', 'id_number']`
 * when rendering contactInfo, or `['name_full', 'name_word']` for the name).
 */
export function highlightMatches(
    text: string | null | undefined,
    matchValues: MatchValue[] | undefined,
    acceptTypes: string[],
): ReactNode[] {
    if (!text) return [];
    if (!matchValues || matchValues.length === 0) return [text];

    const accept = new Set(acceptTypes);
    const allRanges: Array<[number, number]> = [];
    for (const mv of matchValues) {
        if (!accept.has(mv.type)) continue;
        const normalize = NORMALIZERS[mv.type];
        if (!normalize) continue;
        // Re-normalize the target with the same char-normalizer to be safe
        // (stored values are already mostly normalized, but be defensive).
        let target = '';
        for (let i = 0; i < mv.value.length; i++) target += normalize(mv.value[i]);
        if (!target) continue;
        allRanges.push(...findRanges(text, target, normalize));
    }
    const merged = mergeRanges(allRanges);
    if (merged.length === 0) return [text];

    const out: ReactNode[] = [];
    let cursor = 0;
    merged.forEach(([start, end], i) => {
        if (start > cursor) out.push(text.slice(cursor, start));
        out.push(
            <mark
                key={`mark-${i}`}
                className="bg-amber-200 text-amber-900 rounded px-0.5 font-semibold"
            >
                {text.slice(start, end)}
            </mark>,
        );
        cursor = end;
    });
    if (cursor < text.length) out.push(text.slice(cursor));
    return out;
}
