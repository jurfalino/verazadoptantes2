'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { adopters, adoptions, adopterImages, adopterFlags, adopterHistory, adopterStats, searches, users } from '@/db/schema';
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

/**
 * Resolve or reject an ARCO/data-subject request from /admin/data-requests.
 *
 * v2.19.70: replaces the inline `'use server'` form action that did the D1
 * UPDATE directly in the (edge-runtime) page with no auth, no try/catch, and no
 * logging — which 500'd in prod with the error invisible to Axiom. This mirrors
 * the flags page's working pattern (handleDismiss → dismissFlag): a hardened,
 * exported, admin-gated action. Returns {success}/{error,errorId} instead of
 * throwing, so a failure surfaces a logged errorId rather than a raw 500.
 */
export async function resolveDataRequest(id: string, action: 'resolved' | 'rejected') {
    const session = await auth();
    try {
        if (!session?.user?.email || !await checkIsAdminAsync(session.user.email)) {
            logger.warn('resolveDataRequest: unauthorized', { id, action, user: session?.user?.email });
            return { success: false, error: 'Unauthorized' };
        }
        if (action !== 'resolved' && action !== 'rejected') {
            logger.warn('resolveDataRequest: invalid action', { id, action, user: session.user.email });
            return { success: false, error: 'Invalid action' };
        }
        if (!id) {
            logger.warn('resolveDataRequest: missing id', { action, user: session.user.email });
            return { success: false, error: 'Missing request id' };
        }

        const db = await getDb();
        if (!db) {
            logger.warn('resolveDataRequest: no database', { id, action, user: session.user.email });
            return { success: false, error: 'No database' };
        }

        const { dataRequests } = await import('@/db/schema');
        const reqRow = await db.select().from(dataRequests).where(eq(dataRequests.id, id)).get();
        if (!reqRow) {
            logger.warn('resolveDataRequest: request not found', { id, action, user: session.user.email });
            return { success: false, error: 'Request not found' };
        }

        // v2.19.72: RESOLVING a deletion request now actually deletes the linked
        // adopter (complete cascade via deleteAdopter) — not just a status flip.
        // Before, "Resolve" only marked the request handled, so the record stayed
        // live and visible to everyone (the bug). REJECT and non-deletion request
        // types are unchanged (status only — Reject = decline the deletion).
        let deletedAdopter = false;
        if (action === 'resolved' && reqRow.requestType === 'deletion' && reqRow.adopterId) {
            const del = await deleteAdopter(reqRow.adopterId);
            if (!del.success) {
                const errorId = logger.error('resolveDataRequest: adopter deletion failed', undefined, {
                    id, adopterId: reqRow.adopterId, reason: del.error, user: session.user.email,
                });
                return { success: false, error: `No se pudo eliminar el registro: ${del.error ?? 'error'}`, errorId };
            }
            deletedAdopter = true;
        }

        await db.update(dataRequests)
            .set({ status: action, resolvedAt: new Date(), resolvedBy: session.user.email })
            .where(eq(dataRequests.id, id));

        logAudit({ userEmail: session.user.email, action: `data_request_${action}`, target: id, details: deletedAdopter ? { deletedAdopterId: reqRow.adopterId } : undefined });
        revalidatePath('/admin/data-requests');
        if (deletedAdopter && reqRow.adopterId) revalidatePath(`/adopter/${reqRow.adopterId}`);
        return { success: true, deletedAdopter };
    } catch (error) {
        const errorId = logger.error('resolveDataRequest failed', error, {
            id,
            action,
            user: session?.user?.email,
        });
        return { success: false, error: 'Failed to resolve request', errorId };
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
 * Backfill `adopters.country` for records that landed without it
 * (v2.19.3). saveAdopter has stamped country on create since v40-ish via
 * user_profiles.country → CF-IPCountry header, but a handful of records
 * predate that or were created through bypass paths (the API factory,
 * form-submission auto-create, contract-app create) that don't run the
 * stamping logic.
 *
 * The fix is mechanical: for each null-country adopter, fill from the
 * creator's user_profiles.country if available. Anything that can't be
 * resolved that way (creator also has no country, or addedBy is null /
 * 'anonymous') is left alone and shows up in the admin's residual count
 * for manual triage via `/admin/adopters?country=_none`.
 *
 * Idempotent. Safe to re-run.
 */
export async function backfillAdopterCountries(): Promise<
    | { ok: true; migrated: number; residual: number; noCreatorCountry: number; errors: { adopterId: string; error: string }[] }
    | { ok: false; error: string }
> {
    const session = await auth();
    const actor = session?.user?.email ?? '';
    if (!actor || !(await checkIsAdminAsync(actor))) {
        return { ok: false, error: 'Unauthorized' };
    }

    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'No database' };

        // Use raw D1 for the user_profiles join (auth tables aren't in Drizzle
        // schema). Same shape as the country lookup in saveAdopter at create.
        const { env } = getRequestContext();
        if (!env?.DB) return { ok: false, error: 'D1 binding unavailable' };

        const candidates = await db.select({
            id: adopters.id,
            addedBy: adopters.addedBy,
            country: adopters.country,
        }).from(adopters);

        const nullCountry = candidates.filter((r: { country: string | null }) =>
            r.country === null || (typeof r.country === 'string' && r.country.trim() === ''));

        let migrated = 0;
        let noCreatorCountry = 0;
        const errors: { adopterId: string; error: string }[] = [];

        for (const row of nullCountry) {
            const creator = row.addedBy?.toLowerCase().trim() ?? '';
            if (!creator || creator === 'anonymous') {
                noCreatorCountry++;
                continue;
            }
            try {
                const profile = await env.DB.prepare(
                    `SELECT up.country FROM user_profiles up
                     JOIN user u ON u.id = up.user_id
                     WHERE u.email = ? LIMIT 1`
                ).bind(creator).first<{ country: string | null }>();
                const country = profile?.country?.trim() || null;
                if (!country) {
                    noCreatorCountry++;
                    continue;
                }
                await db.update(adopters)
                    .set({ country, updatedAt: new Date() })
                    .where(eq(adopters.id, row.id));

                logAudit({
                    userEmail: actor,
                    action: 'adopter_country_backfilled',
                    target: row.id,
                    details: { country, source: 'creator_user_profile', creator },
                });
                migrated++;
            } catch (e) {
                errors.push({
                    adopterId: row.id,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        const residual = noCreatorCountry + errors.length;
        logger.info('backfillAdopterCountries: complete', {
            actor, migrated, residual, noCreatorCountry, errorCount: errors.length,
        });

        revalidatePath('/admin');
        revalidatePath('/admin/adopters');
        return { ok: true, migrated, residual, noCreatorCountry, errors };
    } catch (error) {
        const errorId = logger.error('backfillAdopterCountries failed', error, { actor });
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

/**
 * Admin-only: rewrite `adopters.addedBy` from the current owner to a target
 * user. Ownership is the single pointer the entire permission model derives
 * from (edit gate, delete gate, isOwner in the profile, PII visibility,
 * adopter-login gate) — updating this one column propagates correctly
 * everywhere on the next read.
 *
 * Scope is intentionally narrow: child-row `addedBy` fields on `adoptions`,
 * `adopterImages`, and per-entry `contactEntries[]` are NOT rewritten —
 * those are contributor credits (who created this child row), not ownership
 * signals, and the duplicate-merge flow (src/app/actions/duplicates.ts)
 * uses the same convention. If we ever want a "scrub original contributor"
 * variant that's a separate action.
 *
 * Audit-first ordering: D1 has no transactions, so we write the history +
 * global audit row BEFORE flipping the column. If the UPDATE fails we still
 * have a paper trail of "we tried"; the reverse order would leave a silent
 * transfer with no record.
 */
export async function transferAdopterOwnership(adopterId: string, toEmail: string):
    Promise<{ ok: true; adopterId: string; from: string; to: string } | { ok: false; error: string }> {
    const session = await auth();
    const actor = session?.user?.email ?? '';
    if (!actor || !(await checkIsAdminAsync(actor))) {
        return { ok: false, error: 'Unauthorized' };
    }
    if (!adopterId || typeof adopterId !== 'string') {
        return { ok: false, error: 'Missing adopter id' };
    }
    const normalizedTo = (toEmail || '').toLowerCase().trim();
    if (!normalizedTo || !normalizedTo.includes('@')) {
        return { ok: false, error: 'Invalid target email' };
    }

    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'No database' };

        // Validate target user exists. If we don't enforce this we could
        // point ownership at a stranger no one can ever sign in as.
        const target = await db.select({ email: users.email }).from(users)
            .where(eq(users.email, normalizedTo)).get();
        if (!target) {
            return { ok: false, error: 'Target user not found' };
        }

        // Fetch current owner + soft-delete check.
        const current = await db.select({
            id: adopters.id,
            name: adopters.name,
            addedBy: adopters.addedBy,
            deletedAt: adopters.deletedAt,
        }).from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!current) return { ok: false, error: 'Adopter not found' };
        if (current.deletedAt) return { ok: false, error: 'Adopter is deleted' };

        const from = current.addedBy ?? '';
        if (from.toLowerCase().trim() === normalizedTo) {
            return { ok: false, error: 'Adopter is already owned by that user' };
        }

        // 1. adopter_history — canonical v2.18.8 shape so the per-adopter
        //    audit log (admin+moderator-gated) renders the transfer.
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: actor,
            kind: 'edit',
            changes: JSON.stringify({ ownership_transferred: { from, to: normalizedTo } }),
            changedAt: new Date(),
        });

        // 2. Global audit log.
        logAudit({
            userEmail: actor,
            action: 'adopter_ownership_transferred',
            target: adopterId,
            details: { from, to: normalizedTo },
        });

        // 3. Flip the column. Update updatedAt so the adopter shows up in
        //    "recently updated" surfaces.
        await db.update(adopters)
            .set({ addedBy: normalizedTo, updatedAt: new Date() })
            .where(eq(adopters.id, adopterId));

        // 4. Fire-and-forget notifications to both parties. Wrap each
        //    .catch(logger.warn) per project convention — never swallow.
        import('@/app/actions/notifications').then(async ({ createNotification }) => {
            const url = `/adopter/${adopterId}`;
            const targets = [from, normalizedTo].filter(e => e && e.includes('@') && e !== 'anonymous');
            // v2.19.23: include the adopter name in both notification bodies
            // so the recipient knows *which* record changed hands without
            // having to click through. "an adopter" was useless when an
            // admin transferred several in a sweep — the notifications all
            // looked identical.
            const adopterLabel = current.name?.trim() || 'un adoptante';
            await Promise.all(targets.map(email => createNotification({
                userId: email,
                type: 'ownership_transferred',
                title: 'Cambio de propietario',
                body: email === normalizedTo
                    ? `Ahora sos el propietario de "${adopterLabel}" (transferido por ${actor}).`
                    : `Un administrador transfirió "${adopterLabel}" a ${normalizedTo}.`,
                url,
            }).catch((e: unknown) => {
                logger.warn('transferAdopterOwnership: createNotification failed', {
                    adopterId, recipient: email, actor,
                    error: e instanceof Error ? e.message : String(e),
                });
            })));
        }).catch((e: unknown) => {
            logger.warn('transferAdopterOwnership: notifications module load failed', {
                adopterId, actor, error: e instanceof Error ? e.message : String(e),
            });
        });

        logger.info('Adopter ownership transferred', { adopterId, from, to: normalizedTo, actor });
        revalidatePath(`/adopter/${adopterId}`);
        revalidatePath('/admin/adopters');
        return { ok: true, adopterId, from, to: normalizedTo };
    } catch (error) {
        const errorId = logger.error('transferAdopterOwnership failed', error, { adopterId, toEmail: normalizedTo, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}
