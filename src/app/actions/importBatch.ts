'use server';

/**
 * Bulk spreadsheet import — process a batch of rows in ONE server invocation
 * instead of one HTTP request per row. The old flow fired ~800 concurrent
 * POST /api/adopters requests, each inserting an adopter + writing duplicate
 * tokens + running dedup; under sustained concurrency D1 threw transient
 * "database is locked" / rate errors and rows failed en masse ("Failed to
 * fetch"). Here the client sends ~25-row batches at low concurrency; each batch
 * writes SEQUENTIALLY, and every write is wrapped in a transient-error retry —
 * so contention is ridden out server-side (cheap, no network) instead of
 * surfacing as a failed row.
 */

import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, userProfiles, users, importRunItems } from '@/db/schema';
import { deserializeContactEntries, contactEntriesToBlob } from '@/lib/contactEntries';
import { isRealActorEmail } from '@/lib/piiAccess';
import { insertRecord } from './_recordWrite';
import { tokenizeAdopter } from './duplicates';
import { upsertImportRecord } from './importUpsert';
import { logger } from '@/lib/logger';

export interface ImportBatchRow {
    index: number;
    action: 'create' | 'upsert' | 'skip';
    name?: string | null;
    /** JSON ContactEntry[] */
    contactEntries: string;
    adoption: {
        animalName: string | null; species: string | null; recordType: string;
        rating: number | null; date: string | null; details: string | null; onBehalfOf: string | null;
        neutered?: number | null; age?: string | null;
    };
    isPublic?: boolean;
    matchedAdopterId?: string | null;
    matchedAdopterName?: string | null;
    matchConfidence?: number | null;
}
export interface ImportBatchResult {
    index: number;
    status: 'created' | 'updated' | 'skipped' | 'failed';
    id?: string | null;
    message?: string | null;
}

type Db = Awaited<ReturnType<typeof getDb>>;

/** Retry a DB op on TRANSIENT contention (D1 lock/busy/rate). A non-transient
 *  error (e.g. a real constraint violation) fails fast — no point retrying. */
async function withDbRetry<T>(op: () => Promise<T>, tries = 4): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
        try { return await op(); } catch (e) {
            lastErr = e;
            const msg = e instanceof Error ? e.message : String(e);
            if (!/lock|busy|SQLITE_BUSY|timeout|rate|429|503|overloaded/i.test(msg)) throw e;
            await new Promise(r => setTimeout(r, 120 * 2 ** i + Math.floor(Math.random() * 120)));
        }
    }
    throw lastErr;
}

/** A STABLE adopter id derived from (runId, rowIndex): a UUID-shaped string whose
 *  tail encodes the row index. Re-sending a batch after a mid-batch Worker
 *  throw/timeout reuses the same id, so a row that already committed is a no-op
 *  on retry instead of a duplicate adopter — critical for a dedup-focused tool. */
function deterministicAdopterId(runId: string, index: number): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
        return `imp-${runId}-${index}`; // defensive: non-UUID runId
    }
    return runId.slice(0, 28) + index.toString(16).padStart(8, '0').slice(-8);
}

async function createImportedAdopter(db: NonNullable<Db>, actor: string, country: string | null, row: ImportBatchRow, runId: string): Promise<string> {
    const newId = deterministicAdopterId(runId, row.index);
    // Idempotent gate: the adopter's existence marks THIS row (adopter + its one
    // activity) as already done. A re-sent batch (after a mid-batch Worker throw)
    // or a withDbRetry re-run therefore never double-creates — the whole row is
    // skipped. Only tokenization runs unconditionally (it's idempotent — it just
    // regenerates this adopter's tokens — so a row that died before tokenizing on
    // a prior attempt still ends up matchable).
    const existing = await db.select({ id: adopters.id }).from(adopters).where(eq(adopters.id, newId)).get();
    if (!existing) {
        // Re-serialize through deserialize so every entry carries an id (matches
        // the single-create route; downstream per-entry PII ops rely on those ids).
        const entries = deserializeContactEntries(row.contactEntries);
        const contactInfoStr = contactEntriesToBlob(entries) || null;
        await db.insert(adopters).values({
            id: newId,
            name: (row.name ?? '').trim(),
            contactInfo: contactInfoStr,
            contactEntries: entries.length ? JSON.stringify(entries) : null,
            familyMembers: null,
            status: '5',
            addedBy: actor,
            sourceUrl: null,
            country,
            isPublic: row.isPublic ? 1 : 0,
            source: 'imported',
        }).onConflictDoNothing();
        // The activity — via the same normalized-write path the single-create route uses.
        await insertRecord(db, {
            adopterId: newId,
            animalName: row.adoption.animalName?.trim() || null,
            species: row.adoption.species || 'other',
            status: 'completed',
            rating: row.adoption.rating || 2,
            recordType: row.adoption.recordType,
            date: row.adoption.date ? new Date(row.adoption.date) : null,
            sourceUrl: null,
            details: row.adoption.details || null,
            neutered: row.adoption.neutered ?? null,
            age: row.adoption.age || null,
            onBehalfOf: row.adoption.onBehalfOf || null,
        }, actor);
    }
    await tokenizeAdopter(newId);
    return newId;
}

export async function importAdoptersBatch(rows: ImportBatchRow[], runId: string): Promise<ImportBatchResult[]> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return rows.map(r => ({ index: r.index, status: 'failed', message: 'No autenticado.' }));
    const db = await getDb();
    if (!db) return rows.map(r => ({ index: r.index, status: 'failed', message: 'Base de datos no disponible.' }));

    // Country stamped once per batch (showcase visibility depends on it).
    let country: string | null = null;
    try {
        const prof = await db.select({ country: userProfiles.country }).from(userProfiles)
            .innerJoin(users, eq(users.id, userProfiles.userId)).where(eq(users.email, actor)).get();
        country = prof?.country ?? null;
    } catch { /* country is best-effort */ }

    const out: ImportBatchResult[] = [];
    for (const row of rows) {
        try {
            if (row.action === 'skip') { out.push({ index: row.index, status: 'skipped', message: 'Omitido' }); continue; }
            if (row.action === 'upsert' && row.matchedAdopterId) {
                const r = await withDbRetry(() => upsertImportRecord({ adopterId: row.matchedAdopterId!, name: row.name, contactEntries: row.contactEntries, adoption: row.adoption }));
                if (r.ok) {
                    const bits = [
                        r.addedContacts ? `+${r.addedContacts} contacto${r.addedContacts > 1 ? 's' : ''}` : '',
                        r.addedActivity ? '+1 actividad' : '', r.nameFilled ? 'nombre' : '', r.aliasAdded ? 'alias' : '',
                    ].filter(Boolean).join(', ');
                    out.push(bits
                        ? { index: row.index, status: 'updated', id: row.matchedAdopterId, message: `Actualizó: ${bits}` }
                        : { index: row.index, status: 'skipped', id: row.matchedAdopterId, message: 'Sin novedad — ya estaba todo' });
                } else {
                    out.push({ index: row.index, status: 'failed', id: row.matchedAdopterId, message: r.error || 'No se pudo actualizar' });
                }
            } else {
                const id = await withDbRetry(() => createImportedAdopter(db, actor, country, row, runId));
                out.push({ index: row.index, status: 'created', id });
            }
        } catch (e) {
            const errorId = logger.error('importAdoptersBatch: row failed', e, { actorEmail: actor, index: row.index, action: row.action });
            out.push({ index: row.index, status: 'failed', message: `Error del servidor (${errorId})` });
        }
    }

    // Audit incrementally, per batch — so failures are ALWAYS captured even if the
    // client never reaches the final finishImportRun (a big import writing all
    // items at once used to blow the Worker limit and silently record nothing).
    // Deterministic item id + onConflictDoNothing keeps split-retries from
    // duplicating audit rows. Best-effort — never fails the import.
    try {
        const byIndex = new Map(rows.map(r => [r.index, r]));
        const itemRows = out.map(r => {
            const row = byIndex.get(r.index);
            return {
                id: `impitem-${runId}-${r.index}`,
                runId,
                rowIndex: r.index + 1,
                adopterId: r.id ?? null,
                adopterName: row?.name?.trim() || null,
                action: row?.action ?? null,
                status: r.status,
                matchedAdopterId: row?.matchedAdopterId ?? null,
                matchedAdopterName: row?.matchedAdopterName ?? null,
                matchConfidence: row?.matchConfidence ?? null,
                message: r.message ?? null,
                createdAt: new Date(),
            };
        });
        for (let i = 0; i < itemRows.length; i += 40) {
            await db.insert(importRunItems).values(itemRows.slice(i, i + 40)).onConflictDoNothing();
        }
    } catch (e) {
        logger.warn('importAdoptersBatch: audit write failed', { runId, error: e instanceof Error ? e.message : String(e) });
    }
    return out;
}
