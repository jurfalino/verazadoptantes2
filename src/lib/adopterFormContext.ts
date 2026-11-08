import { animals } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { chunk, D1_IN_CHUNK } from '@/lib/chunk';
import type { AdopterFormRow } from '@/domain/formLink';

/** Epoch seconds from a Drizzle timestamp (Date server-side, number in some paths). */
function toEpochSeconds(v: Date | number | null | undefined): number {
    if (v instanceof Date) return Math.floor(v.getTime() / 1000);
    return typeof v === 'number' ? v : 0;
}

/**
 * What /my-adopters needs beyond the form rows themselves: the rows grouped by
 * person, and the names of the animals people applied for (chunked under D1's
 * bound-parameter cap; degrades to "unknown" with a warn). A form match is an
 * ordinary duplicate pair (spec 2026-11-05), so no match data is read here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Drizzle D1/better-sqlite3 union getDb() returns
export async function loadFormContext(db: any, forms: Array<{ id: string; userId: string; linkedAdopterId: string; autoAdopterId: string | null; createdAt: Date | number | null; selectedAnimalId: string | null }>, viewerEmail: string | undefined) {
    const formsByAdopter = new Map<string, AdopterFormRow[]>();
    for (const f of forms) {
        if (!f.linkedAdopterId) continue;
        const row: AdopterFormRow = {
            id: f.id, userId: f.userId, linkedAdopterId: f.linkedAdopterId, autoAdopterId: f.autoAdopterId,
            submittedAt: toEpochSeconds(f.createdAt), selectedAnimalId: f.selectedAnimalId,
        };
        const list = formsByAdopter.get(f.linkedAdopterId);
        if (list) list.push(row); else formsByAdopter.set(f.linkedAdopterId, [row]);
    }

    const animalIds = [...new Set(forms.map(f => f.selectedAnimalId).filter((id): id is string => !!id))];
    const animalNames = new Map<string, string>();
    for (const idChunk of chunk(animalIds, D1_IN_CHUNK)) {
        const inList = sql.join(idChunk.map((id) => sql`${id}`), sql`, `);
        const rows = await db.select({ id: animals.id, name: animals.name }).from(animals)
            .where(sql`${animals.id} IN (${inList})`)
            .all()
            .catch((e: unknown) => {
                logger.warn('getMyAdopters: applied-for animal lookup failed', { viewerEmail, error: e instanceof Error ? e.message : String(e) });
                return [];
            }) as Array<{ id: string; name: string | null }>;
        rows.forEach(r => { if (r.name) animalNames.set(r.id, r.name); });
    }

    return { formsByAdopter, animalNames };
}
