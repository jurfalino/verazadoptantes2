/**
 * Who changed a field, for collision messages («<Nombre> cambió …»). Plain
 * server module (not 'use server'). Display names follow the rescuer-identity
 * rule: users.name, else the email handle — never a full email. Unknown → ''
 * (the UI then says «otra persona del equipo» instead of guessing).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { adopterHistory, auditLog, users } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { fieldAuthor } from '@/domain/fieldCollab';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function displayNameOf(db: Db, email: string | null | undefined): Promise<string> {
    if (!email || !email.includes('@')) return '';
    try {
        const row = await db.select({ name: users.name }).from(users).where(eq(users.email, email)).get() as { name: string | null } | undefined;
        const name = row?.name?.trim();
        return name || email.split('@')[0];
    } catch (e) {
        logger.warn('collabAttribution.displayNameOf: lookup failed, using handle', { error: e instanceof Error ? e.message : String(e) });
        return email.split('@')[0];
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

/** Contact entries / household members — the history rows that name the item id. */
export async function itemAuthors(db: Db, adopterId: string, itemIds: string[]): Promise<Record<string, string>> {
    if (!itemIds.length) return {};
    let rows: Array<{ by: string | null; fields: string[] }> = [];
    try {
        const raw = await db.select({ changedBy: adopterHistory.changedBy, changes: adopterHistory.changes })
            .from(adopterHistory).where(eq(adopterHistory.adopterId, adopterId))
            .orderBy(desc(adopterHistory.changedAt), sql`rowid DESC`).limit(100).all() as Array<{ changedBy: string | null; changes: string | null }>;
        rows = raw.map(r => {
            const text = r.changes ?? '';
            return { by: r.changedBy, fields: itemIds.filter(id => text.includes(`"${id}"`)) };
        });
    } catch (e) {
        logger.warn('collabAttribution.itemAuthors: history lookup failed', { adopterId, error: e instanceof Error ? e.message : String(e) });
    }
    return namesFor(db, itemIds, rows);
}
