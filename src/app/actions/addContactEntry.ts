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
export async function addContactEntry(
    input: { adopterId: string; type: ContactEntry['type']; value: string; streetAndNumber?: string; locality?: string },
): Promise<{ ok: true; adopterId: string; appended: boolean } | { ok: false; error: string }> {
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
                type: 'address',
                value: joinedAddressValue(parsed.data.streetAndNumber ?? '', parsed.data.locality ?? '') || value,
                streetAndNumber: parsed.data.streetAndNumber || undefined,
                locality: parsed.data.locality || undefined,
            }
            : { type, value };

        const existing = deserializeContactEntries(target.contactEntries);
        const merged = mergeContactEntries(existing, [newEntry]);
        const appended = merged.length !== existing.length;

        if (appended) {
            await db.update(adopters)
                .set({
                    contactEntries: JSON.stringify(merged),
                    contactInfo: contactEntriesToBlob(merged) || null,
                    updatedAt: new Date(),
                })
                .where(eq(adopters.id, adopterId));

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

        // Grant the contributor entry-scope visibility on the value they typed —
        // same model as origin='search_match'. Idempotent: skip if a live grant
        // for this (grantee, adopter, ref) already exists.
        await insertContributionGrant(db, adopterId, actor, newEntry);

        if (appended) {
            // Fire-and-forget side effects.
            tokenizeAdopter(adopterId).catch(e => {
                logger.warn('addContactEntry: tokenize after add failed', {
                    adopterId, error: e instanceof Error ? e.message : String(e),
                });
            });
            notifyApprovers(adopterId, target.name, actor, type).catch(e => {
                logger.warn('addContactEntry: notify approvers failed', {
                    adopterId, actor, error: e instanceof Error ? e.message : String(e),
                });
            });
            logAudit({ userEmail: actor, action: 'contact_entry_added', target: adopterId, details: { type } });
        }

        return { ok: true, adopterId, appended };
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
): Promise<void> {
    const ref = hashEntryValue(entry.type, entry.value);
    const existing = await db.select({ id: piiAccessGrants.id }).from(piiAccessGrants)
        .where(and(
            eq(piiAccessGrants.adopterId, adopterId),
            eq(piiAccessGrants.granteeEmail, actor),
            eq(piiAccessGrants.entryRef, ref),
            isNull(piiAccessGrants.revokedAt),
        )).get();
    if (existing) return;
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
