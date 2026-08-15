/**
 * Minimum-identifiability rule for nameless adopter profiles (design:
 * nameless-adopter-profiles). A record needs a name OR at least one contact
 * (phone/email/social/id/address). Pure — no DB/lib imports; parses the
 * contactEntries JSON defensively so it can run in Zod refines and the import
 * validator. `address` counts (a physical address identifies a household — e.g.
 * VANA blacklist entries known only by address); it must stay in sync with the
 * import's client-side `validateMappedRow`, which also treats addresses as
 * contact, so a row can't pass the grid then get rejected server-side.
 */
const CONTACT_TYPES = new Set(['phone', 'email', 'social', 'id', 'address']);

export function hasAnyContact(
    contactEntriesJson: string | null | undefined,
    contactInfo?: string | null,
): boolean {
    if (contactInfo && contactInfo.trim()) return true;
    if (!contactEntriesJson) return false;
    try {
        const arr = JSON.parse(contactEntriesJson);
        if (!Array.isArray(arr)) return false;
        return arr.some(
            (e) => e && typeof e === 'object' && CONTACT_TYPES.has((e as { type?: string }).type ?? '')
                && !!(e as { value?: string }).value?.trim(),
        );
    } catch {
        return false;
    }
}

export function hasMinimumIdentifier(input: {
    name?: string | null;
    contactEntries?: string | null;
    contactInfo?: string | null;
}): boolean {
    if (input.name?.trim()) return true;
    return hasAnyContact(input.contactEntries, input.contactInfo);
}
