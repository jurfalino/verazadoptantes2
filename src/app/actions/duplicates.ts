'use server';

import { adopters, adoptions, duplicateTokens, duplicateCandidates } from '@/db/schema';
import { eq, or, and, sql, inArray } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { extractTokens, computeTokenHash, normalizeText, extractPhones, extractEmails, extractSocials, type Token } from '@/lib/tokenizer';

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

export interface DuplicateCandidate {
    id: string;
    otherAdopterId: string;
    otherAdopterName: string;
    matchTypes: string[];
    score: number;
    confidence: string;
}

/**
 * Get pending duplicate candidates for a given adopter.
 * Used by profile banner and flagging pre-population.
 */
export async function getDuplicateCandidates(adopterId: string): Promise<DuplicateCandidate[]> {
    try {
        const db = await getDb();
        if (!db) return [];

        const candidates = await db.select({
            id: duplicateCandidates.id,
            adopter1Id: duplicateCandidates.adopter1Id,
            adopter2Id: duplicateCandidates.adopter2Id,
            matchTypes: duplicateCandidates.matchTypes,
            score: duplicateCandidates.score,
            confidence: duplicateCandidates.confidence,
        })
            .from(duplicateCandidates)
            .where(and(
                eq(duplicateCandidates.status, 'pending'),
                or(
                    eq(duplicateCandidates.adopter1Id, adopterId),
                    eq(duplicateCandidates.adopter2Id, adopterId),
                ),
            ))
            .limit(5);

        if (candidates.length === 0) return [];

        // Get names for the "other" adopter in each pair
        const otherIds = candidates.map((c: { adopter1Id: string; adopter2Id: string }) =>
            c.adopter1Id === adopterId ? c.adopter2Id : c.adopter1Id
        );
        const otherAdopters = await Promise.all(
            otherIds.map((id: string) =>
                db.select({ id: adopters.id, name: adopters.name })
                    .from(adopters)
                    .where(eq(adopters.id, id))
                    .get()
            )
        );
        const nameMap = new Map<string, string>();
        for (const a of otherAdopters) {
            if (a) nameMap.set(a.id, a.name);
        }

        return candidates.map((c: { id: string; adopter1Id: string; adopter2Id: string; matchTypes: string; score: number; confidence: string }) => {
            const otherId = c.adopter1Id === adopterId ? c.adopter2Id : c.adopter1Id;
            return {
                id: c.id,
                otherAdopterId: otherId,
                otherAdopterName: nameMap.get(otherId) || 'Unknown',
                matchTypes: JSON.parse(c.matchTypes || '[]') as string[],
                score: c.score,
                confidence: c.confidence,
            };
        });
    } catch (error) {
        logger.warn('getDuplicateCandidates failed', {
            adopterId,
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}

export interface TokenMatchResult {
    adopterId: string;
    adopterName: string;
    matchTypes: string[];
    score: number;
    confidence: 'high' | 'medium' | 'low';
}

/**
 * Check for duplicate adopters using token-based matching.
 * Extracts tokens from the provided data and queries the token index.
 * Used by import wizard pre-save and real-time field hints.
 */
export async function checkTokenDuplicates(data: {
    name?: string;
    contactInfo?: string;
    phones?: string[];
    emails?: string[];
    socials?: string[];
    addresses?: string[];
}): Promise<TokenMatchResult[]> {
    try {
        const db = await getDb();
        if (!db) {
            logger.warn('checkTokenDuplicates: DB not available');
            return [];
        }

        // Build tokens from the raw data
        const tokens: { type: string; value: string }[] = [];

        if (data.name) {
            const normalized = normalizeText(data.name);
            if (normalized.length >= 3) {
                tokens.push({ type: 'name_full', value: normalized });
                for (const word of normalized.split(/\s+/)) {
                    if (word.length >= 3) tokens.push({ type: 'name_word', value: word });
                }
            }
        }

        // Extract from contactInfo if provided
        const contactText = data.contactInfo || '';
        const phones = data.phones?.length ? data.phones : extractPhones(contactText);
        const emails = data.emails?.length ? data.emails : extractEmails(contactText);
        const socials = data.socials?.length ? data.socials : extractSocials(contactText);

        for (const phone of phones) {
            const digits = phone.replace(/\D/g, '');
            if (digits.length >= 6) {
                tokens.push({ type: 'phone', value: digits });
                tokens.push({ type: 'phone_suffix', value: digits.slice(-8) });
            }
        }
        for (const email of emails) {
            tokens.push({ type: 'email', value: email.toLowerCase().trim() });
        }
        for (const social of socials) {
            tokens.push({ type: 'social', value: social.toLowerCase().trim() });
        }

        if (tokens.length === 0) {
            logger.info('checkTokenDuplicates: no tokens extracted', { name: data.name, hasContactInfo: !!data.contactInfo });
            return [];
        }

        // Query the token index for matches
        // D1 doesn't support IN with large lists well, so query one at a time
        const matchMap = new Map<string, Set<string>>(); // adopterId -> Set<matchType>

        for (const token of tokens) {
            const matches = await db.select({
                adopterId: duplicateTokens.adopterId,
            })
                .from(duplicateTokens)
                .where(and(
                    eq(duplicateTokens.tokenType, token.type),
                    eq(duplicateTokens.tokenValue, token.value),
                ))
                .limit(20);

            for (const m of matches) {
                if (!matchMap.has(m.adopterId)) {
                    matchMap.set(m.adopterId, new Set());
                }
                matchMap.get(m.adopterId)!.add(token.type);
            }
        }

        if (matchMap.size === 0) {
            logger.info('checkTokenDuplicates: no matches found', { tokenCount: tokens.length, name: data.name });
            return [];
        }

        // Fetch adopter names
        const matchedIds = Array.from(matchMap.keys());
        const matchedAdopters = await Promise.all(
            matchedIds.map((id: string) =>
                db.select({ id: adopters.id, name: adopters.name })
                    .from(adopters)
                    .where(eq(adopters.id, id))
                    .get()
            )
        );

        const results: TokenMatchResult[] = [];
        for (const a of matchedAdopters) {
            if (!a) continue;
            const types = Array.from(matchMap.get(a.id) || []);
            // Score: phone/email/social = 3 each, name_full = 2, name_word = 1
            const weights: Record<string, number> = {
                phone: 3, phone_suffix: 2, email: 3, social: 3,
                name_full: 2, name_word: 1, address_word: 1, source_url: 3,
            };
            const score = types.reduce((s, t) => s + (weights[t] || 1), 0);
            const confidence: 'high' | 'medium' | 'low' =
                score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';

            results.push({
                adopterId: a.id,
                adopterName: a.name,
                matchTypes: types,
                score,
                confidence,
            });
        }

        return results.sort((a, b) => b.score - a.score).slice(0, 5);
    } catch (error) {
        logger.warn('checkTokenDuplicates failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}
