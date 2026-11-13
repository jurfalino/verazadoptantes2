/**
 * Client read of the public ENABLE_GROUP_BRANDING flag (default off),
 * shared by /organizations and /settings.
 * Zero imports on purpose: those pages must not pull domain modules into
 * their bundles.
 *
 * Throws when /api/config can't be read, so each caller decides how loudly
 * to fail; a flag that is merely absent reads as off.
 */
export async function fetchGroupBrandingFlag(): Promise<boolean> {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`/api/config responded ${res.status}`);
    const cfg = await res.json() as { config?: Record<string, unknown> };
    const v = cfg.config?.ENABLE_GROUP_BRANDING;
    return v === true || v === 'true';
}
