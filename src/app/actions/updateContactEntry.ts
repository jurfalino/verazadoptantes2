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
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { hashEntryValue, isRealActorEmail } from '@/lib/piiAccess';
import { isAdminAsync } from '@/config/admins';
import { casAdopterLists } from '@/lib/adopterListCas';
import { itemAuthors } from '@/lib/collabAttribution';

// History rows that name an entry by id when it is edited or removed.
const ENTRY_HISTORY_KEYS = ['updated_entry', 'removed_entry'] as const;

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
export type EntryConflict = { kind: 'changed' | 'deleted'; by: string };

export async function updateContactEntry(
    input: { adopterId: string; entryId: string; value: string; streetAndNumber?: string; locality?: string; expectedValue?: string },
): Promise<
    | { ok: true; adopterId: string; entryId: string }
    | { ok: false; error: 'conflict'; conflict: EntryConflict }
    | { ok: false; error: 'busy'; errorId: string }
    | { ok: false; error: string }
> {
    const parsed = updateContactEntrySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid input' };
    const { adopterId, entryId, value, expectedValue } = parsed.data;

    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return { ok: false, error: 'Not authenticated' };

    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'No database' };

        const target = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!target) return { ok: false, error: 'Adopter not found' };
        if (target.deletedAt) return { ok: false, error: 'Cannot edit a deleted adopter' };

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

        type Step =
            | { kind: 'not_found' } | { kind: 'deleted' } | { kind: 'changed' } | { kind: 'forbidden' }
            | { kind: 'noop' }
            | { kind: 'updated'; updated: ContactEntry; previousValueHash: string; newValueHash: string };

        // Re-run on a fresh read after a lost race: the change is re-applied
        // to the current list, so a teammate's edit to ANOTHER entry survives.
        const outcome = await casAdopterLists<Step>(db, adopterId, (row) => {
            const entries = deserializeContactEntries(row.contactEntries);
            const idx = entries.findIndex(e => e.id === entryId);
            // Gone. If the form said what it was editing, that's a teammate's delete.
            if (idx < 0) return { result: expectedValue !== undefined ? { kind: 'deleted' } : { kind: 'not_found' } };
            const original = entries[idx];
            const isOwnContribution = !!original.addedBy && original.addedBy === actor;
            if (!isOwner && !actorIsAdmin && !actorIsOrgMate && !isOwnContribution) return { result: { kind: 'forbidden' } };

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
            // No-op update (same normalized value) — including a teammate
            // having already saved exactly this. Authoritative success; no
            // write, history or tokenize.
            if (previousValueHash === newValueHash) return { result: { kind: 'noop' } };
            // A teammate changed this entry since the form opened: refuse.
            if (expectedValue !== undefined && hashEntryValue(original.type, expectedValue) !== previousValueHash) {
                return { result: { kind: 'changed' } };
            }
            const next = entries.map((e, i) => (i === idx ? updated : e));
            return {
                write: { contactEntries: JSON.stringify(next), contactInfo: contactEntriesToBlob(next) || null },
                result: { kind: 'updated', updated, previousValueHash, newValueHash },
            };
        }, { op: 'updateContactEntry', actor, entryId });

        if (outcome.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (outcome.status === 'busy') return { ok: false, error: 'busy', errorId: outcome.errorId };
        const r = outcome.result;
        if (r.kind === 'not_found') return { ok: false, error: 'Entry not found' };
        if (r.kind === 'forbidden') {
            logger.warn('updateContactEntry: not owner/admin/org-mate/contributor', { adopterId, actor, entryId });
            return { ok: false, error: 'Not authorized to edit this entry.' };
        }
        if (r.kind === 'deleted' || r.kind === 'changed') {
            const by = (await itemAuthors(db, adopterId, [entryId], ENTRY_HISTORY_KEYS))[entryId] ?? '';
            logger.info('updateContactEntry: refused, entry changed meanwhile', { adopterId, actor, entryId, kind: r.kind });
            return { ok: false, error: 'conflict', conflict: { kind: r.kind, by } };
        }
        if (r.kind === 'noop') return { ok: true, adopterId, entryId };

        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: actor,
            kind: 'edit',
            changes: JSON.stringify({
                updated_entry: { type: r.updated.type, id: entryId, previousValueHash: r.previousValueHash, newValueHash: r.newValueHash },
            }),
            changedAt: new Date(),
        });

        await tokenizeAdopter(adopterId).catch(e => {
            logger.error('updateContactEntry: tokenize after edit failed', e, { adopterId });
        });

        logAudit({ userEmail: actor, action: 'contact_entry_updated', target: adopterId, details: { entryId, type: r.updated.type } });

        return { ok: true, adopterId, entryId };
    } catch (error) {
        const errorId = logger.error('updateContactEntry failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}
