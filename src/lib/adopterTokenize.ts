/**
 * Duplicate-detection tokens for one adopter. A plain server module, NOT
 * 'use server': it takes an adopter id and checks no session, so as an export
 * of src/app/actions/duplicates.ts it was a browser-callable endpoint. Server
 * code (actions, API routes) imports it from here.
 */

import { adopters, adoptions, duplicateTokens } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getDb } from '@/lib/db';
import { extractTokens, computeTokenHash, type Token } from '@/lib/tokenizer';
import { deserializeHouseholdMembers } from '@/lib/householdMembers';
import { deserializeContactEntries } from '@/lib/contactEntries';

/**
 * Tokenize an adopter for duplicate detection.
 * Computes tokens from all fields, compares hash to skip if fresh,
 * then replaces old tokens with new ones.
 * 
 * Designed to be called fire-and-forget after every save/update.
 */
export async function tokenizeAdopter(adopterId: string): Promise<void> {
    try {
        const db = await getDb();
        if (!db) return;

        // Fetch adopter
        const adopter = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        // Skip soft-deleted and walkthrough-demo rows — neither belongs in the
        // duplicate index. (Demo rows are also soft-deleted, so the first check
        // already covers them; the isDemo guard is defensive.)
        if (!adopter || adopter.deletedAt || adopter.isDemo) return;

        // Check if tokens are fresh via hash
        const newHash = computeTokenHash(adopter);
        if (adopter.tokenHash === newHash) return; // Already up to date

        // Fetch this adopter's adoptions (for onBehalfOf tokens)
        const adopterAdoptions = await db.select({
            onBehalfOf: adoptions.onBehalfOf,
        }).from(adoptions).where(eq(adoptions.adopterId, adopterId));

        // Aliases (contactEntries with type='alias') tokenize as name_words so
        // searching for an alternate name finds the adopter.
        const entries = deserializeContactEntries(adopter.contactEntries);
        const aliases = entries.filter(e => e.type === 'alias').map(e => e.value);
        // Structured socials carry `platform` → the tokenizer emits the precise
        // `social`=`platform|handle` token, not just the handle. Mirror the aliases
        // pattern (caller deserializes to avoid the tokenizer→contactEntries cycle).
        const socials = entries.filter(e => e.type === 'social').map(e => ({ value: e.value, platform: e.platform ?? null }));
        // Household members: names + their contacts feed name/phone/email/social/id tokens.
        const household = deserializeHouseholdMembers(adopter.householdMembers).map(m => ({ name: m.name, contactEntries: m.contactEntries }));

        // Extract tokens
        const tokens: Token[] = extractTokens(adopter, adopterAdoptions, aliases, socials, household);

        // Delete old tokens for this adopter
        await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopterId));

        // Insert new tokens in ONE multi-row insert instead of N sequential
        // round-trips (an adopter has 5–15 tokens; this was the dominant cost of
        // bulk import). Chunked to stay under SQLite/D1's bound-parameter limit.
        if (tokens.length > 0) {
            const rows = tokens.map(token => ({
                id: crypto.randomUUID(),
                adopterId,
                tokenType: token.type,
                tokenValue: token.value,
            }));
            // ≤24 rows/insert: 4 columns × 24 = 96 bound params, under D1's ~100-per-
            // query limit. (100 rows = 400 params would fail for records with >25
            // tokens — compound names + many contacts — silently dropping their tokens.)
            for (let i = 0; i < rows.length; i += 24) {
                await db.insert(duplicateTokens).values(rows.slice(i, i + 24));
            }
        }

        // Update the hash
        await db.update(adopters).set({ tokenHash: newHash }).where(eq(adopters.id, adopterId));

    } catch (error) {
        // v2.19.44: tokenize failure is silent data corruption — the
        // surrounding op succeeded but search/dedup will be wrong until
        // the next save. logger.error generates an id so an operator can
        // correlate Axiom entries with user-reported sightings.
        logger.error('Tokenize adopter failed', error, { adopterId });
    }
}
