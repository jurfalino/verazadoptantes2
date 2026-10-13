/**
 * New contact details an exact API call brings for a KNOWN person (Jon,
 * 2026-10-13): added to the profile, with a trail someone can review — a
 * history row naming the key and the call, the entry stamped with the
 * rescuer, the response's `activity.contactsAdded`, and the rescuer's
 * notification. Voiding the call takes them back off (removeApiContacts).
 *
 * Only when the name matched the profile itself: a phone that matched through
 * an alias or a household member belongs to someone else. Server-only.
 */
import { adopterHistory } from '@/db/schema';
import { logger } from '@/lib/logger';
import { casAdopterLists } from '@/lib/adopterListCas';
import {
    contactEntriesToBlob, deserializeContactEntries, mergeContactEntries, parseBlobToContactEntries,
    type ContactEntry,
} from '@/lib/contactEntries';
import type { SearchRequest } from './schemas';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export type ContactField = 'email' | 'phone' | 'documentId';
export interface AddedContact { entryId: string; field: ContactField }

const ENTRY_TYPE: Record<ContactField, ContactEntry['type']> = { email: 'email', phone: 'phone', documentId: 'id' };

/** The person's identifiers that did NOT match this profile: those are the new ones. */
export function newContactFields(person: SearchRequest['person'], matchedOn: string[]): ContactField[] {
    const sent: ContactField[] = [];
    if (person.email) sent.push('email');
    if (person.phone) sent.push('phone');
    if (person.documentId) sent.push('documentId');
    return sent.filter(f => !matchedOn.includes(f));
}

function currentEntries(row: { contactEntries: string | null; contactInfo: string | null }): ContactEntry[] {
    const existing = deserializeContactEntries(row.contactEntries);
    if (existing.length === 0 && row.contactInfo?.trim()) {
        return parseBlobToContactEntries(row.contactInfo).map(e => ({ id: crypto.randomUUID(), ...e }));
    }
    return existing;
}

export async function addApiContacts(
    db: Db,
    profileId: string,
    person: SearchRequest['person'],
    fields: ContactField[],
    who: { ownerEmail: string; keyName: string; requestId: string },
): Promise<AddedContact[]> {
    if (fields.length === 0) return [];
    const proposed: Array<ContactEntry & { field: ContactField }> = fields.map(field => {
        const value = field === 'email' ? person.email! : field === 'phone' ? person.phone! : person.documentId!.value;
        return {
            id: crypto.randomUUID(), type: ENTRY_TYPE[field], value: value.trim(), addedBy: who.ownerEmail, field,
            ...(field === 'documentId' ? { label: 'Documento' } : {}),
        };
    });
    const outcome = await casAdopterLists<AddedContact[]>(db, profileId, row => {
        const existing = currentEntries(row);
        const merged = mergeContactEntries(existing, proposed.map(({ field: _f, ...e }) => e));
        const ids = new Set(merged.map(e => e.id));
        const added = proposed.filter(p => ids.has(p.id)).map(p => ({ entryId: p.id!, field: p.field }));
        if (added.length === 0) return { result: [] };
        return { write: { contactEntries: JSON.stringify(merged), contactInfo: contactEntriesToBlob(merged) || null }, result: added };
    }, { op: 'api.addContacts', requestId: who.requestId });
    if (outcome.status !== 'done') {
        // The activity is saved either way; the contact simply wasn't added this time.
        logger.warn('api: adding contacts to a known profile did not land', { requestId: who.requestId, profileId, status: outcome.status });
        return [];
    }
    const added = outcome.result;
    if (added.length === 0) return [];

    // Kind 'contribution': an API caller is not an editor of the profile. Types only, never values.
    await db.insert(adopterHistory).values({
        id: crypto.randomUUID(), adopterId: profileId, changedBy: `api:${who.keyName}`, kind: 'contribution',
        changes: JSON.stringify({ contacts_added_via_api: { fields: added.map(a => a.field), requestId: who.requestId, rescuer: who.ownerEmail } }),
        changedAt: new Date(),
    });
    // Awaited: the next search by the new email / phone must already find them.
    const { tokenizeAdopter } = await import('@/lib/adopterTokenize');
    await tokenizeAdopter(profileId).catch(e => logger.error('api: tokenize after adding contacts failed', e, { requestId: who.requestId, profileId }));
    logger.info('api: contacts added to a known profile', { requestId: who.requestId, profileId, fields: added.map(a => a.field) });
    return added;
}

/** Void: take back the entries a call added (by entry id; ones edited away since are simply gone). */
export async function removeApiContacts(db: Db, profileId: string, added: AddedContact[], ctx: { actor: string; requestId: string }): Promise<number> {
    if (added.length === 0) return 0;
    const drop = new Set(added.map(a => a.entryId));
    const outcome = await casAdopterLists<number>(db, profileId, row => {
        const existing = deserializeContactEntries(row.contactEntries);
        const kept = existing.filter(e => !e.id || !drop.has(e.id));
        if (kept.length === existing.length) return { result: 0 };
        return { write: { contactEntries: JSON.stringify(kept), contactInfo: contactEntriesToBlob(kept) || null }, result: existing.length - kept.length };
    }, { op: 'api.removeContacts', requestId: ctx.requestId });
    if (outcome.status !== 'done') {
        logger.warn('api void: taking back added contacts did not land', { requestId: ctx.requestId, profileId, status: outcome.status });
        return 0;
    }
    if (outcome.result > 0) {
        const { tokenizeAdopter } = await import('@/lib/adopterTokenize');
        await tokenizeAdopter(profileId).catch(e => logger.error('api void: tokenize after removing contacts failed', e, { requestId: ctx.requestId, profileId }));
    }
    return outcome.result;
}

/** Read the log row's JSON; a bad value reads as nothing to take back, and says so. */
export function parseAddedContacts(raw: string | null | undefined, requestId: string): AddedContact[] {
    if (!raw) return [];
    try {
        const v = JSON.parse(raw) as AddedContact[];
        return Array.isArray(v) ? v.filter(a => a && typeof a.entryId === 'string') : [];
    } catch (e) {
        logger.warn('api: unreadable contacts_added on log row', { requestId, error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

