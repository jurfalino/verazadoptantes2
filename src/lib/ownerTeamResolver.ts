/**
 * Memoised `getTeamEmails` per animal owner, for one request. /my-animals
 * shows many animals from a handful of owners (self + org-mates); resolving
 * each owner's team once keeps the org queries flat instead of per card.
 * Infrastructure (moved from src/app/actions/_applicants, review M10): the
 * data-access layer and src/lib both use it, and src/lib must not import
 * from src/app/actions.
 */
export function createOwnerTeamResolver(): (ownerEmail: string | null | undefined) => Promise<string[]> {
    const cache = new Map<string, Promise<string[]>>();
    return (ownerEmail) => {
        const key = (ownerEmail ?? '').trim().toLowerCase();
        if (!key) return Promise.resolve([]);
        let hit = cache.get(key);
        if (!hit) {
            hit = import('@/lib/orgMembership').then(m => m.getTeamEmails(key));
            cache.set(key, hit);
        }
        return hit;
    };
}
