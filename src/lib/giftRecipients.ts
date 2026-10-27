/**
 * Gift recipients on the giver's profile (spec «Gift recipient», Jon
 * 2026-10-27). The form can't tell whose name and phone it gave — the
 * recipient's or the requester's — so no profile is made by itself: the
 * recipient is FORM DATA, read from the answers of the gift forms linked to
 * the giver (`form_submissions.linked_adopter_id`, re-pointed when a rescuer
 * links the form elsewhere). The giver's profile shows it as «Destinatario del
 * regalo (según el formulario)», and searching that phone finds the giver
 * (`giftRecipientTokenEntries`, indexed with the giver's own tokens).
 * «Crear perfil de {nombre}» makes the profile (createGiftRecipientProfile);
 * its gift-household membership carries `source_key = gift-{submissionId}`.
 *
 * Plain server module (NOT 'use server'). Kept small on purpose: the
 * tokenizer imports it. D1: one bounded query per profile, no IN lists.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { adopters, formSubmissions, householdMemberships } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { parseGiftRecipient, recipientFullName } from '@/domain/giftRecipient';
import type { FormRelationship } from '@/domain/householdPeople';
import type { TokenEntry } from '@/lib/tokenizer';
import { logger } from '@/lib/logger';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Gift forms read per giver at most (newest first). */
export const MAX_GIFT_FORMS_PER_PROFILE = 10;
/** Who the form's data is credited to (contacts of a profile made from it, tokens). */
export const FORM_SENTINEL = 'form-submission';

/** The source_key of the gift membership «Crear perfil» makes for one form. */
export const giftSourceKey = (submissionId: string) => `gift-${submissionId}`;

export type FormGiftRecipient = {
    submissionId: string;
    /** «Nombre Apellido» exactly as the form gave it (only fully named recipients reach the profile, as before). */
    name: string;
    relationship: FormRelationship;
    phone: string | null;
    /** The form's submission date, seconds or Date as stored. */
    submittedAt: Date | null;
    /** The profile «Crear perfil» made for this form, while it is live; null = not made yet. */
    profileId: string | null;
};

type SubmissionRow = { id: string; answersJson: string | null; createdAt: Date | null };

function recipientOf(row: SubmissionRow): Omit<FormGiftRecipient, 'profileId'> | null {
    let answers: unknown;
    try {
        answers = row.answersJson ? JSON.parse(row.answersJson) : null;
    } catch (e) {
        logger.warn('giftRecipients: answers unreadable, form skipped', { submissionId: row.id, error: e instanceof Error ? e.message : String(e) });
        return null;
    }
    const r = parseGiftRecipient((answers as { giftRecipient?: unknown } | null)?.giftRecipient);
    const name = r ? recipientFullName(r) : null;
    if (!r || !name) return null;
    return { submissionId: row.id, name, relationship: r.relationship, phone: r.phone ?? null, submittedAt: row.createdAt ?? null };
}

/** The gift forms linked to this profile, newest first, bounded. Throws on a DB failure. */
async function giftSubmissionsOf(db: Db, adopterId: string): Promise<SubmissionRow[]> {
    return await db.select({ id: formSubmissions.id, answersJson: formSubmissions.answersJson, createdAt: formSubmissions.createdAt })
        .from(formSubmissions)
        .where(and(eq(formSubmissions.linkedAdopterId, adopterId), eq(formSubmissions.intent, 'gift')))
        .orderBy(desc(formSubmissions.createdAt))
        .limit(MAX_GIFT_FORMS_PER_PROFILE).all() as SubmissionRow[];
}

/** The live profile «Crear perfil» made for this form, if any. */
export async function giftProfileOf(db: Db, submissionId: string): Promise<string | null> {
    const row = await db.select({ adopterId: householdMemberships.adopterId }).from(householdMemberships)
        .innerJoin(adopters, eq(adopters.id, householdMemberships.adopterId))
        .where(and(eq(householdMemberships.sourceKey, giftSourceKey(submissionId)), isNull(adopters.deletedAt)))
        .limit(1).get() as { adopterId: string } | undefined;
    return row?.adopterId ?? null;
}

/**
 * The recipients of the gift forms linked to `adopterId` (the giver), as the
 * forms gave them, unmasked — callers that show them to a viewer go through
 * `maskGiftRecipients`. Throws on a DB failure.
 */
export async function giftRecipientsOf(db: Db, adopterId: string): Promise<FormGiftRecipient[]> {
    const rows = await giftSubmissionsOf(db, adopterId);
    const recipients = rows.map(recipientOf).filter((r): r is NonNullable<typeof r> => r !== null);
    return await Promise.all(recipients.map(async r => ({ ...r, profileId: await giftProfileOf(db, r.submissionId) })));
}

/**
 * The recipients' phones as entries of the GIVER for the token index, so
 * searching that phone finds the giver (as when the recipient sat in the
 * giver's household JSON). Phones only: the recipient's name is not the
 * giver's name. Throws on a DB failure (the tokenizer then keeps the old
 * tokens rather than writing a set without these).
 */
export async function giftRecipientTokenEntries(db: Db, adopterId: string): Promise<TokenEntry[]> {
    const rows = await giftSubmissionsOf(db, adopterId);
    return rows.map(recipientOf)
        .filter((r): r is NonNullable<typeof r> => !!r?.phone)
        .map((r): TokenEntry => ({ type: 'phone', value: r.phone! }));
}
