'use server';

/**
 * Duplicate-aware import: additively merge an incoming import row into an
 * EXISTING adopter (the "actualizar"/upsert choice on a high-confidence match).
 * Thin orchestrator — the merge DECISIONS live in the pure domain planner
 * `planRecordMerge`; here we just fetch state, run the plan, and apply it via
 * the same open-contribution actions the manual flows use (addContactEntry,
 * saveAdoption). Never destructive: only adds contacts / an activity, and fills
 * a name only when the existing record has none (otherwise the incoming name is
 * added as an alias).
 */

import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters } from '@/db/schema';
import { deserializeContactEntries, type ContactEntry } from '@/lib/contactEntries';
import { isRealActorEmail } from '@/lib/piiAccess';
import { planRecordMerge, type MergeContact } from '@/domain/importMerge';
import { addContactEntry } from './addContactEntry';
import { saveAdoption, getAdoptions } from './adoptions';
import { tokenizeAdopter } from './duplicates';
import { logger } from '@/lib/logger';

export interface ImportUpsertInput {
    adopterId: string;
    name?: string | null;
    /** JSON ContactEntry[] — the incoming row's contacts. */
    contactEntries: string;
    adoption: {
        animalName: string | null; species: string | null; recordType: string;
        rating: number | null; date: string | null; details: string | null; onBehalfOf: string | null;
        neutered?: number | null; age?: string | null;
    };
}

export interface ImportUpsertResult {
    ok: boolean;
    error?: string;
    addedContacts: number;
    addedActivity: boolean;
    nameFilled: boolean;
    aliasAdded: boolean;
}

/** Coerce a stored activity date (Date / epoch / ISO / YYYY-MM-DD) to YYYY-MM-DD
 *  so it compares equal to the import's normalized date — the key to idempotent
 *  re-imports (the POST route stores dates as `new Date(...)`, not the raw string). */
function toYmd(v: unknown): string {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString().slice(0, 10);
    const m = String(v).match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : String(v).slice(0, 10);
}

const toMergeContact = (e: ContactEntry): MergeContact => ({ type: e.type, value: e.value, streetAndNumber: e.streetAndNumber, locality: e.locality });

export async function upsertImportRecord(input: ImportUpsertInput): Promise<ImportUpsertResult> {
    const empty = { addedContacts: 0, addedActivity: false, nameFilled: false, aliasAdded: false };
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return { ok: false, error: 'Not authenticated', ...empty };

    try {
        const db = await getDb();
        if (!db) return { ok: false, error: 'No database', ...empty };

        const existing = await db.select({
            id: adopters.id, name: adopters.name, contactEntries: adopters.contactEntries, deletedAt: adopters.deletedAt,
        }).from(adopters).where(eq(adopters.id, input.adopterId)).get();
        if (!existing) return { ok: false, error: 'Adopter not found', ...empty };
        if (existing.deletedAt) return { ok: false, error: 'Cannot update a deleted adopter', ...empty };

        const rawAdoptions = await getAdoptions(input.adopterId).catch((e) => {
            logger.warn('upsertImportRecord: getAdoptions fallback', { adopterId: input.adopterId, error: e instanceof Error ? e.message : String(e) });
            return [];
        }) as Array<Record<string, unknown>>;
        const existingActivities = rawAdoptions.map(a => ({
            recordType: (a.recordType as string | null) ?? null,
            date: toYmd(a.date),
            details: (a.details as string | null) ?? null,
        }));

        const plan = planRecordMerge({
            existingName: existing.name,
            existingEntries: deserializeContactEntries(existing.contactEntries).map(toMergeContact),
            existingActivities,
            incomingName: input.name,
            incomingEntries: deserializeContactEntries(input.contactEntries).map(toMergeContact),
            incomingActivity: { recordType: input.adoption.recordType, date: input.adoption.date ?? '', details: input.adoption.details },
        });

        let addedContacts = 0;
        for (const c of plan.contactsToAdd) {
            const res = await addContactEntry({ adopterId: input.adopterId, type: c.type as ContactEntry['type'], value: c.value, streetAndNumber: c.streetAndNumber, locality: c.locality });
            if (res.ok && res.appended) addedContacts++;
        }

        let nameFilled = false, aliasAdded = false;
        if (plan.nameAction === 'fill' && plan.nameValue) {
            // DELIBERATE gate bypass: `name` is normally an owner/admin record-wide
            // mutation, but planRecordMerge only returns 'fill' when the existing
            // name is BLANK — so this is a purely additive fill of missing data, not
            // an overwrite of another contributor's value. Any authenticated importer
            // may do it, consistent with the collaborative "adds are open" model. A
            // record that already has a name gets the incoming one as an alias instead.
            await db.update(adopters).set({ name: plan.nameValue }).where(eq(adopters.id, input.adopterId));
            nameFilled = true;
        } else if (plan.nameAction === 'alias' && plan.nameValue) {
            const res = await addContactEntry({ adopterId: input.adopterId, type: 'alias', value: plan.nameValue });
            aliasAdded = res.ok && res.appended;
        }

        if (plan.addActivity) {
            await saveAdoption({
                id: crypto.randomUUID(), // fresh id ⇒ saveAdoption inserts (no existing row)
                adopterId: input.adopterId,
                recordType: input.adoption.recordType as 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet' | 'available' | 'foster',
                animalName: input.adoption.animalName,
                species: input.adoption.species,
                rating: input.adoption.rating,
                date: input.adoption.date ? new Date(input.adoption.date) : null,
                details: input.adoption.details,
                onBehalfOf: input.adoption.onBehalfOf,
                neutered: input.adoption.neutered ?? null,
                age: input.adoption.age ?? null,
            });
        }

        // Re-tokenize so the newly added contacts / filled name are matchable.
        await tokenizeAdopter(input.adopterId).catch((e) => logger.warn('upsertImportRecord: tokenize fallback', { adopterId: input.adopterId, error: e instanceof Error ? e.message : String(e) }));

        return { ok: true, addedContacts, addedActivity: plan.addActivity, nameFilled, aliasAdded };
    } catch (e) {
        const errorId = logger.error('upsertImportRecord failed', e, { adopterId: input.adopterId, actorEmail: actor });
        return { ok: false, error: `Failed to update (ID: ${errorId})`, ...empty };
    }
}
