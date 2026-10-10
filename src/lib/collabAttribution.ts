/**
 * Who changed a field, for collision messages («<Nombre> cambió …»). Plain
 * server module (not 'use server'). Display names follow the rescuer-identity
 * rule: users.name, else the email handle — never a full email. Unknown → ''
 * (the UI then says «otra persona del equipo» instead of guessing).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { adopterHistory, auditLog } from '@/db/schema';
import { resolveUserNames } from '@/app/actions/userNames';
import { emailHandle } from '@/lib/userDisplay';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { fieldAuthor } from '@/domain/fieldCollab';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function displayNameOf(_db: Db, email: string | null | undefined): Promise<string> {
    if (!email || !email.includes('@')) return '';
    // The same resolver as the cards' «Agregado por» / «Actualizado por»
    // (animalTimeline, AdoptionHistory), so one person has one name everywhere.
    try {
        const names = await resolveUserNames([email]);
        return names[email]?.trim() || emailHandle(email);
    } catch (e) {
        logger.warn('collabAttribution.displayNameOf: lookup failed, using handle', { error: e instanceof Error ? e.message : String(e) });
        return emailHandle(email);
    }
}

async function namesFor(db: Db, fields: string[], rows: Array<{ by: string | null; fields: string[] }>): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const f of fields) out[f] = await displayNameOf(db, fieldAuthor(f, rows));
    return out;
}

function parseJson(raw: string | null, ctx: Record<string, unknown>): Record<string, unknown> {
    if (!raw) return {};
    try {
        const v = JSON.parse(raw);
        return v && typeof v === 'object' ? v as Record<string, unknown> : {};
    } catch (e) {
        logger.warn('collabAttribution: unreadable history details, skipped', { ...ctx, error: e instanceof Error ? e.message : String(e) });
        return {};
    }
}

/** Adopter profile fields (name, status, familyMembers) — from adopter_history change keys. */
export async function adopterFieldAuthors(db: Db, adopterId: string, fields: string[]): Promise<Record<string, string>> {
    if (!fields.length) return {};
    let rows: Array<{ by: string | null; fields: string[] }> = [];
    try {
        const raw = await db.select({ changedBy: adopterHistory.changedBy, changes: adopterHistory.changes })
            .from(adopterHistory).where(eq(adopterHistory.adopterId, adopterId))
            .orderBy(desc(adopterHistory.changedAt), sql`rowid DESC`).limit(50).all() as Array<{ changedBy: string | null; changes: string | null }>;
        rows = raw.map(r => ({ by: r.changedBy, fields: Object.keys(parseJson(r.changes, { adopterId })) }));
    } catch (e) {
        logger.warn('collabAttribution.adopterFieldAuthors: history lookup failed', { adopterId, error: e instanceof Error ? e.message : String(e) });
    }
    return namesFor(db, fields, rows);
}

/** Animal / adoption / event record fields — from the 'adoption_updated' activity rows, which list field NAMES. */
export async function recordFieldAuthors(db: Db, recordId: string, fields: string[]): Promise<Record<string, string>> {
    if (!fields.length) return {};
    let rows: Array<{ by: string | null; fields: string[] }> = [];
    try {
        const raw = await db.select({ userEmail: auditLog.userEmail, details: auditLog.details })
            .from(auditLog).where(and(eq(auditLog.action, 'adoption_updated'), eq(auditLog.target, recordId)))
            .orderBy(desc(auditLog.createdAt), sql`rowid DESC`).limit(50).all() as Array<{ userEmail: string | null; details: string | null }>;
        rows = raw.map(r => {
            const d = parseJson(r.details, { recordId });
            return { by: r.userEmail, fields: Array.isArray(d.fields) ? (d.fields as unknown[]).filter((x): x is string => typeof x === 'string') : [] };
        });
    } catch (e) {
        logger.warn('collabAttribution.recordFieldAuthors: activity lookup failed', { recordId, error: e instanceof Error ? e.message : String(e) });
    }
    return namesFor(db, fields, rows);
}

/**
 * Contact entries / household members — the newest history row whose change
 * of one of `keys` (e.g. 'updated_entry', 'removed_entry') names the item by
 * `id` / `entryId`. Only those keys count: a member's id also appears in rows
 * about that member's contacts, which say nothing about who renamed them.
 */
export async function itemAuthors(db: Db, adopterId: string, itemIds: string[], keys: readonly string[]): Promise<Record<string, string>> {
    if (!itemIds.length) return {};
    let rows: Array<{ by: string | null; fields: string[] }> = [];
    try {
        const raw = await db.select({ changedBy: adopterHistory.changedBy, changes: adopterHistory.changes })
            .from(adopterHistory).where(eq(adopterHistory.adopterId, adopterId))
            .orderBy(desc(adopterHistory.changedAt), sql`rowid DESC`).limit(100).all() as Array<{ changedBy: string | null; changes: string | null }>;
        rows = raw.map(r => {
            const changes = parseJson(r.changes, { adopterId });
            const named = new Set<string>();
            for (const k of keys) {
                const v = changes[k] as { id?: unknown; entryId?: unknown } | undefined;
                if (v && typeof v === 'object') {
                    if (typeof v.entryId === 'string') named.add(v.entryId);
                    else if (typeof v.id === 'string') named.add(v.id);
                }
            }
            return { by: r.changedBy, fields: itemIds.filter(id => named.has(id)) };
        });
    } catch (e) {
        logger.warn('collabAttribution.itemAuthors: history lookup failed', { adopterId, error: e instanceof Error ? e.message : String(e) });
    }
    return namesFor(db, itemIds, rows);
}
