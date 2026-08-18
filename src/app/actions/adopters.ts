'use server';

import { headers } from 'next/headers';
import { adopters, adopterHistory, adopterStats } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { logger, withTrace } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { ADMIN_STATS_EXCLUSION_SQL } from '@/config/constants';
import { tokenizeAdopter } from './duplicates';
import { saveAdopterSchema } from './validation';
import {
    deserializeContactEntries,
    contactEntriesToBlob,
    parseBlobToContactEntries,
    mergeContactEntries,
} from '@/lib/contactEntries';
import { canEditAdopterRecord, maskAdopterContact, redactHistoryChanges, renderName } from '@/lib/piiAccess';
import { isPiiGatingEnabled, resolveAdopterVisibility, buildMaskOptions } from '@/lib/piiAccessServer';


export async function getAdopter(id: string) {
    // v2.19.45: trace-wrapped. Profile load is the heaviest server-rendered
    // path in the app — adopter row + history + flags + images + ratings +
    // stats + (separately) piiContext. If Cloudflare exception counts climb
    // again, we want a single Axiom field showing how long the whole compose
    // took per-request.
    return withTrace('getAdopter', () => getAdopterImpl(id), { adopterId: id });
}

async function getAdopterImpl(id: string) {
    try {
        const db = await getDb();
        if (!db) return null;

        // Log profile view with actor (fire and forget)
        let user = 'unknown';
        try { user = await getUser(); } catch { /* anonymous */ }
        logProfileView(id, user).catch((e) => { logger.error('Fire-and-forget profile view failed', e, { adopterId: id }); });

        const adopter = await db.select().from(adopters).where(eq(adopters.id, id)).get();
        if (!adopter) return null;
        // v2.20.0: hide soft-deleted adopters (merged duplicates OR
        // deletion-request soft-deletes) from direct profile access — same as a
        // non-existent id. Restore/purge is managed in /admin/deleted.
        if (adopter.deletedAt) return null;

        // PII access gating: mask contact fields for non-privileged viewers.
        if (await isPiiGatingEnabled()) {
            const visibility = await resolveAdopterVisibility(user, { id: adopter.id, addedBy: adopter.addedBy });
            // adopterIsPublic option short-circuits the per-entry mask when
            // the admin has flagged the whole record public (v2.16.0-12+).
            const maskOpts = await buildMaskOptions(adopter);
            const fullyVisible = visibility.nothingMasked || !!maskOpts.adopterIsPublic;
            if (!fullyVisible) {
                const masked = maskAdopterContact(adopter, visibility, maskOpts);
                adopter.contactInfo = masked.contactInfo;
                adopter.contactEntries = masked.contactEntries;
                adopter.addressInfo = masked.addressInfo;
                // Name → initials baseline + per-token reveal from name_token
                // grants (no currentQuery on the profile — only grants apply).
                // familyMembers → hidden (PII).
                adopter.name = renderName(adopter.name, visibility, undefined, maskOpts);
                adopter.familyMembers = null;
            }
        }
        return adopter;
    } catch (error) {
        logger.error('Get adopter failed', error, { adopterId: id });
        return null;
    }
}

/**
 * Append in-progress create-form fields to an existing adopter record.
 * Powers the "Continuar con este perfil" action in the dedup-UX redesign:
 * when the user finds an existing record that's clearly the same person, we
 * append their typed-but-not-saved contact data to the existing record's
 * `contactInfo` / `addressInfo` / `familyMembers` / `sourceUrl` instead of
 * discarding it. The target's identity (`name`, `status`) is untouched.
 *
 * Substring-idempotent: fields already contained in the target value are
 * skipped, so running the same call twice does not duplicate lines.
 */
export async function appendToExistingAdopter(
    targetId: string,
    fields: { contactInfo?: string; contactEntries?: string; addressInfo?: string; familyMembers?: string; sourceUrl?: string },
): Promise<{ success: boolean; adopterId?: string; error?: string }> {
    try {
        if (!targetId) return { success: false, error: 'Missing target adopter id' };

        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available' };

        let actorEmail = '';
        try { actorEmail = await getUser(); } catch { /* anonymous — will fail auth below */ }
        if (!actorEmail) return { success: false, error: 'Not authenticated' };

        const target = await db.select().from(adopters).where(eq(adopters.id, targetId)).get();
        if (!target) return { success: false, error: 'Target adopter not found' };
        if (target.deletedAt) return { success: false, error: 'Cannot append to a deleted adopter' };

        // Auth: actor must own the target (addedBy), be an admin, or share an
        // org with the owner (v2.18.11). isAdminAsync so DB-role admins pass.
        const { isAdminAsync } = await import('@/config/admins');
        const { isOrgMate } = await import('@/lib/orgMembership');
        const [actorIsAdmin, actorIsOrgMate] = await Promise.all([
            isAdminAsync(actorEmail),
            isOrgMate(actorEmail, target.addedBy),
        ]);
        if (target.addedBy !== actorEmail && !actorIsAdmin && !actorIsOrgMate) {
            return { success: false, error: 'Not authorized to modify this adopter' };
        }

        const appendIfNew = (existing: string | null, incoming: string | undefined): string | null => {
            if (!incoming || !incoming.trim()) return existing;
            const trimmed = incoming.trim();
            if (!existing || !existing.trim()) return trimmed;
            // Substring-idempotent: skip if already present (case-insensitive substring)
            if (existing.toLowerCase().includes(trimmed.toLowerCase())) return existing;
            return `${existing}\n${trimmed}`;
        };

        const updates: Partial<typeof adopters.$inferInsert> = {};
        const appendedFields: Record<string, string> = {};

        // Contact: prefer the structured-entry merge (normalized dedup) when
        // the caller sends contactEntries; fall back to the legacy blob append
        // for callers that only send a contactInfo string.
        if (fields.contactEntries) {
            const incoming = deserializeContactEntries(fields.contactEntries);
            if (incoming.length) {
                const targetEntries = deserializeContactEntries(target.contactEntries);
                const base = targetEntries.length ? targetEntries : parseBlobToContactEntries(target.contactInfo);
                const merged = mergeContactEntries(base, incoming);
                if (merged.length !== base.length) {
                    updates.contactEntries = JSON.stringify(merged);
                    updates.contactInfo = contactEntriesToBlob(merged) || null;
                    appendedFields.contactInfo = contactEntriesToBlob(incoming);
                }
            }
        } else {
            const newContact = appendIfNew(target.contactInfo, fields.contactInfo);
            if (newContact !== target.contactInfo) { updates.contactInfo = newContact; appendedFields.contactInfo = fields.contactInfo!.trim(); }
        }

        const newAddress = appendIfNew(target.addressInfo, fields.addressInfo);
        if (newAddress !== target.addressInfo) { updates.addressInfo = newAddress; appendedFields.addressInfo = fields.addressInfo!.trim(); }

        const newFamily = appendIfNew(target.familyMembers, fields.familyMembers);
        if (newFamily !== target.familyMembers) { updates.familyMembers = newFamily; appendedFields.familyMembers = fields.familyMembers!.trim(); }

        // sourceUrl is single-value, not appendable; only set if target has none.
        if (fields.sourceUrl && fields.sourceUrl.trim() && !target.sourceUrl) {
            updates.sourceUrl = fields.sourceUrl.trim();
            appendedFields.sourceUrl = fields.sourceUrl.trim();
        }

        if (Object.keys(updates).length === 0) {
            // Idempotent no-op — everything the user typed was already on the target.
            return { success: true, adopterId: targetId };
        }

        await db.update(adopters).set({ ...updates, updatedAt: new Date() }).where(eq(adopters.id, targetId));

        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId: targetId,
            changedBy: actorEmail,
            changes: JSON.stringify({ appended_from_create_flow: { appendedFields } }),
            changedAt: new Date(),
        });

        logger.info('Adopter appended from create flow', { adopterId: targetId, actorEmail, fields: Object.keys(appendedFields) });
        logAudit({ userEmail: actorEmail, action: 'adopter_appended', target: targetId, details: { appendedFields: Object.keys(appendedFields) } });

        // Re-index tokens so the newly appended contact data is searchable.
        // Awaited so the next duplicate check sees the appended fields
        // (Workers kill fire-and-forget).
        await tokenizeAdopter(targetId).catch(e => {
            // v2.19.44: tokenize failure is "silent data corruption" — the
            // append succeeded, but the duplicate-detection index is now
            // stale until the next save. logger.error generates an id so
            // an operator scanning Axiom can correlate it back to this
            // specific append.
            logger.error('Tokenize after append failed', e, { adopterId: targetId });
        });

        return { success: true, adopterId: targetId };
    } catch (error) {
        const errorId = logger.error('appendToExistingAdopter failed', error, { adopterId: targetId });
        return { success: false, error: `Failed to append (Error ID: ${errorId})` };
    }
}

// isPublic is widened to accept a boolean: AdopterForm sends a plain boolean
// for the anonymous-record visibility toggle (matches saveAdopterSchema's
// `z.boolean()`), while the DB column itself is a 0/1 integer — the CREATE
// branch below normalizes it before insert.
type SaveAdopterInput = Omit<typeof adopters.$inferInsert, 'isPublic'> & { isPublic?: boolean | number };

export async function saveAdopter(data: SaveAdopterInput) {
    // Defense-in-depth: notes field deprecated in v2.12.1-28 (backfilled into
    // observation records). Strip from any incoming payload before validation
    // so legacy clients can't write to it.
    if (data && 'notes' in data) {
        delete (data as Record<string, unknown>).notes;
    }
    // Validate input
    const parsed = saveAdopterSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(`Invalid adopter data: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }

    // Derive the contactInfo blob from structured entries when the caller
    // provides them, so the blob (read by LIKE search, the tokenizer and the
    // profile display) stays consistent with contactEntries.
    if (data.contactEntries !== undefined && data.contactEntries !== null) {
        const entries = deserializeContactEntries(data.contactEntries);
        data.contactEntries = entries.length ? JSON.stringify(entries) : null;
        data.contactInfo = contactEntriesToBlob(entries) || null;
    }

    try {
        const db = await getDb();
        if (!db) {
            throw new Error("No database");
        }

        let changedBy = 'Unknown';
        try {
            changedBy = await getUser();
        } catch (e) {
            logger.warn('getUser failed during adopter save', { error: e instanceof Error ? e.message : String(e) });
        }

        // Check if exists
        const existing = await db.select().from(adopters).where(eq(adopters.id, data.id || 'new')).get();

        if (existing) {
            // ACL: edits to a core adopter record are restricted to the owner
            // or an admin, ALWAYS — not conditionally on ENABLE_PII_ACCESS_GATING.
            // The "adds open, mutations gated" collaborative model (see
            // collaborative-vetting-model memory): contributing data is open via
            // addContactEntry / saveAdoption, but rewriting existing fields is
            // owner+admin only. Previously this check was conditional on the PII
            // flag, leaving production (flag off) open to any authenticated user.
            // The per-entry server actions (updateContactEntry, removeContactEntry)
            // apply the same gate, so a contributor who can append a phone via
            // addContactEntry still can't rewrite or delete one through saveAdopter.
            const { isAdminAsync } = await import('@/config/admins');
            const { isOrgMate } = await import('@/lib/orgMembership');
            const [actorIsAdmin, actorIsOrgMate] = await Promise.all([
                isAdminAsync(changedBy),
                isOrgMate(changedBy, existing.addedBy),
            ]);
            if (!canEditAdopterRecord({ gatingEnabled: true, actorEmail: changedBy, ownerEmail: existing.addedBy, actorIsAdmin, actorIsOrgMate })) {
                logger.warn('saveAdopter: edit blocked — not owner/admin/org-mate', { adopterId: data.id, actorEmail: changedBy });
                throw new Error('Not authorized to edit this adopter record.');
            }

            // Defense-in-depth: contact entries are owned exclusively by the
            // per-entry server actions (addContactEntry / updateContactEntry /
            // removeContactEntry) once an adopter exists. Strip them from any
            // UPDATE payload so a stale or malicious client can't wipe / rewrite
            // the contact list through this path. The CREATE branch below still
            // accepts them — that's how initial data lands.
            delete (data as Record<string, unknown>).contactEntries;
            delete (data as Record<string, unknown>).contactInfo;

            // Defense-in-depth: visibility (isPublic) is only ever set by the
            // CREATE branch's nameless-record default (see below). The generic
            // update path must never be able to flip a record's visibility —
            // strip it here so a stale or malicious payload can't silently
            // make a named/protected record public through saveAdopter.
            delete (data as Record<string, unknown>).isPublic;

            // Calculate changes
            const changes: Record<string, any> = {};
            let hasChanges = false;

            const fields = ['name', 'status', 'familyMembers'] as const;
            for (const field of fields) {
                // @ts-ignore
                if (data[field] !== undefined && data[field] !== existing[field]) {
                    // @ts-ignore
                    changes[field] = { from: existing[field], to: data[field] };
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                // Optimistic locking: only update if the record hasn't been modified since we read it
                const result = await db.update(adopters).set({
                    ...data,
                    updatedAt: new Date()
                }).where(
                    and(
                        eq(adopters.id, data.id as string),
                        eq(adopters.updatedAt, existing.updatedAt!)
                    )
                );

                // Check if update succeeded (no concurrent modification)
                const rowsAffected = (result as unknown as { rowsAffected?: number }).rowsAffected ?? 1;
                if (rowsAffected === 0) {
                    throw new Error('This record was modified by another user. Please refresh and try again.');
                }

                // Log history
                await db.insert(adopterHistory).values({
                    id: crypto.randomUUID(),
                    adopterId: data.id as string,
                    changedBy,
                    changes: JSON.stringify(changes),
                    changedAt: new Date()
                });

                logger.info('Adopter updated', { adopterId: data.id, changedBy });
                logAudit({ userEmail: changedBy, action: 'adopter_updated', target: data.id as string, details: changes });

                // Synchronous (v30): edge-runtime workers can reap a fire-and-forget
                // tokenize before the per-token INSERTs finish, leaving rows with a
                // valid tokenHash but an empty token set — invisible to the dedup
                // matcher until an admin clicks Scan. ~250ms cost is acceptable;
                // silent-token-loss is not. _adopterFactory already awaits the same way.
                try {
                    await tokenizeAdopter(data.id as string);
                } catch (e) {
                    logger.error('Tokenize adopter failed (update path)', e, { adopterId: data.id });
                }
            }
            return { success: true, id: data.id };
        } else {
            // Create
            const newId = data.id || crypto.randomUUID();

            // Look up the user's country to stamp on the adopter. Two-tier
            // fallback: user_profiles.country (set on first sign-in from
            // CF-IPCountry), then live CF-IPCountry header of the current
            // request — covers the brand-new-user case where the profile
            // hasn't been geo-seeded yet.
            let userCountry: string | null = null;
            try {
                const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
                if (env?.DB) {
                    const row = await env.DB.prepare(
                        `SELECT up.country FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
                    ).bind(changedBy).first<{ country: string | null }>();
                    userCountry = row?.country || null;
                }
            } catch (e) {
                logger.warn('Country lookup from user_profiles failed; trying header fallback', {
                    changedBy,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            if (!userCountry) {
                try {
                    const h = await headers();
                    userCountry = h?.get?.('cf-ipcountry') || null;
                } catch { /* headers() unavailable in some non-request contexts — fine, leave null */ }
            }

            await db.insert(adopters).values({
                ...data,
                id: newId,
                addedBy: changedBy, // Added this line
                country: userCountry,
                createdAt: new Date(),
                updatedAt: new Date(),
                // v2.31.x: anonymous (no-name) manual records default to
                // public so their contacts stay findable — an anonymous +
                // protected record is invisible in search. Named records are
                // unaffected: data.isPublic is only sent by AdopterForm when
                // the "No conozco el nombre" opt-in is checked; every other
                // caller omits it and gets the protected default (0).
                //
                // Server-side guard: isPublic is honored ONLY when the name
                // is also empty. The opt-in checkbox and the name field are
                // independent client state — a user can check "No conozco el
                // nombre" and then type a real name before saving, which used
                // to leave the stale isPublic=true in the payload and silently
                // publish a named record. The name check here is the actual
                // security boundary; the client-side gate in AdopterForm is
                // defense-in-depth, not the source of truth.
                isPublic: (data.isPublic && !data.name?.trim()) ? 1 : 0,
            });

            logger.info('Adopter created', { adopterId: newId, changedBy });
            logAudit({ userEmail: changedBy, action: 'adopter_created', target: newId, details: { name: data.name } });

            // Synchronous (v30): see comment in update branch above.
            try {
                await tokenizeAdopter(newId);
            } catch (e) {
                logger.error('Tokenize adopter failed (create path)', e, { adopterId: newId });
            }

            return { success: true, id: newId };
        }

    } catch (error) {
        const errorId = logger.error('Save adopter failed', error, { adopterId: data.id });
        throw new Error(`Failed to save adopter (Error ID: ${errorId})`);
    }
}

// Fetch adopter stats — flat totals (no period bucketing)
export async function getAdopterStats(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return null;

        // Aggregate in SQL: returns at most 2 rows (one per event type: search_hit, profile_view)
        // Exclude admin activity: filter out events from users with role='admin' in user_profiles
        const rows = await db.select({
            eventType: adopterStats.eventType,
            total: sql<number>`COUNT(*)`,
        }).from(adopterStats)
            .where(and(
                eq(adopterStats.adopterId, adopterId),
                sql`(${adopterStats.userId} IS NULL OR ${adopterStats.userId} NOT IN (${sql.raw(ADMIN_STATS_EXCLUSION_SQL)}))`
            ))
            .groupBy(adopterStats.eventType);

        const stats = { searchHits: 0, profileViews: 0 };

        for (const row of rows) {
            if (row.eventType === 'search_hit') stats.searchHits = row.total || 0;
            else if (row.eventType === 'profile_view') stats.profileViews = row.total || 0;
        }

        return stats;
    } catch (error) {
        logger.error('Get adopter stats failed', error, { adopterId });
        return null;
    }
}

// Log a profile view event
export async function logProfileView(adopterId: string, userId?: string) {
    try {
        const db = await getDb();
        if (!db) return;

        // adopterStats row — every visit, analytics counts care about volume.
        await db.insert(adopterStats).values({
            id: crypto.randomUUID(),
            adopterId,
            eventType: 'profile_view',
            userId: userId || null,
            createdAt: new Date()
        });

        // v2.19.5: also write to audit_log so /admin/audit can answer
        // "which records did user X open" without diving into adopterStats.
        // Deduped by (viewer, adopter, hour-bucket) deterministic id —
        // a tab-switching session that hits the page 30 times within an
        // hour writes one audit row, not thirty.
        const viewer = (userId || '').trim();
        if (viewer && viewer !== 'anonymous') {
            try {
                const bucketHour = Math.floor(Date.now() / (60 * 60 * 1000));
                const auditId = `view__${viewer}__${adopterId}__${bucketHour}`;
                // INSERT OR IGNORE on the deterministic id collapses repeats
                // within the bucket. The audit_log id is the PK so duplicate
                // inserts fail; the catch eats the conflict silently.
                const { auditLog } = await import('@/db/schema');
                await db.insert(auditLog).values({
                    id: auditId,
                    userId: null,
                    userEmail: viewer,
                    action: 'profile_viewed',
                    target: adopterId,
                    details: null,
                    createdAt: new Date(),
                }).onConflictDoNothing();
            } catch (e) {
                logger.warn('logProfileView: audit row failed (continuing)', {
                    adopterId, viewer,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }
    } catch (error) {
        logger.warn('Log profile view failed', { adopterId, error: error instanceof Error ? error.message : String(error) });
    }
}

// Calculate average rating from adoptions
export async function getAverageRating(adopterId: string): Promise<number | null> {
    try {
        const db = await getDb();
        if (!db) return null;

        const { adoptions } = await import('@/db/schema');
        const result = await db.select({
            avgRating: sql<number>`AVG(${adoptions.rating})`
        }).from(adoptions).where(
            eq(adoptions.adopterId, adopterId)
        ).get();

        return result?.avgRating ?? null;
    } catch (error) {
        logger.error('Get average rating failed', error, { adopterId });
        return null;
    }
}

export async function getHistory(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        // desc order
        const rows = await db.select().from(adopterHistory)
            .where(eq(adopterHistory.adopterId, adopterId))
            .orderBy(sql`${adopterHistory.changedAt} DESC`)
            .all();

        // PII access gating: redact contact-field deltas for non-privileged
        // viewers — the change log must not back-channel old/new contact values.
        if (await isPiiGatingEnabled()) {
            let viewer = 'unknown';
            try { viewer = await getUser(); } catch { /* anonymous */ }
            const adopter = await db.select({ addedBy: adopters.addedBy, isPublic: adopters.isPublic })
                .from(adopters).where(eq(adopters.id, adopterId)).get();
            const visibility = await resolveAdopterVisibility(viewer, {
                id: adopterId, addedBy: adopter?.addedBy ?? null,
            });
            const maskOpts = await buildMaskOptions(adopter);
            // Public profiles bypass redaction — if the whole record is admin-
            // flagged public, the change history is part of what's visible.
            const fullyVisible = visibility.nothingMasked || !!maskOpts.adopterIsPublic;
            if (!fullyVisible) {
                return rows.map((r: typeof adopterHistory.$inferSelect) => ({
                    ...r, changes: redactHistoryChanges(r.changes, visibility),
                }));
            }
        }
        return rows;
    } catch (error) {
        logger.error('Get history failed', error, { adopterId });
        return [];
    }
}

export async function getLinkedFormSubmissions(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        const { formSubmissions } = await import('@/db/schema');
        return await db.select({
            id: formSubmissions.id,
            species: formSubmissions.species,
            lifeStage: formSubmissions.lifeStage,
            notificationId: formSubmissions.notificationId,
            answersJson: formSubmissions.answersJson,
            createdAt: formSubmissions.createdAt,
        }).from(formSubmissions)
            .where(eq(formSubmissions.linkedAdopterId, adopterId))
            .orderBy(sql`${formSubmissions.createdAt} DESC`)
            .all();
    } catch (error) {
        logger.error('Get linked form submissions failed', error, { adopterId });
        return [];
    }
}

// ── Adopter Deletion ─────────────────────────────────────────

export async function checkAdopterDeletable(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return { canDelete: false, isOwner: false, collaborators: { adoptions: 0, images: 0, edits: 0, flags: 0, forms: 0 } };

        const user = await getUser();
        const adopter = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter) return { canDelete: false, isOwner: false, collaborators: { adoptions: 0, images: 0, edits: 0, flags: 0, forms: 0 } };

        const isOwner = adopter.addedBy === user;
        // v2.19.66: admins may delete ANY profile (see deleteOwnAdopter). Resolve
        // DB-role admins (isAdminAsync, not the bootstrap-only sync variant) so
        // the UI offers a direct delete instead of a deletion *request* on
        // records they don't own.
        const { isAdminAsync } = await import('@/config/admins');
        const actorIsAdmin = await isAdminAsync(user);
        if (!isOwner && !actorIsAdmin) return { canDelete: false, isOwner: false, collaborators: { adoptions: 0, images: 0, edits: 0, flags: 0, forms: 0 } };

        // Count contributions from OTHER users across all related tables
        const { adoptions: adoptionsTable, adopterImages, adopterFlags, formSubmissions } = await import('@/db/schema');

        const [otherAdoptions, otherImages, otherEdits, otherFlags, linkedForms] = await Promise.all([
            db.select({ count: sql<number>`COUNT(*)` }).from(adoptionsTable)
                .where(and(eq(adoptionsTable.adopterId, adopterId), sql`${adoptionsTable.addedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterImages)
                .where(and(eq(adopterImages.adopterId, adopterId), sql`${adopterImages.addedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterHistory)
                .where(and(eq(adopterHistory.adopterId, adopterId), sql`${adopterHistory.changedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterFlags)
                .where(eq(adopterFlags.adopterId, adopterId)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(formSubmissions)
                .where(eq(formSubmissions.linkedAdopterId, adopterId)).get(),
        ]);

        const collaborators = {
            adoptions: otherAdoptions?.count || 0,
            images: otherImages?.count || 0,
            edits: otherEdits?.count || 0,
            flags: otherFlags?.count || 0,
            forms: linkedForms?.count || 0,
        };

        const totalOtherContributions = Object.values(collaborators).reduce((a, b) => a + b, 0);
        // Admins bypass the collaboration guard (direct delete, not a request).
        return { canDelete: actorIsAdmin || totalOtherContributions === 0, isOwner: true, collaborators };
    } catch (error) {
        logger.error('Check adopter deletable failed', error, { adopterId });
        return { canDelete: false, isOwner: false, collaborators: { adoptions: 0, images: 0, edits: 0, flags: 0, forms: 0 } };
    }
}

export async function deleteOwnAdopter(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');

        const user = await getUser();
        // v2.19.66: admins can delete ANY profile — owner or not, with or without
        // other contributors — so they can clean up records (e.g. a failed or
        // half-imported test profile). isAdminAsync resolves DB-role admins, not
        // just the bootstrap list. Owners keep the original safety rails below.
        const { isAdminAsync } = await import('@/config/admins');
        const actorIsAdmin = await isAdminAsync(user);

        // Inline ownership check — avoids a full checkAdopterDeletable call
        // to minimize the TOCTOU window. We re-verify ownership + collaboration
        // right before deleting. The window between these queries and the
        // actual delete is ~10-50ms on D1, which is an acceptable risk.
        const adopter = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter) throw new Error('Adopter not found');
        if (!actorIsAdmin && adopter.addedBy !== user) throw new Error('Not the owner');

        // Re-check collaboration inline (not via checkAdopterDeletable to shrink TOCTOU window)
        const { adoptions: adoptionsTable, adopterImages, adopterFlags, formSubmissions } = await import('@/db/schema');
        const [otherAdoptions, otherImages, otherEdits, otherFlags, linkedForms] = await Promise.all([
            db.select({ count: sql<number>`COUNT(*)` }).from(adoptionsTable)
                .where(and(eq(adoptionsTable.adopterId, adopterId), sql`${adoptionsTable.addedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterImages)
                .where(and(eq(adopterImages.adopterId, adopterId), sql`${adopterImages.addedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterHistory)
                .where(and(eq(adopterHistory.adopterId, adopterId), sql`${adopterHistory.changedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterFlags)
                .where(eq(adopterFlags.adopterId, adopterId)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(formSubmissions)
                .where(eq(formSubmissions.linkedAdopterId, adopterId)).get(),
        ]);
        const totalOther = (otherAdoptions?.count || 0) + (otherImages?.count || 0) + (otherEdits?.count || 0) + (otherFlags?.count || 0) + (linkedForms?.count || 0);
        if (!actorIsAdmin && totalOther > 0) throw new Error('Record has contributions from other users');

        // Cascade delete all related data
        const { duplicateTokens, duplicateCandidates } = await import('@/db/schema');

        await Promise.all([
            db.delete(adoptionsTable).where(eq(adoptionsTable.adopterId, adopterId)),
            db.delete(adopterImages).where(eq(adopterImages.adopterId, adopterId)),
            db.delete(adopterHistory).where(eq(adopterHistory.adopterId, adopterId)),
            db.delete(adopterFlags).where(eq(adopterFlags.adopterId, adopterId)),
            db.delete(adopterStats).where(eq(adopterStats.adopterId, adopterId)),
            db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopterId)),
            db.delete(duplicateCandidates).where(sql`${duplicateCandidates.adopter1Id} = ${adopterId} OR ${duplicateCandidates.adopter2Id} = ${adopterId}`),
            db.update(formSubmissions).set({ linkedAdopterId: null }).where(eq(formSubmissions.linkedAdopterId, adopterId)),
        ]);

        await db.delete(adopters).where(eq(adopters.id, adopterId));

        logger.info('Adopter deleted by owner', { adopterId, deletedBy: user });
        logAudit({ userEmail: user, action: 'adopter_deleted', target: adopterId });

        return { success: true };
    } catch (error) {
        const errorId = logger.error('Delete adopter failed', error, { adopterId });
        throw new Error(`Failed to delete adopter (Error ID: ${errorId})`);
    }
}

export async function requestAdopterDeletion(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');

        const user = await getUser();

        // F3: Verify ownership before allowing request
        const adopter = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter || adopter.addedBy !== user) throw new Error('Not the owner');

        const { dataRequests } = await import('@/db/schema');

        // F4: Check for existing pending deletion request to prevent duplicates
        const existing = await db.select({ id: dataRequests.id }).from(dataRequests)
            .where(and(
                eq(dataRequests.adopterId, adopterId),
                eq(dataRequests.requestType, 'deletion'),
                eq(dataRequests.status, 'pending'),
            )).get();
        if (existing) return { success: true, alreadyRequested: true };

        await db.insert(dataRequests).values({
            id: crypto.randomUUID(),
            adopterId,
            requesterName: user,
            requesterEmail: user,
            requestType: 'deletion',
            details: `Owner-initiated deletion request. Record has contributions from other users.`,
            status: 'pending',
            createdAt: new Date(),
        });

        logger.info('Adopter deletion requested', { adopterId, requestedBy: user });
        logAudit({ userEmail: user, action: 'adopter_deletion_requested', target: adopterId });

        // Notify admins (fire-and-forget)
        import('@/app/actions/notifications').then(async ({ notifyAdmins, resolveDisplayName }) => {
            const displayName = await resolveDisplayName(user);
            notifyAdmins({
                actorEmail: user,
                type: 'deletion_request',
                title: '🗑️ Solicitud de eliminación',
                body: `${displayName} solicitó eliminar un registro de adoptante.`,
                url: '/admin/data-requests',
                icon: '🗑️',
                metadata: { adopterId },
            }).catch((e) => {
                logger.warn('notifyAdmins (deletion_request) fire-and-forget failed', {
                    adopterId,
                    actorEmail: user,
                    error: e instanceof Error ? e.message : String(e),
                });
            });
        });

        return { success: true };
    } catch (error) {
        const errorId = logger.error('Request adopter deletion failed', error, { adopterId });
        throw new Error(`Failed to request deletion (Error ID: ${errorId})`);
    }
}

