/**
 * A profile's name and age, open to anyone signed in (households as profiles,
 * Task 3 — Jon, 2026-10-27). Pure rules: no DB, no server imports.
 *
 * - A rename keeps the previous name as a hidden alias (`fromRename`): still a
 *   name token, so search and duplicate detection find the old name, shown in
 *   the header as «Conocido/a como». Renaming back to a kept name drops that
 *   alias (it is the name again).
 * - The history row of a rename is `{ name: {from,to}, name_changed: {from,to,…} }`:
 *   the `name` key keeps the field-author lookup (collabAttribution) and the
 *   conflict notice's «por …» working; `name_changed` is what the history
 *   list, «Deshacer» and the undo bookkeeping read.
 * - Age is stored as told (`age`) plus the day it was told (`age_as_of`, UTC);
 *   `currentAge` counts up from there. A known age decides «menor»; the box
 *   (`is_minor`) counts only with no age (ruling, Task 1).
 */
import { isRenameAlias, type ContactEntry } from '@/lib/contactEntries';
import { normalizeText } from '@/lib/tokenizer';
import { MINOR_AGE_LIMIT, currentAge, isMinor } from '@/domain/households';

/** Error-message prefix for a record, alert or rating refused on a minor's profile. */
export const PROFILE_IS_MINOR = 'PROFILE_IS_MINOR';

export function isProfileIsMinorError(e: unknown): boolean {
    return e instanceof Error && e.message.startsWith(PROFILE_IS_MINOR);
}

export const MAX_PROFILE_NAME_LEN = 200;
export const MAX_AGE = 120;

/** Two names the token index can't tell apart (case, accents, spacing) are the same name here. */
const aliasKey = (name: string) => normalizeText(name).replace(/\s+/g, ' ');

/** Same name for the purpose of a rename: trimmed, exact. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
    return (a ?? '').trim() === (b ?? '').trim();
}

/**
 * The contact entries after renaming `from` → `to`: the rename aliases equal
 * to the new name go (it is the name again), and the old name is ALWAYS left
 * as a rename alias (unless empty or the same name): an existing plain alias
 * with that value is upgraded to one — so nobody who could delete a plain
 * alias (its contributor) can erase the old name — else one is added.
 * `changed`: the list differs from the input.
 */
export function renameEntries(
    entries: readonly ContactEntry[],
    opts: { from: string | null | undefined; to: string; actor: string; newId: string },
): { entries: ContactEntry[]; aliasKept: boolean; changed: boolean } {
    const from = (opts.from ?? '').trim();
    const toKey = aliasKey(opts.to.trim());
    const kept = entries.filter(e => !(isRenameAlias(e) && aliasKey(e.value) === toKey));
    let changed = kept.length !== entries.length;
    const fromKey = from ? aliasKey(from) : null;
    if (!fromKey || fromKey === toKey) return { entries: kept, aliasKept: false, changed };
    const idx = kept.findIndex(e => e.type === 'alias' && aliasKey(e.value) === fromKey);
    if (idx >= 0) {
        if (isRenameAlias(kept[idx])) return { entries: kept, aliasKept: true, changed };
        const out = kept.map((e, i) => (i === idx ? { ...e, fromRename: true as const } : e));
        return { entries: out, aliasKept: true, changed: true };
    }
    changed = true;
    return {
        entries: [...kept, { id: opts.newId, type: 'alias', value: from, addedBy: opts.actor, fromRename: true }],
        aliasKept: true,
        changed,
    };
}

/** «Conocido/a como»: the previous names a rename kept, never the current name. */
export function knownAsNames(entries: readonly ContactEntry[], currentName: string | null | undefined): string[] {
    const current = (currentName ?? '').trim() ? aliasKey((currentName ?? '').trim()) : null;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of entries) {
        if (!isRenameAlias(e)) continue;
        const k = aliasKey(e.value);
        if (k === current || seen.has(k)) continue;
        seen.add(k);
        out.push(e.value.trim());
    }
    return out;
}

export type NameChange = { from: string | null; to: string | null; aliasKept?: boolean; undoOf?: string };

/** The `name_changed` part of a history row's changes (JSON string or object), or null. */
export function parseNameChange(changes: unknown): NameChange | null {
    let c: unknown = changes;
    if (typeof c === 'string') {
        try { c = JSON.parse(c); } catch { return null; }
    }
    if (!c || typeof c !== 'object') return null;
    const n = (c as { name_changed?: unknown }).name_changed;
    if (!n || typeof n !== 'object') return null;
    const r = n as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
        from: str(r.from), to: str(r.to),
        ...(r.aliasKept === true ? { aliasKept: true } : {}),
        ...(typeof r.undoOf === 'string' && r.undoOf ? { undoOf: r.undoOf } : {}),
    };
}

/**
 * The one rename «Deshacer» is offered on: the newest name change, when it is
 * a rename (not an undo) whose new name is still the profile's name. Rows are
 * in any order; `changedAt` decides (ties: later in the list is newer only if
 * the list is oldest-first — callers pass the page's newest-first list).
 */
export function undoableRenameId(
    history: ReadonlyArray<{ id: string; changes?: unknown; changedAt?: unknown }>,
    currentName: string | null | undefined,
): string | null {
    let newest: { id: string; change: NameChange; at: number } | null = null;
    for (const h of history) {
        const change = parseNameChange(h.changes);
        if (!change) continue;
        const at = toMillis(h.changedAt);
        if (!newest || at > newest.at) newest = { id: h.id, change, at };
    }
    if (!newest || newest.change.undoOf) return null;
    return sameName(newest.change.to, currentName) ? newest.id : null;
}

function toMillis(v: unknown): number {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v > 1e11 ? v : v * 1000;
    if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n > 1e11 ? n : n * 1000;
        const t = Date.parse(v);
        return Number.isNaN(t) ? 0 : t;
    }
    return 0;
}

/** A valid age: an integer 0–120. */
export function isValidAge(age: unknown): age is number {
    return typeof age === 'number' && Number.isInteger(age) && age >= 0 && age <= MAX_AGE;
}

/** Today as `YYYY-MM-DD` in UTC — what `currentAge` parses. */
export function utcDay(today: Date = new Date()): string {
    return today.toISOString().slice(0, 10);
}

/**
 * The stored columns for an age as told today. With an age the box follows it
 * (auto and locked: under 18 → minor, 18 or more → not); with no age the box
 * («Es menor de edad») decides.
 */
export function ageColumns(age: number | null, isMinorBox: boolean, today: Date = new Date()): { age: number | null; ageAsOf: string | null; isMinor: 0 | 1 } {
    if (age === null) return { age: null, ageAsOf: null, isMinor: isMinorBox ? 1 : 0 };
    return { age, ageAsOf: utcDay(today), isMinor: age < MINOR_AGE_LIMIT ? 1 : 0 };
}

/** The `?undoRename=` query the email «Deshacer» opens on the profile (a confirmation, never an action). */
export const UNDO_RENAME_PARAM = 'undoRename';

/**
 * A notification's «Deshacer» target, from its metadata (object or JSON
 * string): the rename's history id and the profile, or null when the notice
 * carries no undo.
 */
export function renameUndoOf(metadata: unknown): { historyId: string; profileId: string } | null {
    let m: unknown = metadata;
    if (typeof m === 'string') {
        try { m = JSON.parse(m); } catch { return null; }
    }
    if (!m || typeof m !== 'object') return null;
    const r = m as { undo?: { historyId?: unknown }; profileId?: unknown; adopterId?: unknown };
    const historyId = r.undo && typeof r.undo === 'object' ? r.undo.historyId : null;
    const profileId = typeof r.profileId === 'string' ? r.profileId : typeof r.adopterId === 'string' ? r.adopterId : null;
    if (typeof historyId !== 'string' || !historyId || !profileId) return null;
    return { historyId, profileId };
}

/** The path the email «Deshacer» links to: the profile, with the confirmation prompt open. */
export function renameUndoPath(metadata: unknown): string | null {
    const u = renameUndoOf(metadata);
    return u ? `/adopter/${encodeURIComponent(u.profileId)}?${UNDO_RENAME_PARAM}=${encodeURIComponent(u.historyId)}` : null;
}

/** What the profile header shows about a person's identity (computed on the server: one clock, no hydration drift). */
export type ProfileIdentityView = {
    /** «Conocido/a como»: names a rename kept. */
    knownAs: string[];
    /** The age today (counted up from when it was told), or null. */
    age: number | null;
    /** «Menor de edad» (a known age decides; the box only with no age). */
    isMinor: boolean;
    /** The stored «Es menor de edad» box (what the editor starts from when there's no age). */
    minorBox: boolean;
};

export function profileIdentityView(
    p: { name?: string | null; age?: number | null; ageAsOf?: string | null; isMinor?: number | boolean | null },
    entries: readonly ContactEntry[],
    today: Date = new Date(),
): ProfileIdentityView {
    return { knownAs: knownAsNames(entries, p.name), age: currentAge(p, today), isMinor: isMinor(p, today), minorBox: !!p.isMinor };
}

/**
 * `base` with every one of `renameAliases` in it: one already there as a plain
 * alias (same name, case/accents aside) is marked a rename alias in place;
 * one missing is appended. Never drops anything from `base`.
 */
export function withRenameAliases<T extends ContactEntry>(base: readonly T[], renameAliases: readonly ContactEntry[]): Array<T | ContactEntry> {
    const out: Array<T | ContactEntry> = [...base];
    for (const a of renameAliases) {
        if (!isRenameAlias(a)) continue;
        const k = aliasKey(a.value);
        const idx = out.findIndex(e => e.type === 'alias' && aliasKey(e.value) === k);
        if (idx < 0) out.push(a);
        else if (!isRenameAlias(out[idx])) out[idx] = { ...out[idx], fromRename: true as const };
    }
    return out;
}

/**
 * THE rule for every write that replaces a profile's contact list wholesale
 * (contract overwrite, unmerge restore, …): the previous list's rename aliases
 * — the names a rename kept so search still finds them — are carried into the
 * new one. Without it, any such write silently makes an old name unfindable.
 */
export function preserveRenameAliases<T extends ContactEntry>(prev: readonly ContactEntry[], next: readonly T[]): Array<T | ContactEntry> {
    return withRenameAliases(next, prev.filter(isRenameAlias));
}
