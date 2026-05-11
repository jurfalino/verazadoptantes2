/**
 * Slug generation for shareable public URLs (v2.14.10).
 *
 * Used by:
 *   - `organizations.slug` (`/org/[slug]` showcase URL)
 *   - `user_profiles.handle` (`/user/[handle]` showcase URL)
 *
 * Collision strategy: append an integer (`-2`, `-3`, ...). NO HASH.
 * The first "Gatitos de Olivos" gets `gatitos-de-olivos`. A second one
 * (if it ever happens) gets `gatitos-de-olivos-2`. Caller supplies an
 * `exists(slug)` lookup that returns `true` if the candidate is already
 * taken; the helper increments until it finds a free one.
 *
 * Worst-case loop iterations: number of existing rows with the same name
 * (in practice ≤ a handful). Each iteration is a single DB query.
 */

/**
 * Normalize a raw name into a slug-shaped string. Public for tests and
 * for the migration backfill that needs deterministic SQL parity.
 *
 *  - Lowercase
 *  - NFD-decompose then strip combining marks (removes accents)
 *  - Replace non-alphanumeric with single hyphens
 *  - Trim leading/trailing hyphens
 *  - Cap length at 60 chars (well below most DB index limits)
 */
export function normalizeToSlug(raw: string): string {
    const base = (raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')    // strip combining accents (NFD diacritics block)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')        // any run of non-alphanumeric → single -
        .replace(/^-+|-+$/g, '')            // trim edges
        .slice(0, 60);
    // Edge case: completely empty / non-ASCII input → fallback so the
    // unique constraint doesn't get hit by multiple empty strings.
    return base || 'untitled';
}

/**
 * Generate a unique slug from a raw name, incrementing an integer
 * suffix as needed until the supplied `exists` lookup returns false.
 *
 * @param raw    Source name (e.g. org name, user display name).
 * @param exists Async predicate returning true when the candidate slug
 *               is already taken in the relevant table.
 */
export async function generateUniqueSlug(
    raw: string,
    exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
    const base = normalizeToSlug(raw);
    let candidate = base;
    let suffix = 2;
    // Hard upper bound on iterations as a safety net against runaway loops
    // if the `exists` predicate misbehaves. 1000 is unreachable in practice.
    for (let i = 0; i < 1000; i++) {
        if (!(await exists(candidate))) return candidate;
        candidate = `${base}-${suffix}`;
        suffix++;
    }
    // Shouldn't happen; fall back to a timestamp-stamped slug rather than
    // throwing so the caller doesn't crash on a bizarre input.
    return `${base}-${Date.now()}`;
}
