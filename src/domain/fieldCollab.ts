/**
 * Field-level collision protection for everyday record edits (adopter profile,
 * animal identity, adoption / event records) — the same rules as the custom
 * adoption docs (src/domain/adoptionDocsCollab.ts), per FIELD:
 *
 *   - The server decides what changed by comparing the payload with what the
 *     form LOADED — never trusting the client to say. A field equal to its
 *     loaded value is not a change, so a stale tab never reverts a teammate's
 *     edit to a field this editor didn't touch.
 *   - A changed field is written only if the stored value still equals the
 *     loaded one; if it already equals mine it counts as saved; otherwise it is
 *     a per-field conflict (their value + who).
 *   - Fields someone else changed that this editor didn't → reported, so the
 *     form refreshes them («Actualizado por …»).
 *
 * Everything hinges on canonField: two representations of the same value must
 * canonicalize equally (or every save is a false conflict), and two different
 * values must not (or a real change is silently skipped).
 */
import { planItemSave, changedByOthers, type ItemPlan } from './adoptionDocsCollab';

export type FieldKind = 'text' | 'flag' | 'tristate' | 'number' | 'date';

/** How each editable field is compared. Unknown fields are compared as text. */
export const FIELD_KINDS: Record<string, FieldKind> = {
    // adopter profile
    name: 'text', status: 'text', familyMembers: 'text',
    // animal identity
    animalName: 'text', species: 'text', details: 'text', age: 'text', sex: 'text', color: 'text',
    microchip: 'text', sourceUrl: 'text', estimatedBirthDate: 'date', neutered: 'tristate',
    // placement / event
    rating: 'number', date: 'date', onBehalfOf: 'text', comments: 'text', verifiedAddress: 'text',
    deliveredToHome: 'flag', identityVerified: 'flag', recordType: 'text', adopterId: 'text',
};

/** Epoch SECONDS from a Date, seconds, milliseconds or an ISO / numeric string. */
function toEpochSeconds(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : Math.floor(v.getTime() / 1000);
    if (typeof v === 'number') return Number.isFinite(v) ? Math.floor(Math.abs(v) > 1e11 ? v / 1000 : v) : null;
    if (typeof v === 'string') {
        const trimmed = v.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) return toEpochSeconds(Number(trimmed));
        const t = Date.parse(trimmed);
        return Number.isNaN(t) ? null : Math.floor(t / 1000);
    }
    return null;
}

/** The comparable form of a field's value. Same meaning ⇔ same string. */
export function canonField(field: string, v: unknown): string {
    const kind = FIELD_KINDS[field] ?? 'text';
    let out: unknown;
    switch (kind) {
        case 'text': {
            const s = v === null || v === undefined ? '' : String(v).trim();
            out = s === '' ? null : s;
            break;
        }
        case 'flag':
            out = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
            break;
        case 'tristate':
            // null = unknown, which is NOT «no» (0).
            out = v === null || v === undefined || v === '' ? null : (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
            break;
        case 'number': {
            const n = v === null || v === undefined || v === '' ? null : Number(v);
            out = n === null || Number.isNaN(n) ? null : n;
            break;
        }
        case 'date':
            out = toEpochSeconds(v);
            break;
    }
    return JSON.stringify(out);
}

export type FieldPlan = ItemPlan<string> & {
    /** Fields this editor changed (payload ≠ loaded). */
    changed: string[];
    /** Fields someone else changed since load that this editor did not touch. */
    updatedByOthers: string[];
};

/**
 * The per-field decision. `payload` is what the form sent, `loaded` what it
 * had when it opened, `current` what is stored right now (same field names).
 * A payload field with no loaded value is applied unconditionally (callers
 * that don't take part in collision checks).
 */
export function planFieldSave(
    payload: Record<string, unknown>,
    loaded: Record<string, unknown>,
    current: Record<string, unknown>,
): FieldPlan {
    const changed = Object.keys(payload).filter(f => !(f in loaded) || canonField(f, payload[f]) !== canonField(f, loaded[f]));
    const currentRevs: Record<string, string> = {};
    for (const f of new Set([...Object.keys(current), ...changed])) currentRevs[f] = canonField(f, current[f]);
    const unchecked = changed.filter(f => !(f in loaded));
    const checked = changed.filter(f => f in loaded);
    const plan = planItemSave(currentRevs, checked.map(f => ({
        key: f, value: payload[f], newRev: canonField(f, payload[f]), expectedRev: canonField(f, loaded[f]),
    })));
    const loadedRevs: Record<string, string> = {};
    for (const f of Object.keys(loaded)) if (f in current) loadedRevs[f] = canonField(f, loaded[f]);
    return {
        ...plan,
        apply: [...plan.apply, ...unchecked],
        changed,
        updatedByOthers: changedByOthers(loadedRevs, currentRevs, changed).filter(f => f in loaded),
    };
}

/**
 * Fields that only make sense together: if any of `group` conflicts, the
 * others in it that were about to be written are held back as conflicts too.
 */
export function holdTogether(plan: FieldPlan, group: readonly string[]): FieldPlan {
    if (!plan.conflicts.some(f => group.includes(f))) return plan;
    const held = plan.apply.filter(f => group.includes(f));
    return { ...plan, apply: plan.apply.filter(f => !group.includes(f)), conflicts: [...plan.conflicts, ...held] };
}

/**
 * Who last set `field`, from history rows (newest first) that list the fields
 * each save changed. Null when no row says — the UI then names «otra persona
 * del equipo» instead of guessing.
 */
export function fieldAuthor(field: string, rows: ReadonlyArray<{ by: string | null; fields: readonly string[] }>): string | null {
    for (const r of rows) if (r.fields.includes(field)) return r.by;
    return null;
}

/** Message prefix of the error a save throws after losing the race twice. */
export const SAVE_BUSY = 'SAVE_BUSY';

/** Did this save fail only because someone else was saving at the same moment? */
export function isSaveBusyError(e: unknown): boolean {
    return e instanceof Error && e.message.startsWith(SAVE_BUSY);
}
