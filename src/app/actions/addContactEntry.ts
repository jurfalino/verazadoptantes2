'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, adopterHistory, piiAccessGrants } from '@/db/schema';
import { addContactEntrySchema } from './validation';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import {
    deserializeContactEntries,
    mergeContactEntries,
    contactEntriesToBlob,
    joinedAddressValue,
    parseBlobToContactEntries,
    type ContactEntry,
} from '@/lib/contactEntries';
import { tokenizeAdopter } from './duplicates';
import { hashEntryValue, isRealActorEmail } from '@/lib/piiAccess';
import { createNotification, resolveDisplayName } from './notifications';
import { getAdopterApprovers } from './piiAccess';

/**
 * Append-only contribution path. Open to ANY authenticated user, regardless
 * of ownership or editor status. Companion to saveAdopter (which mutates and
 * is owner+admin-gated). See `project_collaborative_vetting_model` memory
 * for the why: contributing data is open, exposing PII is what gating
 * restricts.
 *
 * Side effects:
 *   1. UPDATE adopters.contactEntries (deduped via mergeContactEntries).
 *   2. INSERT adopter_history kind='contribution' (does NOT promote the
 *      contributor to "editor" — see piiAccessServer.ts kind filter).
 *   3. INSERT pii_access_grant scope='entry', origin='contribution',
 *      entryRef=hash(value) so the contributor sees the value they typed
 *      even under PII gating (same model as a search-match grant).
 *   4. Re-tokenize so the new entry is searchable.
 *   5. Notify owner + editors (kind='edit' only — contributors are not
 *      notified, they have no special standing).
 *
 * Idempotent: re-adding an entry already on the profile is a no-op for the
 * adopter row, but still ensures the grant exists so the actor sees what
 * they demonstrated knowledge of.
 */
/**
 * Status of the addContactEntry operation:
 *  - `appended` — value was new; a new entry was written to contactEntries.
 *  - `unlocked_existing` — value matched an existing (possibly masked)
 *    entry; nothing new written, but a fresh pii_access_grant was inserted,
 *    so a previously-masked entry is now visible to the actor on next read.
 *  - `no_change` — value matched an existing entry AND a live grant already
 *    existed (actor had access). No observable change.
 */
export type AddContactEntryStatus = 'appended' | 'unlocked_existing' | 'no_change';

export async function addContactEntry(
    input: { adopterId: string; type: ContactEntry['type']; value: string; streetAndNumber?: string; locality?: string },
): Promise<{ ok: true; adopterId: string; appended: boolean; status: AddContactEntryStatus } | { ok: false; error: string }> {
    const parsed = addContactEntrySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid input' };
    const { adopterId, type, value } = parsed.data;

    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return { ok: false, error: 'Not authenticated' };

    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'No database' };

        const target = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!target) return { ok: false, error: 'Adopter not found' };
        if (target.deletedAt) return { ok: false, error: 'Cannot contribute to a deleted adopter' };

        const newEntry: ContactEntry = type === 'address' && (parsed.data.streetAndNumber || parsed.data.locality)
            ? {
                id: crypto.randomUUID(),
                type: 'address',
                value: joinedAddressValue(parsed.data.streetAndNumber ?? '', parsed.data.locality ?? '') || value,
                streetAndNumber: parsed.data.streetAndNumber || undefined,
                locality: parsed.data.locality || undefined,
                addedBy: actor,
            }
            : { id: crypto.randomUUID(), type, value, addedBy: actor };

        // Lazy legacy-row migration: rows that pre-date the structured
        // contactEntries column have NULL contactEntries but a populated
        // contactInfo blob. Before merging the new entry, parse the blob and
        // seed those entries with fresh IDs so the structured column is
        // populated correctly. Without this, the merge would emit only the
        // new entry and saving would overwrite contactInfo with just that —
        // silently destroying every other phone/email/address on the row.
        // After migration the structured column wins; this branch never
        // fires again for the same row.
        let existing = deserializeContactEntries(target.contactEntries);
        if (existing.length === 0 && target.contactInfo && target.contactInfo.trim()) {
            const fromBlob = parseBlobToContactEntries(target.contactInfo);
            if (fromBlob.length > 0) {
                existing = fromBlob.map(e => ({ id: crypto.randomUUID(), ...e }));
                logger.info('addContactEntry: lazy legacy contactEntries migration', {
                    adopterId, parsedCount: existing.length,
                });
            }
        }
        const merged = mergeContactEntries(existing, [newEntry]);
        const appended = merged.length !== existing.length;
        const structuralWrite = appended || merged.length !== deserializeContactEntries(target.contactEntries).length;

        if (structuralWrite) {
            // Optimistic concurrency: only commit if updatedAt hasn't shifted
            // since we read the row. Mirrors saveAdopter's pattern (adopters.ts:248).
            // Without this, two contributors hitting addContactEntry on the
            // same row at the same time both read the same `existing`, both
            // append, last-writer-wins, and the other's entry vanishes.
            const updateResult = await db.update(adopters)
                .set({
                    contactEntries: JSON.stringify(merged),
                    contactInfo: contactEntriesToBlob(merged) || null,
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(adopters.id, adopterId),
                    target.updatedAt
                        ? eq(adopters.updatedAt, target.updatedAt)
                        : isNull(adopters.updatedAt),
                ));
            const rowsAffected = (updateResult as unknown as { rowsAffected?: number }).rowsAffected ?? 1;
            if (rowsAffected === 0) {
                logger.warn('addContactEntry: concurrent modification — retry needed', { adopterId, actor });
                return { ok: false, error: 'This record was modified by another user. Please refresh and try again.' };
            }

            if (appended) {
                // History with kind='contribution' — does NOT make the writer an editor.
                // Intentionally omit the value from `changes` to limit PII spread.
                await db.insert(adopterHistory).values({
                    id: crypto.randomUUID(),
                    adopterId,
                    changedBy: actor,
                    kind: 'contribution',
                    changes: JSON.stringify({ contributed_entry: { type } }),
                    changedAt: new Date(),
                });
            }
        }

        // Grant the contributor entry-scope visibility on the value they typed —
        // same model as origin='search_match'. Idempotent: skip if a live grant
        // for this (grantee, adopter, ref) already exists. Skip entirely for
        // `alias` — alias entries are not PII-gated (name-like, visible to all
        // viewers), so a grant would be inert.
        // The boolean tells us whether a NEW grant was created; combined with
        // `appended` below it drives the response status that the UI surfaces
        // as a contextual toast ("added" vs "you unlocked an existing entry").
        let grantInserted = false;
        if (newEntry.type !== 'alias') {
            grantInserted = await insertContributionGrant(db, adopterId, actor, newEntry);
        }

        if (appended) {
            // Tokenize awaited so duplicate detection sees the new entry
            // before the response returns (Workers kill fire-and-forget).
            await tokenizeAdopter(adopterId).catch(e => {
                logger.error('addContactEntry: tokenize after add failed', e, { adopterId });
            });
            notifyApprovers(adopterId, target.name, actor, type).catch(e => {
                logger.error('addContactEntry: notify approvers failed', e, { adopterId, actor });
            });
            logAudit({ userEmail: actor, action: 'contact_entry_added', target: adopterId, details: { type } });
        }

        // Derive the user-facing status:
        //  - `appended`: a brand-new entry was written.
        //  - `unlocked_existing`: dedup collapsed the value into an existing
        //    entry AND a new pii_access_grant was inserted for the actor —
        //    so on next render a previously-masked chip will reveal itself.
        //    This is the "you proved you know this value, here it is" path.
        //  - `no_change`: dedup collapsed AND no new grant was needed (the
        //    actor already had access, or the type was alias and doesn't
        //    carry grants). Genuinely a no-op for the viewer.
        const status: AddContactEntryStatus = appended
            ? 'appended'
            : grantInserted
                ? 'unlocked_existing'
                : 'no_change';
        return { ok: true, adopterId, appended, status };
    } catch (error) {
        const errorId = logger.error('addContactEntry failed', error, { adopterId, actor });
        return { ok: false, error: `Failed (Error ID: ${errorId})` };
    }
}

async function insertContributionGrant(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    adopterId: string,
    actor: string,
    entry: ContactEntry,
): Promise<boolean> {
    const ref = hashEntryValue(entry.type, entry.value);
    const existing = await db.select({ id: piiAccessGrants.id }).from(piiAccessGrants)
        .where(and(
            eq(piiAccessGrants.adopterId, adopterId),
            eq(piiAccessGrants.granteeEmail, actor),
            eq(piiAccessGrants.entryRef, ref),
            isNull(piiAccessGrants.revokedAt),
        )).get();
    if (existing) return false;
    await db.insert(piiAccessGrants).values({
        id: crypto.randomUUID(),
        adopterId,
        granteeEmail: actor,
        scope: 'entry',
        entryRef: ref,
        origin: 'contribution',
        grantedByEmail: actor,
        createdAt: new Date(),
    });
    return true;
}

async function notifyApprovers(
    adopterId: string,
    adopterName: string | null,
    actor: string,
    type: ContactEntry['type'],
): Promise<void> {
    const { owner, editors } = await getAdopterApprovers(adopterId);
    const recipients = new Set<string>([...(owner ? [owner] : []), ...editors]);
    recipients.delete(actor);
    if (recipients.size === 0) return;
    const actorName = await resolveDisplayName(actor);
    const displayName = adopterName || 'el adoptante';
    const typeLabel: Record<ContactEntry['type'], string> = {
        phone: 'un teléfono',
        email: 'un email',
        social: 'una red social',
        id: 'un documento',
        address: 'una dirección',
        alias: 'un nombre alternativo',
        other: 'un dato de contacto',
    };
    await Promise.all([...recipients].map(email => createNotification({
        userId: email,
        type: 'contact_entry_added',
        title: 'Nuevo dato de contacto',
        body: `${actorName} agregó ${typeLabel[type]} a ${displayName}.`,
        url: `/adopter/${adopterId}`,
        icon: '+',
        metadata: { adopterId, contributor: actor, entryType: type },
    })));
}
