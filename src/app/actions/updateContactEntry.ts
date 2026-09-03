'use server';

import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, adopterHistory } from '@/db/schema';
import { updateContactEntrySchema } from './validation';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import {
    deserializeContactEntries,
    contactEntriesToBlob,
    joinedAddressValue,
    detectSocialPlatform,
    type ContactEntry,
} from '@/lib/contactEntries';
import { tokenizeAdopter } from './duplicates';
import { hashEntryValue, isRealActorEmail } from '@/lib/piiAccess';
import { isAdminAsync } from '@/config/admins';

/**
 * Owner+admin-gated update of a single contact entry, identified by its stable
 * `id`. Type is not editable here — change-of-type is delete + add.
 *
 * Side effects on success:
 *   1. UPDATE adopters.contactEntries (entry mutated in place, list re-serialized).
 *   2. INSERT adopter_history kind='edit' with hashed before/after values
 *      (no raw PII in history.changes).
 *   3. Re-tokenize so search reflects the new value.
 *
 * Notes:
 *   - Existing `pii_access_grant` rows with entryRef = hash(oldValue) become
 *     inert naturally (the new value hashes differently). They are NOT
 *     explicitly revoked — the grant proves the grantee knew the *old* value,
 *     which is a feature (see v2.15.0 design notes).
 *   - `'alias'` entries follow the same gate. Aliases are name-like, not PII,
 *     so they don't carry grants — nothing additional to clean up.
 */
export async function updateContactEntry(
    input: { adopterId: string; entryId: string; value: string; streetAndNumber?: string; locality?: string },
): Promise<{ ok: true; adopterId: string; entryId: string } | { ok: false; error: string }> {
    const parsed = updateContactEntrySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid input' };
    const { adopterId, entryId, value } = parsed.data;

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

        const original = entries[idx];

        // Per-entry mutation gate: owner, admin, OR the original contributor
        // of this specific entry. The contributor-self carve-out lets people
        // fix typos in entries they themselves added (e.g. "ac@gmaio.com" →
        // "ac@gmail.com"). Owner+admin keep their record-wide edit power;
        // contributors only get rights on entries that carry their `addedBy`.
        // Entries with no `addedBy` (legacy / blob-migrated / pre-2.16.0-9)
        // stay owner+admin-only by virtue of failing the third check.
        const isOwner = target.addedBy === actor;
        const [actorIsAdmin, actorIsOrgMate] = await Promise.all([
            isAdminAsync(actor),
            (await import('@/lib/orgMembership')).isOrgMate(actor, target.addedBy),
        ]);
        const isOwnContribution = !!original.addedBy && original.addedBy === actor;
        if (!isOwner && !actorIsAdmin && !actorIsOrgMate && !isOwnContribution) {
            logger.warn('updateContactEntry: not owner/admin/org-mate/contributor', { adopterId, actor, entryId });
            return { ok: false, error: 'Not authorized to edit this entry.' };
        }

        const previousValueHash = hashEntryValue(original.type, original.value);

        // Preserve the original `addedBy` on the updated entry — an edit by
        // the owner doesn't reattribute the entry, and an edit by the
        // contributor themselves trivially keeps them as the attributed
        // contributor.
        const updated: ContactEntry = original.type === 'address' && (parsed.data.streetAndNumber || parsed.data.locality)
            ? {
                id: original.id,
                type: 'address',
                value: joinedAddressValue(parsed.data.streetAndNumber ?? '', parsed.data.locality ?? '') || value,
                streetAndNumber: parsed.data.streetAndNumber || undefined,
                locality: parsed.data.locality || undefined,
                ...(original.addedBy ? { addedBy: original.addedBy } : {}),
            }
            : {
                id: original.id,
                type: original.type,
                value,
                ...(original.label ? { label: original.label } : {}),
                ...(original.addedBy ? { addedBy: original.addedBy } : {}),
                // Re-deduce the social network from the new value (URL); keep the
                // prior platform for a bare handle.
                ...(original.type === 'social' && (detectSocialPlatform(value) ?? original.platform)
                    ? { platform: detectSocialPlatform(value) ?? original.platform }
                    : {}),
                // Preserve messaging apps on a phone (picker sends `apps`; else keep).
                ...(original.type === 'phone' && ((parsed.data.apps ?? original.apps)?.length)
                    ? { apps: parsed.data.apps ?? original.apps }
                    : {}),
            };

        const newValueHash = hashEntryValue(updated.type, updated.value);
        if (previousValueHash === newValueHash) {
            // No-op update (same normalized value). Still authoritative success,
            // but skip the write + history + tokenize.
            return { ok: true, adopterId, entryId };
        }

        entries[idx] = updated;

        await db.update(adopters)
            .set({
                contactEntries: JSON.stringify(entries),
                contactInfo: contactEntriesToBlob(entries) || null,
                updatedAt: new Date(),
            })
            .where(eq(adopters.id, adopterId));

        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: actor,
            kind: 'edit',
            changes: JSON.stringify({
                updated_entry: { type: updated.type, id: entryId, previousValueHash, newValueHash },
            }),
            changedAt: new Date(),
        });

        await tokenizeAdopter(adopterId).catch(e => {
            logger.error('updateContactEntry: tokenize after edit failed', e, { adopterId });
        });

        logAudit({ userEmail: actor, action: 'contact_entry_updated', target: adopterId, details: { entryId, type: updated.type } });

        return { ok: true, adopterId, entryId };
    } catch (error) {
        const errorId = logger.error('updateContactEntry failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}
