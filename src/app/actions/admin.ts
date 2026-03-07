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

        // Get all adoption IDs for this adopter first (to delete their images)
        const _adopterAdoptions = await db.select({ id: adoptions.id })
            .from(adoptions)
            .where(eq(adoptions.adopterId, adopterId));

        // Cascade Logic
        // 1. Delete adopter stats
        await db.delete(adopterStats).where(eq(adopterStats.adopterId, adopterId));

        // 2. Delete Flags
        await db.delete(adopterFlags).where(eq(adopterFlags.adopterId, adopterId));

        // 3. Delete History
        await db.delete(adopterHistory).where(eq(adopterHistory.adopterId, adopterId));

        // 4. Delete Adopter Images
        await db.delete(adopterImages).where(eq(adopterImages.adopterId, adopterId));

        // 6. Delete linked Adoptions entirely (rather than unlinking)
        await db.delete(adoptions).where(eq(adoptions.adopterId, adopterId));

        // 7. Delete Adopter
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
    try {
        const session = await auth();
        // Strict Admin Check
        if (!session?.user?.email || !await checkIsAdminAsync(session.user.email)) {
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
        const errorId = logger.error('Purge all data failed', error);
        throw new Error(`Failed to purge data (Error ID: ${errorId})`);
    }
}
