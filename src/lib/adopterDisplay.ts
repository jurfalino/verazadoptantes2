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
