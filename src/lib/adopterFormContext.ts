import { adopters, animals, notifications } from '@/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { chunk, D1_IN_CHUNK } from '@/lib/chunk';
import { formLinkKind, type AdopterFormRow } from '@/domain/formLink';

/** Epoch seconds from a Drizzle timestamp (Date server-side, number in some paths). */
function toEpochSeconds(v: Date | number | null | undefined): number {
    if (v instanceof Date) return Math.floor(v.getTime() / 1000);
    return typeof v === 'number' ? v : 0;
}

/**
 * What /my-adopters needs beyond the form rows themselves: for the viewer's
 * own forms still on their auto-created profile, how many recorded matches
 * are alive (drives "Por revisar"), and the names of the animals people
 * applied for. Both lookups only touch the forms that need them, chunked
 * under D1's bound-parameter cap; each degrades to "unknown" with a warn.
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

    // Only the viewer's forms still on their new profile can need review.
    const reviewable = forms.filter(f => f.userId === viewerEmail && formLinkKind(f) === 'new_profile').map(f => f.id);
    const matchIdsBySubmission = new Map<string, string[]>();
    for (const idChunk of chunk(reviewable, D1_IN_CHUNK)) {
        const inList = sql.join(idChunk.map((id) => sql`${id}`), sql`, `);
        const rows = await db.select({ metadata: notifications.metadata })
            .from(notifications)
            .where(and(
                eq(notifications.userId, viewerEmail!),
                eq(notifications.type, 'form_submission'),
                sql`json_extract(${notifications.metadata}, '$.submissionId') IN (${inList})`,
            ))
            .all()
            .catch((e: unknown) => {
                logger.warn('getMyAdopters: form-review notification lookup failed', { viewerEmail, error: e instanceof Error ? e.message : String(e) });
                return [];
            }) as Array<{ metadata: string | null }>;
        for (const r of rows) {
            try {
                const meta = r.metadata ? JSON.parse(r.metadata) : {};
                if (meta.submissionId && Array.isArray(meta.matchedAdopters)) {
                    matchIdsBySubmission.set(meta.submissionId, meta.matchedAdopters.map((m: { id: string }) => m.id));
                }
            } catch (e) {
                logger.warn('getMyAdopters: unreadable form notification metadata', { viewerEmail, error: e instanceof Error ? e.message : String(e) });
            }
        }
    }
    const matchIds = [...new Set([...matchIdsBySubmission.values()].flat())];
    const liveIds = new Set<string>();
    for (const idChunk of chunk(matchIds, D1_IN_CHUNK)) {
        const inList = sql.join(idChunk.map((id) => sql`${id}`), sql`, `);
        const rows = await db.select({ id: adopters.id }).from(adopters)
            .where(and(sql`${adopters.id} IN (${inList})`, isNull(adopters.deletedAt)))
            .all()
            .catch((e: unknown) => {
                logger.warn('getMyAdopters: match liveness lookup failed', { viewerEmail, error: e instanceof Error ? e.message : String(e) });
                return [];
            }) as Array<{ id: string }>;
        rows.forEach(r => liveIds.add(r.id));
    }
    const liveMatchCounts = new Map<string, number>();
    for (const [submissionId, ids] of matchIdsBySubmission) {
        liveMatchCounts.set(submissionId, ids.filter(id => liveIds.has(id)).length);
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

    return { formsByAdopter, liveMatchCounts, animalNames };
}
