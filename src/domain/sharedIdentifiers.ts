/**
 * "Datos compartidos" (Admin → Calidad de datos): a phone, email or document
 * that belongs to more than one live profile. Exactly the people an exact API
 * call can answer `ambiguous` for — and, when the names also fit, the profiles
 * an API activity would be attached to by best match. Pure.
 */
import { namesCompatible } from './apiExactMatch';

export type SharedField = 'phone' | 'email' | 'documentId';
export interface SharedTokenRow { tokenType: string; tokenValue: string; adopterIds: string[] }
export interface SharedIdentifierGroup {
    field: SharedField;
    value: string;
    profiles: Array<{ id: string; name: string }>;
    /** At least two of the profiles carry names that fit each other: likely one person twice. */
    sameName: boolean;
}

const FIELD: Record<string, SharedField | undefined> = { phone: 'phone', phone_suffix: 'phone', email: 'email', id_number: 'documentId' };
/** The exact phone token wins over its 8-digit ending when both name the same profiles. */
const RANK: Record<string, number> = { phone: 0, email: 0, id_number: 0, phone_suffix: 1 };

export function groupSharedIdentifiers(rows: SharedTokenRow[], names: Map<string, string>): SharedIdentifierGroup[] {
    const byKey = new Map<string, { row: SharedTokenRow; field: SharedField }>();
    for (const row of [...rows].sort((a, b) => (RANK[a.tokenType] ?? 2) - (RANK[b.tokenType] ?? 2))) {
        const field = FIELD[row.tokenType];
        const ids = [...new Set(row.adopterIds)].filter(id => names.has(id)).sort();
        if (!field || ids.length < 2) continue;
        const key = `${field}|${ids.join(',')}`;
        if (!byKey.has(key)) byKey.set(key, { row: { ...row, adopterIds: ids }, field });
    }
    const groups: SharedIdentifierGroup[] = [];
    for (const { row, field } of byKey.values()) {
        const profiles = row.adopterIds.map(id => ({ id, name: names.get(id) ?? '' }));
        let sameName = false;
        for (let i = 0; i < profiles.length && !sameName; i++) {
            for (let j = i + 1; j < profiles.length && !sameName; j++) {
                if (namesCompatible(profiles[i].name, profiles[j].name)) sameName = true;
            }
        }
        groups.push({ field, value: row.tokenValue, profiles, sameName });
    }
    // Likely duplicates first (they're the ones to merge), then the biggest groups.
    return groups.sort((a, b) => Number(b.sameName) - Number(a.sameName) || b.profiles.length - a.profiles.length || a.value.localeCompare(b.value));
}
