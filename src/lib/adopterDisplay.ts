/**
 * Nameless-adopter display helpers. An adopter profile may legitimately have no
 * name (name === ''), identified only by contact — see the nameless-profiles
 * design. Use these everywhere the adopter name is shown so the fallback label
 * is consistent and a nameless adopter is never a blank gap.
 */
export function isNamelessAdopter(adopter: { name?: string | null } | null | undefined): boolean {
    return !adopter?.name?.trim();
}

/** The name if present, otherwise `fallbackLabel` (pass the i18n `adopter.nameless`). */
export function adopterDisplayName(
    adopter: { name?: string | null } | null | undefined,
    fallbackLabel: string,
): string {
    return adopter?.name?.trim() || fallbackLabel;
}

/**
 * Best single contact to disambiguate a nameless adopter on NAME-ONLY surfaces.
 * Pass the contactInfo blob ONLY when the viewer has access (unmasked); pass
 * null when masked (a masked hint is useless). Email > phone > first line.
 */
export function namelessSubIdentifier(contactInfo: string | null | undefined): string | null {
    if (!contactInfo || !contactInfo.trim()) return null;
    const lines = contactInfo.split('\n').map((l) => l.trim()).filter(Boolean);
    const val = (prefix: string) => {
        const line = lines.find((l) => l.toLowerCase().startsWith(prefix));
        return line ? line.slice(line.indexOf(':') + 1).trim() || null : null;
    };
    return val('email:') || val('tel:') || (lines[0] ?? null);
}
