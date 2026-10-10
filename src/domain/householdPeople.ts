/**
 * The adoption form's "¿Quiénes viven en la casa?" answer (spec:
 * docs/superpowers/specs/2026-10-04-household-people-form-step-design.md).
 * Pure: the server re-parses whatever the public form sends — a forged body
 * must not put junk on a profile or lie about the children count.
 * contract-app mirrors FORM_RELATIONSHIPS (mirror test).
 */
export type FormRelationship = 'partner' | 'child' | 'parent' | 'sibling' | 'other_relative' | 'housemate';
export const FORM_RELATIONSHIPS: readonly FormRelationship[] = ['partner', 'child', 'parent', 'sibling', 'other_relative', 'housemate'];
const REL = new Set<string>(FORM_RELATIONSHIPS);

export interface HouseholdPerson { relationship: FormRelationship; age: number; firstName?: string; lastName?: string }

export const MAX_HOUSEHOLD_PEOPLE = 15;
const MAX_NAME = 60;

function cleanName(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.trim().slice(0, MAX_NAME);
    return s || undefined;
}

export function parseHouseholdPeople(raw: unknown): HouseholdPerson[] {
    if (!Array.isArray(raw)) return [];
    const out: HouseholdPerson[] = [];
    for (const r of raw) {
        if (out.length >= MAX_HOUSEHOLD_PEOPLE) break;
        if (!r || typeof r !== 'object') continue;
        const rec = r as Record<string, unknown>;
        const { relationship, age } = rec;
        if (typeof relationship !== 'string' || !REL.has(relationship)) continue;
        if (typeof age !== 'number' || !Number.isInteger(age) || age < 0 || age > 120) continue;
        const firstName = cleanName(rec.firstName);
        const lastName = cleanName(rec.lastName);
        out.push({
            relationship: relationship as FormRelationship,
            age,
            ...(firstName ? { firstName } : {}),
            ...(lastName ? { lastName } : {}),
        });
    }
    return out;
}

/** The legacy "¿Hay niños?" answer, derived — never trusted from the client. */
export function childrenAnswer(people: readonly HouseholdPerson[]): 'none' | '1' | '2' | '3+' {
    const n = people.filter(p => p.age < 18).length;
    return n === 0 ? 'none' : n === 1 ? '1' : n === 2 ? '2' : '3+';
}

/** Only fully named people become profile household members. */
export function fullName(p: HouseholdPerson): string | null {
    return p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : null;
}
