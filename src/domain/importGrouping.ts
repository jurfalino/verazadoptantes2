/**
 * Spreadsheet import — which rows of ONE file are the same person (pure).
 *
 * People apply more than once: one form per animal, or again a year later. The
 * import should make ONE profile with several activities, not one per row. Rows
 * are the same person when:
 *   - their identifying content is identical (name + every contact — the content
 *     fingerprint, as before), or
 *   - they share an email or a phone (last 8 digits, so "+54 9 11…", "011 15…"
 *     and "11…" coincide) AND their names agree: the same first name, and —
 *     when both names have more than one word — another word in common
 *     ("Ana Pérez" ~ "ana perez gomez", "Juan" ~ "Juan Gómez"; never
 *     "María Pérez" ~ "Juan Pérez" or "María Gómez" ~ "María Ruiz").
 * Households and couples share a phone or an email, and they are different
 * people. An email or phone written by more than MAX_NAMES_PER_KEY different
 * names is a shared or junk value ("no@gmail.com") and links nobody.
 *
 * Grouping is transitive (A~B and B~C ⇒ one group), but a join happens only when
 * every name in the two groups agrees with every other — so a one-word row
 * ("Gómez") can never bring two different people ("Ana Gómez", "Juan Gómez")
 * into one group. A row that could be either of two such people on the same
 * email or phone joins neither, in any row order. The reviewer sees every group
 * before anything is written and can split it ("Separar").
 */

import { computeContentFingerprint } from './contentFingerprint';
import { isPlaceholderPhone } from './phoneNumber';
import { namesCompatible } from './apiExactMatch';

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
const MAX_NAMES_PER_KEY = 3;
/** Words that say nothing about who someone is ("María de los Ángeles"). */
const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'san', 'santa', 'da', 'do', 'dos', 'van', 'von']);

function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function nameWords(name: string): string[] {
    return fold(name).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 2 && !NAME_PARTICLES.has(w));
}
/** Same person's name by the one shared name rule (order-free; a one-word name agrees with a longer one). */
export function namesAgree(a: string, b: string): boolean {
    return namesCompatible(a, b);
}
function phoneKey(p: string): string {
    const d = (p.match(/\d/g) ?? []).join('');
    if (d.length < PHONE_KEY_DIGITS || isPlaceholderPhone(d)) return '';
    return d.slice(-PHONE_KEY_DIGITS);
}
function emailKey(e: string): string {
    const v = fold(e);
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v) ? v : '';
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
    const nameOf = new Map(sorted.map(r => [r.index, r.name]));
    const shareName = (a: number, b: number) => namesAgree(nameOf.get(a)!, nameOf.get(b)!);
    /** Within a group: the same written name (an identical row, nameless ones included) or agreeing names. */
    const sameOrAgree = (a: number, b: number) =>
        nameWords(nameOf.get(a)!).join(' ') === nameWords(nameOf.get(b)!).join(' ') || shareName(a, b);
    // keyed by root: one row per distinct written name in the group (all a join needs to compare)
    const membersOf = new Map<number, Map<string, number>>(sorted.map(r => [r.index, new Map([[nameWords(r.name).join(' '), r.index]])]));

    /** Join a's and b's groups — only when every name in one agrees with every name in the
     *  other, so a one-word row («Gómez») never bridges two different people
     *  («Ana Gómez», «Juan Gómez»), whatever order the rows come in. */
    const union = (a: number, b: number, why: GroupReason): boolean => {
        const ra = find(a), rb = find(b);
        if (ra === rb) return true;
        const ma = [...membersOf.get(ra)!.values()], mb = [...membersOf.get(rb)!.values()];
        if (!ma.every(x => mb.every(y => sameOrAgree(x, y)))) return false;
        const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
        parent.set(drop, keep);
        const kept = membersOf.get(keep)!;
        for (const [n, i] of membersOf.get(drop)!) if (!kept.has(n)) kept.set(n, i);
        membersOf.delete(drop);
        if (!reasonOf.has(keep)) reasonOf.set(keep, reasonOf.get(drop) ?? why);
        return true;
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
        // A value written by many different names is shared or junk: it links nobody.
        const namesByKey = new Map<string, Set<string>>();
        for (const r of sorted) for (const k of keysOf(r)) if (k) {
            const set = namesByKey.get(k) ?? new Set<string>();
            set.add(nameWords(r.name).join(' '));
            namesByKey.set(k, set);
        }
        const holders = new Map<string, number[]>();
        for (const r of sorted) for (const k of new Set(keysOf(r))) if (k) {
            const list = holders.get(k) ?? [];
            list.push(r.index);
            holders.set(k, list);
        }
        // A row whose name agrees with two holders of the key that disagree with each other
        // («Gómez» next to «Ana Gómez» and «Juan Gómez») could be either: on that key it links
        // nobody, so the result never depends on which of them comes first.
        const ambiguousMemo = new Map<string, boolean>();
        const ambiguous = (row: number, k: string): boolean => {
            const memoKey = `${row}|${k}`;
            const hit = ambiguousMemo.get(memoKey);
            if (hit !== undefined) return hit;
            // One row per distinct written name (a key that isn't junk has at most MAX_NAMES_PER_KEY).
            const byName = new Map<string, number>();
            for (const i of holders.get(k)!) {
                if (i === row) continue;
                const n = nameWords(nameOf.get(i)!).join(' ');
                if (!byName.has(n) && shareName(i, row)) byName.set(n, i);
            }
            const agreeing = [...byName.values()];
            const out = agreeing.some((a, x) => agreeing.slice(x + 1).some(b => !sameOrAgree(a, b)));
            ambiguousMemo.set(memoKey, out);
            return out;
        };
        const seen = new Map<string, number[]>();
        for (const r of sorted) {
            for (const k of new Set(keysOf(r).filter(k => k && namesByKey.get(k)!.size <= MAX_NAMES_PER_KEY))) {
                const earlier = seen.get(k) ?? [];
                // Every earlier holder whose name agrees is tried: one refused group
                // (it holds an incompatible name) must not stop a join with the next.
                if (!ambiguous(r.index, k)) {
                    for (const i of earlier) if (shareName(i, r.index) && !ambiguous(i, k)) union(i, r.index, why);
                }
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

/** The name a group's profile gets: the most complete one — most words, then
 *  longest, then the best-written (capitals and accents: "Juan Gómez" over "juan gomez"). */
export function groupName(names: string[]): string {
    const care = (n: string) => (n.match(/[A-ZÁÉÍÓÚÑÜ]|[áéíóúñü]/g) ?? []).length;
    const score = (n: string) => [nameWords(n).length, n.length, care(n)];
    let best = '';
    for (const n of names.map(x => x.trim()).filter(Boolean)) {
        if (!best) { best = n; continue; }
        const a = score(n), b = score(best);
        const k = a.findIndex((v, i) => v !== b[i]);
        if (k >= 0 && a[k] > b[k]) best = n;
    }
    return best;
}

/** Phone comparison key for unionValues: the digits. */
export function phoneDigitsKey(p: string): string {
    return (p.match(/\d/g) ?? []).join('');
}
