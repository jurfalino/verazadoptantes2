/**
 * What the admin «Pedidos de combinación» page needs to show «Qué coincide y
 * qué no» on each request and each disputed merge (audit 2026-10-28, A4):
 * each profile's contacts as typed values, and the pair's match types from the
 * duplicate scan. The admin page shows contacts whole (admins see everything).
 * Server-only module (reads D1); never an action.
 */
import { and, desc, eq, or } from 'drizzle-orm';
import { duplicateCandidates } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { deserializeContactEntries, parseBlobToContactEntries } from '@/lib/contactEntries';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type CompareEntry = { type: string; value: string };

/** A profile's contacts as typed values: its typed list, else the legacy text blob parsed. */
export function compareEntriesOf(p: { contactEntries?: string | null; contactInfo?: string | null } | null | undefined): CompareEntry[] {
    if (!p) return [];
    const typed = p.contactEntries ? deserializeContactEntries(p.contactEntries) : [];
    const list = typed.length > 0 ? typed : parseBlobToContactEntries(p.contactInfo ?? null);
    return list.filter(e => e.value?.trim()).map(e => ({ type: e.type, value: e.value }));
}

/**
 * The match types the duplicate scan recorded for this pair (either
 * orientation, the newest row); [] when the pair was never scanned. A failed
 * read is logged and shows the comparison without them (it still compares the
 * values both sides show).
 */
export async function pairMatchTypes(db: Db, a: string, b: string, ctx: Record<string, unknown>): Promise<string[]> {
    try {
        const row = await db.select({ matchTypes: duplicateCandidates.matchTypes }).from(duplicateCandidates)
            .where(or(
                and(eq(duplicateCandidates.adopter1Id, a), eq(duplicateCandidates.adopter2Id, b)),
                and(eq(duplicateCandidates.adopter1Id, b), eq(duplicateCandidates.adopter2Id, a)),
            ))
            .orderBy(desc(duplicateCandidates.detectedAt)).get();
        if (!row?.matchTypes) return [];
        const parsed: unknown = JSON.parse(row.matchTypes);
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch (e) {
        logger.warn('pairMatchTypes: D1 fallback hit', { ...ctx, error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}
