/**
 * Client read of the public ENABLE_CUSTOM_ADOPTION_DOCS flag (default off),
 * shared by the /settings card, the editor page and /organizations.
 * Zero imports on purpose: /settings and /organizations must not pull the
 * zod-backed domain module into their bundles.
 *
 * Throws when /api/config can't be read, so each caller decides how loudly
 * to fail; a flag that is merely absent reads as off.
 */
export async function fetchCustomAdoptionDocsFlag(): Promise<boolean> {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`/api/config responded ${res.status}`);
    const cfg = await res.json() as { config?: Record<string, unknown> };
    const v = cfg.config?.ENABLE_CUSTOM_ADOPTION_DOCS;
    return v === true || v === 'true';
}
