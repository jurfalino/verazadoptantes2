'use server';

import { getUser } from './_db';
import { replaySearchMatchGrants } from '@/lib/piiAccessServer';
import { logger } from '@/lib/logger';

/**
 * Public server action invoked from <DuplicateHint>'s "View match" button.
 * Inserts the same search-match grants that discovery-mode `findAdopters`
 * writes when a user searches and the query matches the adopter — but
 * triggered explicitly from a duplicate-detection UI rather than implicitly
 * from a discovery search.
 *
 * Rationale (PII model): typing a phone/email/social/id into the new-adopter
 * form or per-entry composer is proof the user knows that identifier. On
 * clicking "View match", we mirror the search-match grant write so the
 * destination profile renders unmasked.
 *
 * Idempotent + quiet-failure — delegates to `replaySearchMatchGrants` which
 * pre-fetches existing grants and skips duplicates, and which logs a warning
 * on write failure rather than throwing. Returns the number of new grant
 * rows written (zero is a legitimate outcome — owner short-circuit, no
 * matches, or all-already-granted).
 */
export async function grantSearchMatchAccess(input: {
    adopterId: string;
    query: string;
}): Promise<{ ok: true; grantsWritten: number } | { ok: false; error: string }> {
    const user = await getUser();
    if (!user) return { ok: false, error: 'unauthenticated' };

    const adopterId = (input.adopterId ?? '').trim();
    const query = (input.query ?? '').trim();
    if (!adopterId || !query) return { ok: false, error: 'invalid_input' };

    try {
        const { written } = await replaySearchMatchGrants({
            adopterId,
            query,
            viewerEmail: user,
            source: 'duplicate_hint',
        });
        return { ok: true, grantsWritten: written };
    } catch (e) {
        const errorId = logger.error('grantSearchMatchAccess failed', {
            adopterId, user,
            error: e instanceof Error ? e.message : String(e),
        });
        return { ok: false, error: `internal_error:${errorId}` };
    }
}
