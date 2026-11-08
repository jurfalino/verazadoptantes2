/**
 * F4 — the address a record was «Entregado en casa del adoptante» at goes into
 * the profile's contacts, on the server, every time a save lands it (creating
 * the record, or editing it later). Plain module, NOT 'use server': a helper
 * saveAdoption calls, never a browser-callable endpoint.
 *
 * - Only records that store the delivery (recordHandoverFields: adoption,
 *   «Tránsito») copy anything.
 * - Adding a contact is open to anyone signed in, as with addContactEntry: the
 *   profile's own people (owner, teammate, admin, moderator) write an 'edit'
 *   history row, anyone else a 'contribution' (historyKindFor), which grants
 *   nothing. No real actor, or a deleted profile: skipped and logged.
 * - Merged into the contacts as they are NOW (compare-and-swap), deduplicated
 *   by mergeContactEntries: an address already there is not added twice.
 * - Never fails the save: the record is already written. Every failure is logged.
 */
import { adopterHistory } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { casAdopterLists } from '@/lib/adopterListCas';
import { historyKindFor } from '@/lib/profilePrivilege';
import { isRealActorEmail } from '@/lib/piiAccess';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { deserializeContactEntries, parseBlobToContactEntries, mergeContactEntries, contactEntriesToBlob, contactCapExceeded, type ContactEntry } from '@/lib/contactEntries';
import { recordHandoverFields, splitDeliveryAddress, joinDeliveryAddress } from '@/domain/recordEditAccess';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface DeliveryAddressCopyInput {
    adopterId: string | null | undefined;
    recordType: string | null | undefined;
    deliveredToHome: unknown;
    verifiedAddress: string | null | undefined;
    changedBy: string;
    /** Which save path (for the logs). */
    op: string;
}

export async function copyDeliveryAddressToContacts(db: Db, input: DeliveryAddressCopyInput): Promise<void> {
    const { adopterId, recordType, changedBy, op } = input;
    const delivered = input.deliveredToHome === 1 || input.deliveredToHome === true;
    const verified = (input.verifiedAddress ?? '').trim();
    if (!adopterId || !delivered || !verified || !recordHandoverFields(recordType).deliveredToHome) return;

    try {
        if (!isRealActorEmail(changedBy)) {
            logger.warn('saveAdoption: delivery address not copied to contacts — no real actor', { adopterId, changedBy, recordType, op });
            return;
        }
        // The profile's own people edit its contacts; anyone else contributes.
        const kind = await historyKindFor(db, adopterId, changedBy);

        const parts = splitDeliveryAddress(verified);
        const entry: ContactEntry = {
            id: crypto.randomUUID(),
            type: 'address',
            value: joinDeliveryAddress(parts),
            ...(parts.streetAndNumber ? { streetAndNumber: parts.streetAndNumber } : {}),
            ...(parts.locality ? { locality: parts.locality } : {}),
            addedBy: changedBy,
        };
        const added = await casAdopterLists<{ from: string | null; to: string | null } | null>(db, adopterId, (row) => {
            const current = deserializeContactEntries(row.contactEntries);
            const base = current.length ? current : parseBlobToContactEntries(row.contactInfo).map(e => ({ id: crypto.randomUUID(), ...e }));
            const merged = mergeContactEntries(base, [entry]);
            if (merged.length === base.length) return { result: null };
            if (contactCapExceeded(merged)) {
                // S1: never past the cap (a later read would truncate). The record is saved.
                logger.warn('saveAdoption: verified address not added — the profile holds the maximum contact entries', { adopterId, changedBy, op });
                return { result: null };
            }
            const blob = contactEntriesToBlob(merged) || null;
            return { write: { contactEntries: JSON.stringify(merged), contactInfo: blob }, result: { from: row.contactInfo, to: blob } };
        }, { op: `${op}.verifiedAddress`, changedBy }, { requireLive: true });

        if (added.status === 'busy') {
            // The record is saved; only the address copy didn't land. Logged with its id.
            logger.error('saveAdoption: verified address not added to contacts (busy)', new Error('busy'), { adopterId, changedBy, op, errorId: added.errorId });
            return;
        }
        if (added.status === 'missing') {
            logger.warn('saveAdoption: delivery address not copied to contacts — the profile is missing or deleted', { adopterId, changedBy, recordType, op });
            return;
        }
        if (!added.wrote || !added.result) return;

        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy,
            kind,
            changes: JSON.stringify({
                contactInfo: {
                    from: added.result.from || '(empty)',
                    to: added.result.to,
                    reason: 'verified_during_pet_delivery',
                },
            }),
            changedAt: new Date(),
        });
        await tokenizeAdopter(adopterId).catch(e => { logger.error('Tokenize adopter failed (verified address)', e, { adopterId, changedBy, op }); });
    } catch (e) {
        // The record is saved; the copy failed. Never fail the save over it.
        logger.error('saveAdoption: delivery address copy to contacts failed', e, { adopterId, changedBy, recordType, op });
    }
}
