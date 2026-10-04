/**
 * Two teammates editing the same group's adoption docs — pure decisions.
 * (Server: src/app/actions/adoptionDocs.ts + src/lib/adoptionDocsRepo.ts.
 * Editor: src/app/settings/adoption-docs/page.tsx.)
 *
 * A save carries only what this editor changed — contract sections 2–4 or
 * form-question toggles — each with the REVISION it was loaded at. Per item:
 *   - the server's revision is still the loaded one → written;
 *   - my new value already equals the server's → nothing to write, counts as saved;
 *   - anything else → not written: a per-item conflict (their text + who).
 * Items someone else changed that I didn't touch come back so the editor can
 * show their version («Actualizada por …»).
 *
 * Revisions are derived from content, so no schema change was needed: a
 * section's revision is a hash of its text as a save would store it ('std' for
 * the standard text — absent and equal-to-standard are the same thing), a
 * question's is just 'hidden' / 'shown'. Both survive the immutable contract
 * versioning untouched: a save still creates a new version.
 */
import { TOGGLEABLE_FORM_STEPS, canonicalSectionsJson, type ContractSections, type RichDoc, type SectionKey } from './adoptionDocs';
import { sectionsToSave } from './standardContractText';

export const STANDARD_REVISION = 'std';

export type StepState = 'hidden' | 'shown';

/** The text a revision is a hash of: the section as a save would store it, or null for the standard text. */
export function sectionRevisionText(key: SectionKey, doc: RichDoc | null | undefined): string | null {
    if (!doc) return null;
    const stored = sectionsToSave({ [key]: doc })[key];
    return stored ? canonicalSectionsJson({ [key]: stored }) : null;
}

/** The section as a save stores it — null when it equals (or is) the standard text. */
export function storedSection(key: SectionKey, doc: RichDoc | null | undefined): RichDoc | null {
    if (!doc) return null;
    return sectionsToSave({ [key]: doc })[key] ?? null;
}

export function stepStates(hidden: readonly string[]): Record<string, StepState> {
    const set = new Set(hidden);
    const out: Record<string, StepState> = {};
    for (const id of TOGGLEABLE_FORM_STEPS) out[id] = set.has(id) ? 'hidden' : 'shown';
    return out;
}

export type ItemChange<K extends string, V> = { key: K; value: V; newRev: string; expectedRev: string };

export type ItemPlan<K extends string> = {
    /** Written by this save. */
    apply: K[];
    /** Already equal to what is stored — nothing to write, reported as saved. */
    alreadySaved: K[];
    /** Someone else changed it since it was loaded — not written. */
    conflicts: K[];
};

/** The per-item revision check. Pure; the server runs it against the CURRENT revisions it just read. */
export function planItemSave<K extends string, V>(
    current: Record<K, string>,
    changes: ReadonlyArray<ItemChange<K, V>>,
): ItemPlan<K> {
    const plan: ItemPlan<K> = { apply: [], alreadySaved: [], conflicts: [] };
    const seen = new Set<K>();
    for (const c of changes) {
        if (seen.has(c.key)) continue; // one change per item; the first wins
        seen.add(c.key);
        if (c.newRev === current[c.key]) plan.alreadySaved.push(c.key);
        else if (c.expectedRev === current[c.key]) plan.apply.push(c.key);
        else plan.conflicts.push(c.key);
    }
    return plan;
}

/** Items whose stored revision moved since this editor loaded them, and that this save did not try to change. */
export function changedByOthers<K extends string>(
    loaded: Partial<Record<K, string>>,
    current: Record<K, string>,
    mine: ReadonlyArray<K>,
): K[] {
    const touched = new Set(mine);
    return (Object.keys(current) as K[]).filter(k => !touched.has(k) && loaded[k] !== undefined && loaded[k] !== current[k]);
}

/** Current sections with only the applied items replaced (null = back to the standard text). */
export function mergeSections(
    current: ContractSections,
    applied: ReadonlyArray<{ key: SectionKey; doc: RichDoc | null }>,
): ContractSections {
    const next: ContractSections = { ...current };
    for (const a of applied) {
        if (a.doc) next[a.key] = a.doc;
        else delete next[a.key];
    }
    return sectionsToSave(next);
}

/** Current hidden list with only the applied toggles changed, in form order. */
export function mergeHidden(current: readonly string[], applied: ReadonlyArray<{ key: string; hidden: boolean }>): string[] {
    const set = new Set(current);
    for (const a of applied) { if (a.hidden) set.add(a.key); else set.delete(a.key); }
    return TOGGLEABLE_FORM_STEPS.filter(id => set.has(id));
}

/** One revision snapshot in an owner's history, newest first. */
export type HistoryEntry = { sections: ContractSections; by: string | null };

/**
 * Who introduced the CURRENT text of a section: walking the owner's history
 * newest → oldest, the author of the oldest entry in the unbroken run that
 * still has today's text. Null when the history doesn't reach (cleaned up).
 */
export function sectionAuthor(key: SectionKey, history: ReadonlyArray<HistoryEntry>): string | null {
    if (!history.length) return null;
    const textOf = (e: HistoryEntry) => sectionRevisionText(key, e.sections[key]);
    const now = textOf(history[0]);
    let author = history[0].by;
    for (let i = 1; i < history.length; i++) {
        if (textOf(history[i]) !== now) break;
        author = history[i].by;
    }
    return author;
}

/**
 * Who last set a question to its current state, from the form-save audit
 * rows (newest first) that record `changedSteps`. Null when none does.
 */
export function stepAuthor(
    step: string,
    state: StepState,
    rows: ReadonlyArray<{ by: string | null; changedSteps: ReadonlyArray<{ id: string; hidden: boolean }> }>,
): string | null {
    for (const r of rows) {
        const c = r.changedSteps.find(s => s.id === step);
        if (c) return (c.hidden ? 'hidden' : 'shown') === state ? r.by : null;
    }
    return null;
}

