'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { adopters, adoptions, adopterImages, adopterFlags, adopterHistory, adopterStats, searches } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, checkIsAdmin, checkIsAdminAsync } from './_db';

export async function runAdminQuery(query: string) {
    try {
        const session = await auth();
        if (!session?.user?.email || !checkIsAdmin(session.user.email)) {
            return { error: 'Unauthorized' };
        }

        const q = query.trim();

        // 1. Must start with SELECT (or WITH for CTEs)
        if (!/^(select|with)\b/i.test(q)) {
            return { error: 'Only SELECT queries are allowed.' };
        }

        // 2. Block multi-statement injection: no semicolons allowed except at the very end
        const bodyWithoutTrailingSemicolon = q.replace(/;\s*$/, '');
        if (bodyWithoutTrailingSemicolon.includes(';')) {
            return { error: 'Multi-statement queries are not allowed.' };
        }

        // 3. Comprehensive deny-list for dangerous keywords (word-boundary matched)
        const dangerousKeywords = [
            'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
            'REPLACE', 'UPSERT', 'PRAGMA', 'ATTACH', 'DETACH', 'VACUUM',
            'REINDEX', 'SAVEPOINT', 'RELEASE', 'ROLLBACK', 'COMMIT', 'BEGIN',
        ];
        const dangerPattern = new RegExp(`\\b(${dangerousKeywords.join('|')})\\b`, 'i');
        if (dangerPattern.test(bodyWithoutTrailingSemicolon)) {
            return { error: 'Write/administrative operations are not allowed.' };
        }

        // 4. Execute via D1 prepared statement API directly (not sql.raw)
        const { env } = getRequestContext();
        if (!env?.DB) {
            // Fallback for local dev: use Drizzle
            const db = await getDb();
            if (!db) return { error: 'Database unavailable' };
            const rows = await (db as any).all(sql.raw(bodyWithoutTrailingSemicolon));
            return { rows };
        }

        const stmt = env.DB.prepare(bodyWithoutTrailingSemicolon);
        const result = await stmt.all();

        // 5. Log the query for audit trail
        logAudit({
            userEmail: session.user.email,
            action: 'admin_sql_query',
            details: { query: bodyWithoutTrailingSemicolon, rowCount: result.results?.length ?? 0 },
        });

        return { rows: result.results ?? [] };

    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { error: message };
    }
}

export async function deleteAdopter(adopterId: string) {
    const session = await auth();
    try {
        // Strict Admin Check
        if (!session?.user?.email || !await checkIsAdminAsync(session.user.email)) {
            return { success: false, error: "Unauthorized" };
        }

        const db = await getDb();
        if (!db) return { success: false, error: "No database" };

        const { duplicateTokens, duplicateCandidates, formSubmissions } = await import('@/db/schema');

        // Cascade Logic
        // 1. Delete adopter stats
        await db.delete(adopterStats).where(eq(adopterStats.adopterId, adopterId));

        // 2. Delete Flags
        await db.delete(adopterFlags).where(eq(adopterFlags.adopterId, adopterId));

        // 3. Delete History
        await db.delete(adopterHistory).where(eq(adopterHistory.adopterId, adopterId));

        // 4. Delete Adopter Images
        await db.delete(adopterImages).where(eq(adopterImages.adopterId, adopterId));

        // 5. Delete linked Adoptions entirely
        await db.delete(adoptions).where(eq(adoptions.adopterId, adopterId));

        // 6. Delete duplicate detection tokens & candidates
        await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopterId));
        await db.delete(duplicateCandidates).where(sql`${duplicateCandidates.adopter1Id} = ${adopterId} OR ${duplicateCandidates.adopter2Id} = ${adopterId}`);

        // 7. Unlink form submissions (don't delete — they belong to the form submitter)
        await db.update(formSubmissions).set({ linkedAdopterId: null }).where(eq(formSubmissions.linkedAdopterId, adopterId));

        // 8. Delete Adopter
        await db.delete(adopters).where(eq(adopters.id, adopterId));

        logger.info('Adopter deleted', { adopterId, deletedBy: session.user.email });
        logAudit({ userEmail: session.user.email || undefined, action: 'adopter_deleted', target: adopterId });

        revalidatePath('/admin/adopters');
        return { success: true };
    } catch (error) {
        logger.error('Delete adopter failed', error, { adopterId, user: session?.user?.email });
        return { success: false, error: error instanceof Error ? error.message : "Failed to delete adopter" };
    }
}

export async function purgeAllData(confirmationCode: string) {
    let actorEmail: string | undefined;
    try {
        const session = await auth();
        actorEmail = session?.user?.email || undefined;
        // Strict Admin Check
        if (!actorEmail || !await checkIsAdminAsync(actorEmail)) {
            throw new Error("Unauthorized");
        }

        // Validate confirmation code matches expected pattern
        const expectedCode = "PURGE-ALL-DATA";
        if (confirmationCode !== expectedCode) {
            throw new Error("Invalid confirmation code");
        }

        const db = await getDb();
        if (!db) throw new Error("No database");

        // Delete all data in correct order to avoid foreign key issues
        // 1. Delete stats
        await db.delete(adopterStats);

        // 2. Delete flags
        await db.delete(adopterFlags);

        // 3. Delete history
        await db.delete(adopterHistory);

        // 4. Delete adopter images
        await db.delete(adopterImages);

        // 5. Delete adoptions
        await db.delete(adoptions);

        // 6. Delete searches
        await db.delete(searches);

        // 7. Delete adopters
        await db.delete(adopters);

        revalidatePath('/admin');
        revalidatePath('/');
        return { success: true, message: "All data has been purged" };
    } catch (error) {
        const errorId = logger.error('Purge all data failed', error, { actorEmail });
        throw new Error(`Failed to purge data (Error ID: ${errorId})`);
    }
}

/**
 * One-shot backfill of structured `contactEntries` from the legacy
 * `contactInfo` blob for every row that still has the legacy shape.
 *
 * Runs once after the staging→master deploy where migration 0043 first
 * introduces the column. Without this, every existing production row sits
 * in the "no edit affordance + first-composer-write nukes the blob" state
 * until someone happens to add a new entry (lazy migration in
 * `addContactEntry` covers that case as defense-in-depth, but pure-read
 * profiles would stay broken indefinitely).
 *
 * Idempotent: only touches rows where `contactEntries IS NULL` and
 * `contactInfo` is non-empty. Safe to re-run.
 */
export async function backfillLegacyContactEntries(): Promise<
    | { ok: true; migrated: number; skipped: number; errors: { adopterId: string; error: string }[] }
    | { ok: false; error: string }
> {
    const session = await auth();
    const actor = session?.user?.email ?? '';
    if (!actor || !(await checkIsAdminAsync(actor))) {
        return { ok: false, error: 'Unauthorized' };
    }

    const { parseBlobToContactEntries } = await import('@/lib/contactEntries');

    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'No database' };

        // Read candidates: legacy = contactEntries unset + contactInfo populated.
        const candidates = await db.select({
            id: adopters.id,
            contactInfo: adopters.contactInfo,
            updatedAt: adopters.updatedAt,
        }).from(adopters);

        let migrated = 0;
        let skipped = 0;
        const errors: { adopterId: string; error: string }[] = [];

        for (const row of candidates) {
            // Re-read contactEntries from the full row to handle concurrent
            // edits during the run. Cheap on a small population.
            const full = await db.select().from(adopters)
                .where(eq(adopters.id, row.id)).get();
            if (!full) { skipped++; continue; }
            if (full.deletedAt) { skipped++; continue; }
            if (full.contactEntries && full.contactEntries.trim() && full.contactEntries !== '[]') {
                // Already migrated (or has user-added entries).
                skipped++;
                continue;
            }
            if (!full.contactInfo || !full.contactInfo.trim()) {
                // Nothing to migrate.
                skipped++;
                continue;
            }

            try {
                const parsed = parseBlobToContactEntries(full.contactInfo);
                if (parsed.length === 0) { skipped++; continue; }
                const withIds = parsed.map(e => ({ id: crypto.randomUUID(), ...e }));

                await db.update(adopters).set({
                    contactEntries: JSON.stringify(withIds),
                    // Don't touch contactInfo — it's the source the parser
                    // works from; if anything goes wrong the blob is still
                    // there for re-parsing. The derive-blob-from-entries
                    // path that runs on future writes will catch it up.
                    updatedAt: new Date(),
                }).where(eq(adopters.id, full.id));

                logAudit({
                    userEmail: actor,
                    action: 'contact_entries_backfilled',
                    target: full.id,
                    details: { entryCount: withIds.length },
                });
                migrated++;
            } catch (e) {
                errors.push({ adopterId: full.id, error: e instanceof Error ? e.message : String(e) });
            }
        }

        logger.info('backfillLegacyContactEntries: complete', {
            actor, migrated, skipped, errorCount: errors.length,
        });

        revalidatePath('/admin');
        return { ok: true, migrated, skipped, errors };
    } catch (error) {
        const errorId = logger.error('backfillLegacyContactEntries failed', error, { actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

/**
 * Admin override: flag (or unflag) a whole adopter row as public. When the
 * `ENABLE_PUBLIC_PROFILES` feature flag is on AND this column is 1, the
 * visibility resolver short-circuits to "nothingMasked" for any
 * authenticated viewer — name renders fully, all contact entries unmasked,
 * addressInfo unmasked. The admin override is intentionally coarse: it
 * exposes contributor-added entries too, on the basis that the admin has
 * confirmed the whole record is publicly known. Per-entry isPublic (set at
 * import time on social-sourced entries) is the finer-grain primitive.
 */
export async function setAdopterPublic(adopterId: string, isPublic: boolean):
    Promise<{ ok: true; adopterId: string; isPublic: boolean } | { ok: false; error: string }> {
    const session = await auth();
    const actor = session?.user?.email ?? '';
    if (!actor || !(await checkIsAdminAsync(actor))) {
        return { ok: false, error: 'Unauthorized' };
    }
    if (!adopterId || typeof adopterId !== 'string') {
        return { ok: false, error: 'Missing adopter id' };
    }
    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'No database' };
        const result = await db.update(adopters)
            .set({ isPublic: isPublic ? 1 : 0, updatedAt: new Date() })
            .where(eq(adopters.id, adopterId));
        const rowsAffected = (result as unknown as { rowsAffected?: number }).rowsAffected ?? 1;
        if (rowsAffected === 0) {
            return { ok: false, error: 'Adopter not found' };
        }
        logAudit({
            userEmail: actor,
            action: isPublic ? 'adopter_made_public' : 'adopter_made_private',
            target: adopterId,
        });
        revalidatePath('/admin');
        revalidatePath('/admin/adopters');
        revalidatePath(`/adopter/${adopterId}`);
        return { ok: true, adopterId, isPublic };
    } catch (error) {
        const errorId = logger.error('setAdopterPublic failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}
