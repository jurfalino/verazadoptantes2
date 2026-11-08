/**
 * H1: the signed_contracts id behind a record's contract, so the record can
 * open its contract result («Datos y posibles duplicados») without the
 * notice. Server-only. A record without a signed_contracts row (an older
 * contract) gets none and shows only the PDF button.
 *
 * Batched (chunked IN lists, two queries per chunk) — never one query per
 * row on the list pages. Fails open: a failed read logs a warn and the
 * records just show the PDF button.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { placements, signedContracts } from '@/db/schema';
import { chunk, D1_IN_CHUNK } from '@/lib/chunk';
import { logger } from '@/lib/logger';
import { matchSignedContract, type PlacementContractRef, type SignedContractRow } from '@/domain/signedContractMatch';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

const SIGNED_COLS = {
    id: signedContracts.id, animalId: signedContracts.animalId, placementId: signedContracts.placementId,
    fileKey: signedContracts.fileKey, signedAt: signedContracts.signedAt,
    hasTypedData: sql<boolean>`${signedContracts.submittedJson} IS NOT NULL`.mapWith(Boolean),
};

const fallback = <T>(op: string, ctx: Record<string, unknown>) => (e: unknown): T[] => {
    logger.warn(`${op}: D1 fallback hit, records show only the PDF button`, { ...ctx, error: e instanceof Error ? e.message : String(e) });
    return [];
};

const hasStoredContract = (v: number | boolean | null | undefined) => v === 1 || v === true;

/**
 * Rows of the `adoptions` view (id = animal id, hasContract = the ACTIVE
 * placement's stored contract): each one with a contract gets the
 * `signedContractId` of that placement's signature, when there is one.
 * Call it AFTER any gate that zeroes `hasContract` for the viewer.
 */
export async function attachSignedContractIds<T extends { id: string; hasContract?: number | boolean | null }>(
    db: Db, rows: T[], ctx: Record<string, unknown>,
): Promise<Array<T & { signedContractId?: string }>> {
    const animalIds = Array.from(new Set(rows.filter(r => hasStoredContract(r.hasContract)).map(r => r.id)));
    if (animalIds.length === 0) return rows;
    const byAnimal = new Map<string, string>();
    for (const ids of chunk(animalIds, D1_IN_CHUNK)) {
        const inList = sql.join(ids.map(id => sql`${id}`), sql`, `);
        const [active, signed] = await Promise.all([
            (async () => db.select({ id: placements.id, animalId: placements.animalId, contractKey: placements.contractKey }).from(placements)
                .where(and(sql`${placements.animalId} IN (${inList})`, isNull(placements.endedAt), isNotNull(placements.contractKey))).all() as PlacementContractRef[])()
                .catch(fallback<PlacementContractRef>('attachSignedContractIds(placements)', ctx)),
            (async () => db.select(SIGNED_COLS).from(signedContracts).where(sql`${signedContracts.animalId} IN (${inList})`).all() as SignedContractRow[])()
                .catch(fallback<SignedContractRow>('attachSignedContractIds(signed)', ctx)),
        ]);
        for (const p of active) {
            const id = matchSignedContract(p, signed);
            if (id) byAnimal.set(p.animalId, id);
        }
    }
    return rows.map(r => {
        const id = hasStoredContract(r.hasContract) ? byAnimal.get(r.id) : undefined;
        return id ? { ...r, signedContractId: id } : r;
    });
}

/** One animal's placements (the timeline, past ones included): placement id → signedContractId. */
export async function signedContractIdsForPlacements(
    db: Db, animalId: string, spans: PlacementContractRef[], ctx: Record<string, unknown>,
): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!spans.some(p => p.contractKey)) return out;
    const signed = await (async () => db.select(SIGNED_COLS).from(signedContracts).where(eq(signedContracts.animalId, animalId)).all() as SignedContractRow[])()
        .catch(fallback<SignedContractRow>('signedContractIdsForPlacements', { ...ctx, animalId }));
    for (const p of spans) {
        const id = matchSignedContract(p, signed);
        if (id) out.set(p.id, id);
    }
    return out;
}
