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
    type ContactEntry,
} from '@/lib/contactEntries';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { hashEntryValue, isRealActorEmail } from '@/lib/piiAccess';
import { isAdminAsync } from '@/config/admins';
import { casAdopterLists } from '@/lib/adopterListCas';
import { itemAuthors } from '@/lib/collabAttribution';
import type { EntryConflict } from './updateContactEntry';

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
    input: { adopterId: string; entryId: string; expectedValue?: string },
): Promise<
    | { ok: true; adopterId: string; entryId: string }
    | { ok: false; error: 'conflict'; conflict: EntryConflict }
    | { ok: false; error: 'busy'; errorId: string }
    | { ok: false; error: string }
> {
    const parsed = removeContactEntrySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid input' };
    const { adopterId, entryId, expectedValue } = parsed.data;

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
        // of this entry (matching updateContactEntry's relaxation). Entries
        // with no `addedBy` (legacy / blob-migrated) stay owner+admin-only.
        const isOwner = target.addedBy === actor;
        const [actorIsAdmin, actorIsOrgMate] = await Promise.all([
            isAdminAsync(actor),
            (await import('@/lib/orgMembership')).isOrgMate(actor, target.addedBy),
        ]);

        type Step =
            | { kind: 'not_found' } | { kind: 'deleted' } | { kind: 'changed' } | { kind: 'forbidden' }
            | { kind: 'removed'; removed: ContactEntry };

        // Re-run on a fresh read after a lost race: only THIS entry is taken
        // out of the current list, so a teammate's concurrent add or edit survives.
        const outcome = await casAdopterLists<Step>(db, adopterId, (row) => {
            const entries = deserializeContactEntries(row.contactEntries);
            const idx = entries.findIndex(e => e.id === entryId);
            if (idx < 0) return { result: expectedValue !== undefined ? { kind: 'deleted' } : { kind: 'not_found' } };
            const removed = entries[idx];
            const isOwnContribution = !!removed.addedBy && removed.addedBy === actor;
            if (!isOwner && !actorIsAdmin && !actorIsOrgMate && !isOwnContribution) return { result: { kind: 'forbidden' } };
            // A teammate changed it since this was shown: don't delete what the
            // person hasn't seen.
            if (expectedValue !== undefined && hashEntryValue(removed.type, expectedValue) !== hashEntryValue(removed.type, removed.value)) {
                return { result: { kind: 'changed' } };
            }
            const remaining = [...entries.slice(0, idx), ...entries.slice(idx + 1)];
            return {
                write: { contactEntries: remaining.length ? JSON.stringify(remaining) : null, contactInfo: contactEntriesToBlob(remaining) || null },
                result: { kind: 'removed', removed },
            };
        }, { op: 'removeContactEntry', actor, entryId });

        if (outcome.status === 'missing') return { ok: false, error: 'Adopter not found' };
        if (outcome.status === 'busy') return { ok: false, error: 'busy', errorId: outcome.errorId };
        const r = outcome.result;
        if (r.kind === 'not_found') return { ok: false, error: 'Entry not found' };
        if (r.kind === 'forbidden') {
            logger.warn('removeContactEntry: not owner/admin/org-mate/contributor', { adopterId, actor, entryId });
            return { ok: false, error: 'Not authorized to remove this entry.' };
        }
        if (r.kind === 'deleted' || r.kind === 'changed') {
            const by = (await itemAuthors(db, adopterId, [entryId], ['updated_entry', 'removed_entry']))[entryId] ?? '';
            logger.info('removeContactEntry: refused, entry changed meanwhile', { adopterId, actor, entryId, kind: r.kind });
            return { ok: false, error: 'conflict', conflict: { kind: r.kind, by } };
        }
        const removed = r.removed;
        const removedHash = hashEntryValue(removed.type, removed.value);

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
            logger.error('removeContactEntry: tokenize after remove failed', e, { adopterId });
        });

        logAudit({ userEmail: actor, action: 'contact_entry_removed', target: adopterId, details: { entryId, type: removed.type } });

        return { ok: true, adopterId, entryId };
    } catch (error) {
        const errorId = logger.error('removeContactEntry failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}
