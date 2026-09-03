/**
 * Household / family members — structured serialization.
 *
 * Replaces the free-text `adopters.family_members` with structured people, each
 * carrying a name, a relationship, and their OWN contact entries (same shape as
 * the titular adopter's). Stored as JSON in the `adopters.household_members`
 * column. Pure — safe on client or server; reuses `deserializeContactEntries`
 * for each member's entries so all entry-level sanitization/id/social-platform
 * logic is shared. See .agents/plans/2026-08-26-household-members-redesign.md.
 */

import { deserializeContactEntries, type ContactEntry } from './contactEntries';

export type Relationship =
    | 'partner' | 'child' | 'parent' | 'sibling' | 'other_relative' | 'housemate' | 'unknown';

export const RELATIONSHIPS: readonly Relationship[] = [
    'partner', 'child', 'parent', 'sibling', 'other_relative', 'housemate', 'unknown',
];
const REL_SET = new Set<string>(RELATIONSHIPS);

export interface HouseholdMember {
    /** Stable id (client generates on add; assigned deterministically on read for
     *  legacy/backfill rows, persisted on next write — mirrors ContactEntry.id). */
    id: string;
    /** May be '' when only a relationship + contacts are known ("the son, phone X"). */
    name: string;
    relationship: Relationship | null;
    /** Same shape + sanitization as the titular's contacts. */
    contactEntries: ContactEntry[];
    /** Contributor attribution (collaborative-vetting model); undefined for legacy. */
    addedBy?: string;
}

export const MAX_MEMBERS = 30;
const MAX_NAME_LEN = 200;

/**
 * Deterministic fallback id for a member that lacks one (legacy/backfill). Both
 * client and server derive the SAME id for the same (name, relationship, index)
 * so per-member update/remove round-trips before the row is rewritten with a
 * real id. Format `hm-<8hex>-<8hex>` (distinct from crypto.randomUUID output).
 */
function deriveMemberId(name: string, relationship: string, index: number): string {
    const key = `${name}|${relationship}|${index}`;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < key.length; i++) {
        const ch = key.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const a = (h1 >>> 0).toString(16).padStart(8, '0');
    const b = (h2 >>> 0).toString(16).padStart(8, '0');
    return `hm-${a}-${b}`;
}

/** A member is worth persisting when it carries a name, a relationship, or a contact. */
export function isMeaningfulMember(m: { name?: string; relationship?: unknown; contactEntries?: unknown }): boolean {
    return (
        (typeof m.name === 'string' && m.name.trim().length > 0) ||
        (typeof m.relationship === 'string' && REL_SET.has(m.relationship)) ||
        (Array.isArray(m.contactEntries) && m.contactEntries.length > 0)
    );
}

/**
 * Parse the JSON stored in `adopters.household_members` → sanitized members.
 * Returns [] on bad data. Bounds member count + name length; drops empty members;
 * assigns a stable id where missing; validates the relationship enum; delegates
 * each member's entries to `deserializeContactEntries`.
 */
export function deserializeHouseholdMembers(json: string | null | undefined): HouseholdMember[] {
    if (!json) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return []; }
    if (!Array.isArray(parsed)) return [];
    const out: HouseholdMember[] = [];
    for (let i = 0; i < parsed.length && out.length < MAX_MEMBERS; i++) {
        const m = parsed[i] as Record<string, unknown> | null;
        if (!m || typeof m !== 'object') continue;
        const name = typeof m.name === 'string' ? m.name.slice(0, MAX_NAME_LEN) : '';
        const relationship: Relationship | null =
            typeof m.relationship === 'string' && REL_SET.has(m.relationship)
                ? (m.relationship as Relationship) : null;
        const contactEntries = deserializeContactEntries(
            Array.isArray(m.contactEntries) ? JSON.stringify(m.contactEntries) : null,
        );
        if (!isMeaningfulMember({ name, relationship, contactEntries })) continue;
        const id = typeof m.id === 'string' && m.id.trim()
            ? m.id
            : deriveMemberId(name, relationship ?? '', i);
        const member: HouseholdMember = { id, name: name.trim(), relationship, contactEntries };
        if (typeof m.addedBy === 'string' && m.addedBy.trim()) member.addedBy = m.addedBy.slice(0, 256);
        out.push(member);
    }
    return out;
}

/** Serialize members for storage — drops empty members, caps count, stringifies. */
export function serializeHouseholdMembers(members: HouseholdMember[] | null | undefined): string {
    if (!members || members.length === 0) return '[]';
    const clean = members
        .filter(isMeaningfulMember)
        .slice(0, MAX_MEMBERS)
        .map(m => ({
            id: m.id,
            name: (m.name || '').trim().slice(0, MAX_NAME_LEN),
            relationship: m.relationship && REL_SET.has(m.relationship) ? m.relationship : null,
            contactEntries: m.contactEntries ?? [],
            ...(m.addedBy ? { addedBy: m.addedBy } : {}),
        }));
    return JSON.stringify(clean);
}

/**
 * Best-effort parse of the legacy free-text `family_members` into structured
 * members (name only). Powers the manual "Convertir a personas" affordance —
 * NOT an automatic migration (prose like "vive con su madre y 2 gatos" should be
 * reviewed, not mangled). Splits on line breaks / ; / , ; dedupes by lowercased
 * name; each fragment → a member with name, no relationship, no contacts.
 */
export function parseLegacyFamilyText(text: string | null | undefined): HouseholdMember[] {
    if (!text || !text.trim()) return [];
    const out: HouseholdMember[] = [];
    const seen = new Set<string>();
    for (const raw of text.split(/[\n;,]+/)) {
        const name = raw.trim();
        if (name.length < 2) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: deriveMemberId(name, '', out.length), name: name.slice(0, MAX_NAME_LEN), relationship: null, contactEntries: [] });
        if (out.length >= MAX_MEMBERS) break;
    }
    return out;
}
