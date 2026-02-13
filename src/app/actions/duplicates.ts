'use server';

import { adopters, adoptions, duplicateTokens } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { extractTokens, computeTokenHash, type Token } from '@/lib/tokenizer';

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
        if (!adopter || adopter.deletedAt) return;

        // Check if tokens are fresh via hash
        const newHash = computeTokenHash(adopter);
        if (adopter.tokenHash === newHash) return; // Already up to date

        // Fetch this adopter's adoptions (for onBehalfOf tokens)
        const adopterAdoptions = await db.select({
            onBehalfOf: adoptions.onBehalfOf,
        }).from(adoptions).where(eq(adoptions.adopterId, adopterId));

        // Extract tokens
        const tokens: Token[] = extractTokens(adopter, adopterAdoptions);

        // Delete old tokens for this adopter
        await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopterId));

        // Insert new tokens
        if (tokens.length > 0) {
            for (const token of tokens) {
                await db.insert(duplicateTokens).values({
                    id: crypto.randomUUID(),
                    adopterId,
                    tokenType: token.type,
                    tokenValue: token.value,
                });
            }
        }

        // Update the hash
        await db.update(adopters).set({ tokenHash: newHash }).where(eq(adopters.id, adopterId));

    } catch (error) {
        // Fire-and-forget: log but don't throw
        logger.warn('Tokenize adopter failed', {
            adopterId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
