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

import { eq, sql } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, userProfiles, users, importRunItems, importRuns } from '@/db/schema';
import { deserializeContactEntries, contactEntriesToBlob } from '@/lib/contactEntries';
import { isRealActorEmail } from '@/lib/piiAccess';
import { insertRecord } from './_recordWrite';
import { tokenizeAdopter } from './duplicates';
import { upsertImportRecord } from './importUpsert';
import { logger } from '@/lib/logger';

export interface ImportAdoption {
    animalName: string | null; species: string | null; recordType: string;
    rating: number | null; date: string | null; details: string | null; onBehalfOf: string | null;
    neutered?: number | null; age?: string | null;
    sex?: string | null; color?: string | null; microchip?: string | null;
}
export interface ImportBatchRow {
    index: number;
    action: 'create' | 'upsert' | 'skip';
    name?: string | null;
    /** JSON ContactEntry[] */
    contactEntries: string;
    adoption: ImportAdoption;
    /** Intra-spreadsheet dedup: additional activities to attach to THIS same
     *  adopter when several spreadsheet rows are the identical person (same
     *  content fingerprint) — one profile with N activities instead of N
     *  duplicate profiles. Only meaningful on 'create'; ignored otherwise. */
    extraAdoptions?: ImportAdoption[];
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

/** Map one import adoption + target ids into the insertRecord row shape. Shared by
 *  the primary activity and any folded extra activities (intra-spreadsheet dedup). */
// Parse a YYYY-MM-DD activity date to NOON UTC, not `new Date(str)` (= UTC
// midnight). Midnight-UTC displays as the PREVIOUS day in Buenos Aires (UTC-3)
// via formatShortDate's local getDate() — the off-by-one on imported profiles.
// Noon keeps the day correct across every real timezone (matches the manual
// form's parseLocalDate). Falls back to plain parsing for non-ISO strings.
export function importDateToNoon(s: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}
function recordDataFrom(a: ImportAdoption, id: string, adopterId: string) {
    return {
        id, adopterId,
        animalName: a.animalName?.trim() || null,
        species: a.species || 'other',
        status: 'completed' as const,
        rating: a.rating || 2,
        recordType: a.recordType,
        date: a.date ? importDateToNoon(a.date) : null,
        sourceUrl: null,
        details: a.details || null,
        neutered: a.neutered ?? null,
        age: a.age || null,
        sex: a.sex || null,
        color: a.color || null,
        microchip: a.microchip || null,
        onBehalfOf: a.onBehalfOf || null,
    };
}

async function createImportedAdopter(db: NonNullable<Db>, actor: string, country: string | null, row: ImportBatchRow, runId: string): Promise<string> {
    const newId = deterministicAdopterId(runId, row.index);
    // Each write is INDEPENDENTLY idempotent (deterministic ids + onConflictDoNothing),
    // so a mid-row Worker kill or a withDbRetry re-run re-attempts only the writes that
    // didn't commit — instead of the old all-or-nothing `if (!existing)` gate that could
    // skip the activity forever (adopter with no activity → no rating; orphan animal).
    const entries = deserializeContactEntries(row.contactEntries).map(e => ({ ...e, addedBy: e.addedBy ?? actor }));
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
    // Deterministic activity id keyed on (runId,index) so a retry is a DB no-op, not a
    // duplicate activity — and so a prior attempt that stranded the adopter still gets
    // its activity written on the next attempt.
    await insertRecord(db, recordDataFrom(row.adoption, `${newId}-act`, newId), actor);
    // Intra-spreadsheet dedup: extra activities of the same person (folded client-
    // side) become their own records under this one adopter. Deterministic ids keep
    // a resend idempotent, exactly like the primary activity above.
    const extras = row.extraAdoptions ?? [];
    for (let k = 0; k < extras.length; k++) {
        await insertRecord(db, recordDataFrom(extras[k], `${newId}-act${k + 1}`, newId), actor);
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
                const r = await withDbRetry(() => upsertImportRecord({
                    adopterId: row.matchedAdopterId!,
                    activityId: `impups-${runId}-${row.index}-act`,
                    name: row.name,
                    contactEntries: row.contactEntries,
                    adoption: row.adoption,
                }));
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
        // Ensure the run header exists — the client's startImportRun is best-effort
        // and can fail, orphaning the run. Creating it here (idempotent) means a run
        // ALWAYS appears in /admin/imports as soon as its first batch lands.
        await db.insert(importRuns).values({ id: runId, actorEmail: actor, status: 'running', startedAt: new Date() }).onConflictDoNothing();
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
        // ≤8 rows/insert: 12 columns × 8 = 96 bound params, under D1's ~100-per-query
        // limit. (40 rows = 480 params silently failed every audit write — see Axiom
        // "importAdoptersBatch: audit write failed" ×33, and 0 rows in /admin/imports.)
        // Upsert (not do-nothing): a row that was 'failed' on attempt 1 and 'created' on a
        // retry must overwrite the stale item, or the admin's item-derived counts lie. Still
        // ≤8 rows/insert (12 cols × 8 = 96 params < D1's ~100 limit).
        for (let i = 0; i < itemRows.length; i += 8) {
            await db.insert(importRunItems).values(itemRows.slice(i, i + 8))
                .onConflictDoUpdate({
                    target: importRunItems.id,
                    set: {
                        adopterId: sql`excluded.adopter_id`,
                        action: sql`excluded.action`,
                        status: sql`excluded.status`,
                        matchedAdopterId: sql`excluded.matched_adopter_id`,
                        matchedAdopterName: sql`excluded.matched_adopter_name`,
                        matchConfidence: sql`excluded.match_confidence`,
                        message: sql`excluded.message`,
                        createdAt: sql`excluded.created_at`,
                    },
                });
        }
    } catch (e) {
        logger.warn('importAdoptersBatch: audit write failed', { runId, error: e instanceof Error ? e.message : String(e) });
    }
    return out;
}
