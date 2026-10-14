/**
 * Spreadsheet import — which rows of ONE file are the same person (pure).
 *
 * People apply more than once: one form per animal, or again a year later. The
 * import should make ONE profile with several activities, not one per row. Rows
 * are the same person when:
 *   - their identifying content is identical (name + every contact — the content
 *     fingerprint, as before), or
 *   - they share an email or a phone (last 8 digits, so "+54 9 11…", "011 15…"
 *     and "11…" coincide) AND their names share a word of 3+ letters.
 * A shared email or phone with no name in common stays apart: households and
 * couples share a phone or an email, and they are different people.
 *
 * Grouping is transitive (A~B and B~C ⇒ one group). The reviewer sees every
 * group before anything is written and can split it ("Separar").
 */

import { computeContentFingerprint } from './contentFingerprint';
import { isPlaceholderPhone } from './phoneNumber';

export interface GroupableRow {
    index: number;
    name: string;
    phones: string[];
    emails: string[];
    socials: string[];
    ids: string[];
    addresses: string[];
}

export type GroupReason = 'identical' | 'email' | 'phone';

export interface PersonGroup {
    /** Row indices, ascending; the first is the primary (it becomes the profile). */
    indices: number[];
    /** Why the rows were joined (the first link found); null for a single row. */
    reason: GroupReason | null;
}

const PHONE_KEY_DIGITS = 8;

function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function nameWords(name: string): Set<string> {
    return new Set(fold(name).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3));
}
function phoneKey(p: string): string {
    const d = (p.match(/\d/g) ?? []).join('');
    if (d.length < PHONE_KEY_DIGITS || isPlaceholderPhone(d)) return '';
    return d.slice(-PHONE_KEY_DIGITS);
}
function emailKey(e: string): string {
    const v = fold(e);
    return v.includes('@') ? v : '';
}

/** Group the rows of one file into people. Every input row is in exactly one group;
 *  groups are ordered by their primary (lowest) index. */
export function groupSamePerson(rows: GroupableRow[]): PersonGroup[] {
    const sorted = [...rows].sort((a, b) => a.index - b.index);
    const parent = new Map<number, number>(sorted.map(r => [r.index, r.index]));
    const reasonOf = new Map<number, GroupReason>(); // keyed by root
    const find = (x: number): number => {
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r)!;
        while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; }
        return r;
    };
    const union = (a: number, b: number, why: GroupReason) => {
        const ra = find(a), rb = find(b);
        if (ra === rb) return;
        const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
        parent.set(drop, keep);
        if (!reasonOf.has(keep)) reasonOf.set(keep, reasonOf.get(drop) ?? why);
    };

    const words = new Map(sorted.map(r => [r.index, nameWords(r.name)]));
    const shareName = (a: number, b: number) => {
        const wa = words.get(a)!, wb = words.get(b)!;
        for (const w of wa) if (wb.has(w)) return true;
        return false;
    };

    // Identical content: same as the old fold (the fingerprint already includes the name).
    const byFp = new Map<string, number>();
    for (const r of sorted) {
        const fp = computeContentFingerprint({ name: r.name, phones: r.phones, emails: r.emails, socials: r.socials, ids: r.ids, addresses: r.addresses });
        if (!fp) continue;
        const first = byFp.get(fp);
        if (first === undefined) byFp.set(fp, r.index); else union(first, r.index, 'identical');
    }

    // A shared email / phone, only between rows whose names have a word in common.
    const link = (keysOf: (r: GroupableRow) => string[], why: GroupReason) => {
        const seen = new Map<string, number[]>();
        for (const r of sorted) {
            for (const k of new Set(keysOf(r).filter(Boolean))) {
                const earlier = seen.get(k) ?? [];
                const mate = earlier.find(i => shareName(i, r.index));
                if (mate !== undefined) union(mate, r.index, why);
                earlier.push(r.index);
                seen.set(k, earlier);
            }
        }
    };
    link(r => r.emails.map(emailKey), 'email');
    link(r => r.phones.map(phoneKey), 'phone');

    const groups = new Map<number, number[]>();
    for (const r of sorted) {
        const root = find(r.index);
        const g = groups.get(root);
        if (g) g.push(r.index); else groups.set(root, [r.index]);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a - b)
        .map(([root, indices]) => ({ indices, reason: indices.length > 1 ? (reasonOf.get(root) ?? 'identical') : null }));
}

/** Every distinct value across the group's rows, first-seen order (folded compare). */
export function unionValues(lists: string[][], keyOf: (v: string) => string = fold): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const list of lists) for (const v of list) {
        const k = keyOf(v) || fold(v);
        if (!v.trim() || seen.has(k)) continue;
        seen.add(k); out.push(v);
    }
    return out;
}

/** Phone comparison key for unionValues: the digits. */
export function phoneDigitsKey(p: string): string {
    return (p.match(/\d/g) ?? []).join('');
}
