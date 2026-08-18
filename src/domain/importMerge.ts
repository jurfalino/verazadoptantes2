/**
 * Pure merge planner for duplicate-aware spreadsheet import (design:
 * duplicate-aware-import). Given an EXISTING adopter (name, contact entries,
 * prior activities) and an INCOMING import row, decides — with no DB/lib/server
 * imports — exactly what additive changes to apply when the user chooses
 * "actualizar" (upsert) on a high-confidence match:
 *
 *   - contactsToAdd: incoming contact entries the existing record doesn't have
 *     yet (dedup by type + normalized value; phones by last-8 digits).
 *   - addActivity:   true unless an equivalent activity already exists (same
 *     recordType + date + normalized details) — makes re-importing idempotent.
 *   - nameAction:    'fill'  → existing name is empty, set it to the incoming name;
 *                    'alias' → existing has a different name, add incoming as an
 *                              alias contact entry (never overwrite an existing name);
 *                    'none'  → no incoming name, or same as existing.
 *
 * Never destructive: it only adds. Rating is intentionally NOT handled here —
 * avgRating derives from the activities, so adding the activity updates it.
 */

export type MergeContact = { type: string; value: string; streetAndNumber?: string; locality?: string };
export interface MergeActivity { recordType?: string | null; date?: string | null; details?: string | null }

export interface RecordMergePlan {
    contactsToAdd: MergeContact[];
    addActivity: boolean;
    nameAction: 'fill' | 'alias' | 'none';
    /** The name to fill or add as an alias (set when nameAction !== 'none'). */
    nameValue?: string;
}

/** Lowercase, strip accents, collapse whitespace. */
function norm(s: string | null | undefined): string {
    return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A comparable key for a contact value: phones by last-8 digits (area-code
 *  agnostic, matching the tokenizer), everything else by normalized text. */
function contactKey(type: string, value: string): string {
    if (type === 'phone') {
        const digits = (value.match(/\d/g) ?? []).join('');
        return `phone:${digits.length >= 8 ? digits.slice(-8) : digits}`;
    }
    return `${type}:${norm(value)}`;
}

/** Signature used to detect an already-present equivalent activity. */
function activityKey(a: MergeActivity): string {
    return `${norm(a.recordType) || 'adoption'}|${(a.date ?? '').trim()}|${norm(a.details)}`;
}

export interface PlanRecordMergeInput {
    existingName: string | null | undefined;
    existingEntries: MergeContact[];
    existingActivities: MergeActivity[];
    incomingName: string | null | undefined;
    incomingEntries: MergeContact[];
    incomingActivity: MergeActivity;
}

export function planRecordMerge(input: PlanRecordMergeInput): RecordMergePlan {
    // Contacts the existing record lacks. 'alias'/'other' entries are name-like /
    // freeform and not deduped as contact identifiers, but still added if new.
    const existingKeys = new Set(input.existingEntries.map(e => contactKey(e.type, e.value)));
    const seen = new Set<string>();
    const contactsToAdd: MergeContact[] = [];
    for (const e of input.incomingEntries) {
        if (!e.value?.trim()) continue;
        const k = contactKey(e.type, e.value);
        if (existingKeys.has(k) || seen.has(k)) continue;
        seen.add(k);
        contactsToAdd.push(e);
    }

    // Activity: skip if an equivalent one already exists (idempotent re-import).
    const existingActivityKeys = new Set(input.existingActivities.map(activityKey));
    const addActivity = !existingActivityKeys.has(activityKey(input.incomingActivity));

    // Name.
    let nameAction: RecordMergePlan['nameAction'] = 'none';
    let nameValue: string | undefined;
    const incoming = input.incomingName?.trim();
    if (incoming) {
        if (!input.existingName?.trim()) {
            nameAction = 'fill';
            nameValue = incoming;
        } else if (norm(input.existingName) !== norm(incoming)) {
            nameAction = 'alias';
            nameValue = incoming;
        }
    }

    return { contactsToAdd, addActivity, nameAction, nameValue };
}

/** Token types that represent an EXACT identifier match (safe to auto-update).
 *  A name-only or address-only overlap is NOT exact — it must be reviewed. */
const EXACT_IDENTIFIER_TOKENS = new Set(['phone', 'phone_suffix', 'email', 'id_number', 'social']);

export function isExactIdentifierMatch(matchTypes: string[] | null | undefined): boolean {
    return Array.isArray(matchTypes) && matchTypes.some(t => EXACT_IDENTIFIER_TOKENS.has(t));
}
