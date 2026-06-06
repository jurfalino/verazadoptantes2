'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, adopterHistory, piiAccessGrants } from '@/db/schema';
import { removeContactEntrySchema } from './validation';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import {
    deserializeContactEntries,
    contactEntriesToBlob,
} from '@/lib/contactEntries';
import { tokenizeAdopter } from './duplicates';
import { hashEntryValue, isRealActorEmail } from '@/lib/piiAccess';
import { isAdminAsync } from '@/config/admins';

/**
 * Owner+admin-gated removal of a single contact entry, identified by its
 * stable `id`. Append-only is the contributor's only mutation path; removal
 * is structural and stays with the record steward.
 *
 * Side effects on success:
 *   1. UPDATE adopters.contactEntries (entry filtered out, list re-serialized).
 *   2. INSERT adopter_history kind='edit' with the removed entry's type + id
 *      (no raw value).
 *   3. Revoke any live pii_access_grant rows whose entryRef hashes the removed
 *      value — explicit revoke for audit clarity (they'd go inert on their own
 *      because nothing in contactEntries still hashes to that ref).
 *   4. Re-tokenize so search no longer matches the removed value.
 *
 * Alias entries carry no grants (not PII), so step 3 is a no-op for them.
 */
export async function removeContactEntry(
    input: { adopterId: string; entryId: string },
): Promise<{ ok: true; adopterId: string; entryId: string } | { ok: false; error: string }> {
    const parsed = removeContactEntrySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid input' };
    const { adopterId, entryId } = parsed.data;

    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return { ok: false, error: 'Not authenticated' };

    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'No database' };

        const target = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!target) return { ok: false, error: 'Adopter not found' };
        if (target.deletedAt) return { ok: false, error: 'Cannot edit a deleted adopter' };

        const entries = deserializeContactEntries(target.contactEntries);
        const idx = entries.findIndex(e => e.id === entryId);
        if (idx < 0) return { ok: false, error: 'Entry not found' };

        const removed = entries[idx];

        // Per-entry mutation gate: owner, admin, OR the original contributor
        // of this entry (matching updateContactEntry's relaxation). Entries
        // with no `addedBy` (legacy / blob-migrated) stay owner+admin-only.
        const isOwner = target.addedBy === actor;
        const [actorIsAdmin, actorIsOrgMate] = await Promise.all([
            isAdminAsync(actor),
            (await import('@/lib/orgMembership')).isOrgMate(actor, target.addedBy),
        ]);
        const isOwnContribution = !!removed.addedBy && removed.addedBy === actor;
        if (!isOwner && !actorIsAdmin && !actorIsOrgMate && !isOwnContribution) {
            logger.warn('removeContactEntry: not owner/admin/org-mate/contributor', { adopterId, actor, entryId });
            return { ok: false, error: 'Not authorized to remove this entry.' };
        }

        const removedHash = hashEntryValue(removed.type, removed.value);
        const remaining = [...entries.slice(0, idx), ...entries.slice(idx + 1)];

        await db.update(adopters)
            .set({
                contactEntries: remaining.length ? JSON.stringify(remaining) : null,
                contactInfo: contactEntriesToBlob(remaining) || null,
                updatedAt: new Date(),
            })
            .where(eq(adopters.id, adopterId));

        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: actor,
            kind: 'edit',
            changes: JSON.stringify({ removed_entry: { type: removed.type, id: entryId } }),
            changedAt: new Date(),
        });

        // Revoke any live grants for this exact entryRef. Drizzle update over
        // (adopterId, entryRef, revokedAt IS NULL) — fan-out across multiple
        // grantees in one statement.
        if (removed.type !== 'alias') {
            await db.update(piiAccessGrants)
                .set({ revokedAt: new Date(), revokedByEmail: actor })
                .where(and(
                    eq(piiAccessGrants.adopterId, adopterId),
                    eq(piiAccessGrants.entryRef, removedHash),
                    isNull(piiAccessGrants.revokedAt),
                ));
        }

        await tokenizeAdopter(adopterId).catch(e => {
            logger.warn('removeContactEntry: tokenize after remove failed', {
                adopterId, error: e instanceof Error ? e.message : String(e),
            });
        });

        logAudit({ userEmail: actor, action: 'contact_entry_removed', target: adopterId, details: { entryId, type: removed.type } });

        // v2.18.11: owner awareness on non-self contact removals.
        if (target.addedBy && target.addedBy !== actor) {
            import('@/app/actions/notifications').then(({ notifyOwnerOfOrgMateChange }) =>
                notifyOwnerOfOrgMateChange({
                    adopterId,
                    adopterName: target.name || '',
                    ownerEmail: target.addedBy,
                    editorEmail: actor,
                    changeKind: 'contact_remove',
                    summary: `Removió un contacto (${removed.type}).`,
                })
            ).catch((e) => logger.warn('notifyOwnerOfOrgMateChange dispatch failed', {
                adopterId, error: e instanceof Error ? e.message : String(e),
            }));
        }

        return { ok: true, adopterId, entryId };
    } catch (error) {
        const errorId = logger.error('removeContactEntry failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}
