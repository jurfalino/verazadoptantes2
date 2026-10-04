'use server';

import { formSubmissions, adoptions, adopters, notifications, auditLog } from '@/db/schema';
import { eq, and, or, ne, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb, getUser } from './_db';
import { insertRecord } from './_recordWrite';
import { mergeAdopters } from './duplicates';
import { createNotification, resolveDisplayName } from './notifications';
import { isAdmin } from '@/config/admins';
import { planFormLink, canLinkSubmissionDirectly } from '@/domain/formLink';
import { RECORD_TYPES } from '@/domain/constants';
import { logger, generateErrorId } from '@/lib/logger';

// ── Human-readable label helpers ──────────────────────────────────

const SPECIES_LABELS: Record<string, string> = {
    dog: 'Perro', cat: 'Gato', both: 'Ambos', other: 'Otro',
};
const LIFE_STAGE_LABELS: Record<string, string> = {
    puppy: 'Cachorro', young: 'Joven', senior: 'Senior',
};
const INTENT_LABELS: Record<string, string> = {
    self: 'Para sí mismx', gift: 'Regalo para otra persona',
};
const HOUSEHOLD_LABELS: Record<string, string> = {
    children: 'Niños en el hogar', pets: 'Otras mascotas', outdoor: 'Espacio exterior seguro', presence: 'Presencia frecuente en casa',
};

function buildDetailedDescription(formRow: {
    species?: string | null;
    lifeStage?: string | null;
    intent?: string | null;
    specialNeeds?: number | null;
    household?: string | null;
}): string {
    const lines: string[] = [];
    if (formRow.species) lines.push(`Especie: ${SPECIES_LABELS[formRow.species] || formRow.species}`);
    if (formRow.lifeStage) lines.push(`Edad preferida: ${LIFE_STAGE_LABELS[formRow.lifeStage] || formRow.lifeStage}`);
    if (formRow.intent) lines.push(`Destino: ${INTENT_LABELS[formRow.intent] || formRow.intent}`);
    if (formRow.specialNeeds === 1) lines.push('Acepta animales con necesidades especiales');
    if (formRow.specialNeeds === 0) lines.push('No busca animales con necesidades especiales');
    if (formRow.household) {
        try {
            const items = JSON.parse(formRow.household);
            if (Array.isArray(items) && items.length > 0) {
                lines.push(`Hogar: ${items.map((h: string) => HOUSEHOLD_LABELS[h] || h).join(', ')}`);
            }
        } catch (e) {
            // Malformed household JSON degrades the prefilled adopter description.
            // Surface it so we don't silently lose form-submission data quality.
            logger.warn('formSubmission.buildDetailedDescription: household JSON parse failed', {
                householdSnippet: formRow.household.slice(0, 100),
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    return lines.join('\n');
}

function buildNotesSummary(formRow: {
    species?: string | null;
    lifeStage?: string | null;
    intent?: string | null;
    specialNeeds?: number | null;
}): string {
    const parts: string[] = [];
    if (formRow.species) parts.push(`Especie: ${SPECIES_LABELS[formRow.species] || formRow.species}`);
    if (formRow.lifeStage) parts.push(`Edad: ${LIFE_STAGE_LABELS[formRow.lifeStage] || formRow.lifeStage}`);
    if (formRow.intent) parts.push(`Destino: ${INTENT_LABELS[formRow.intent] || formRow.intent}`);
    if (formRow.specialNeeds === 1) parts.push('Acepta necesidades especiales');
    if (parts.length === 0) return '';
    return 'Datos del formulario de adopción:\n' + parts.map(p => `• ${p}`).join('\n');
}

export interface FormSubmissionPrefill {
    name: string;
    contactInfo: string;
    selfieUrl: string | null;
    notes: string;
}

/**
 * Fetch form submission data for pre-filling the "create adopter" form.
 * Only returns data if the submission belongs to the current user (rescuer).
 */
export async function getFormSubmissionPrefill(submissionId: string): Promise<FormSubmissionPrefill | null> {
    if (!submissionId?.trim()) return null;
    try {
        const db = await getDb();
        const currentUser = await getUser();
        if (!db || !currentUser) return null;

        const row = await db
            .select({
                name: formSubmissions.name,
                email: formSubmissions.email,
                phone: formSubmissions.phone,
                address: formSubmissions.address,
                selfieUrl: formSubmissions.selfieUrl,
                species: formSubmissions.species,
                lifeStage: formSubmissions.lifeStage,
                intent: formSubmissions.intent,
                answersJson: formSubmissions.answersJson,
            })
            .from(formSubmissions)
            .where(and(
                eq(formSubmissions.id, submissionId),
                eq(formSubmissions.userId, currentUser),
            ))
            .get();

        if (!row) return null;

        const contactParts = [row.email, row.phone, row.address].filter(Boolean) as string[];
        const contactInfo = contactParts.join('\n');

        // Brief summary for notes (adopter record context)
        const summary = buildNotesSummary(row);
        let notes = summary ? `Solicitud de adopción: ${summary}` : '';

        if (row.answersJson) {
            try {
                const answers = JSON.parse(row.answersJson) as Record<string, unknown>;
                const keys = Object.keys(answers).filter(k => !['selfie', 'name', 'email', 'phone', 'address', 'latitude', 'longitude'].includes(k));
                if (keys.length > 0) {
                    const extra: string[] = [];
                    for (const k of keys.slice(0, 15)) {
                        const v = answers[k];
                        if (v != null && v !== '' && typeof v !== 'object') extra.push(`${k}: ${String(v)}`);
                        else if (typeof v === 'object' && v !== null && !Array.isArray(v)) extra.push(`${k}: ${JSON.stringify(v)}`);
                    }
                    if (extra.length > 0) notes += '\n\n' + extra.join('\n');
                }
            } catch (e) {
                logger.warn('getFormSubmissionPrefill: answersJson parse failed', {
                    submissionId,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        return {
            name: row.name || '',
            contactInfo,
            selfieUrl: row.selfieUrl || null,
            notes: notes.trim(),
        };
    } catch (e) {
        logger.error('getFormSubmissionPrefill failed', e, { submissionId });
        return null;
    }
}

/**
 * Add the form's adoption request to an adopter's history. Idempotent (dedup
 * via sourceUrl `form:<id>`) and best-effort: the link is what the rescuer
 * asked for, so a failure here is logged, never thrown.
 */
async function addFormRequestRecord(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Drizzle D1/better-sqlite3 union getDb() returns
    db: any,
    submissionId: string,
    adopterId: string,
    actorEmail: string,
): Promise<void> {
    try {
        const sourceUrl = `form:${submissionId}`;
        const existing = await db.select({ id: adoptions.id })
            .from(adoptions)
            .where(and(eq(adoptions.adopterId, adopterId), eq(adoptions.sourceUrl, sourceUrl)))
            .get();
        if (existing) return;

        const formRow = await db.select({
            species: formSubmissions.species,
            lifeStage: formSubmissions.lifeStage,
            intent: formSubmissions.intent,
            specialNeeds: formSubmissions.specialNeeds,
            household: formSubmissions.household,
            createdAt: formSubmissions.createdAt,
        }).from(formSubmissions).where(eq(formSubmissions.id, submissionId)).get();
        if (!formRow) return;

        await insertRecord(db, {
            adopterId,
            recordType: RECORD_TYPES.REQUEST,
            species: formRow.species,
            status: 'pending',
            details: buildDetailedDescription(formRow) || 'Solicitud de adopción',
            sourceUrl,
            date: formRow.createdAt,
        }, actorEmail);
    } catch (e) {
        logger.warn('addFormRequestRecord: adoption_request creation failed', {
            submissionId,
            adopterId,
            actorEmail,
            error: e instanceof Error ? e.message : String(e),
        });
    }
}

/**
 * Both pages change on a link. Without this the client Router Cache replays
 * the pre-link form-results page when the rescuer comes Back from the profile.
 */
function revalidateFormLink(submissionId: string, adopterId: string): void {
    revalidatePath(`/form-results/${submissionId}`);
    revalidatePath(`/adopter/${adopterId}`);
}

/**
 * Link a form submission to a profile the rescuer just created from it
 * ("Crear perfil con estos datos" → AdopterForm). Sets linkedAdopterId and
 * status = 'linked', and adds the form's adoption request to the profile.
 * Only updates if the submission belongs to the current user (rescuer).
 *
 * Choosing one of the form's MATCHES goes through linkFormToExistingAdopter,
 * which also folds the auto-created profile in.
 */
export async function linkFormSubmissionToAdopter(submissionId: string, adopterId: string): Promise<{ success: boolean; error?: string; errorId?: string }> {
    if (!submissionId?.trim() || !adopterId?.trim()) return { success: false, error: 'Missing submissionId or adopterId' };
    try {
        const db = await getDb();
        const currentUser = await getUser();
        if (!db || !currentUser) return { success: false, error: 'Unauthorized' };

        // Only a profile she could legitimately choose: a match recorded for
        // this submission, or one she already sees in full (normally the one
        // she just created from the form). Being linked makes the person an
        // «applicant» — which unlocks a contract invitation and its pre-fill.
        const [target, notif] = await Promise.all([
            db.select({ id: adopters.id, addedBy: adopters.addedBy, deletedAt: adopters.deletedAt })
                .from(adopters).where(eq(adopters.id, adopterId)).get(),
            db.select({ metadata: notifications.metadata })
                .from(notifications)
                .where(and(
                    eq(notifications.userId, currentUser),
                    eq(notifications.type, 'form_submission'),
                    sql`json_extract(${notifications.metadata}, '$.submissionId') = ${submissionId}`,
                ))
                .get(),
        ]);
        let recordedMatchIds: string[] = [];
        try {
            const meta = notif?.metadata ? JSON.parse(notif.metadata) : {};
            recordedMatchIds = (meta.matchedAdopters ?? []).map((m: { id: string }) => m.id);
        } catch (e) {
            logger.warn('linkFormSubmissionToAdopter: unreadable notification metadata', {
                submissionId, adopterId, actorEmail: currentUser, error: e instanceof Error ? e.message : String(e),
            });
        }
        const { resolveAdopterVisibility } = await import('@/lib/piiAccessServer');
        const visibility = target
            ? await resolveAdopterVisibility(currentUser, { id: target.id, addedBy: target.addedBy })
            : null;
        const decision = canLinkSubmissionDirectly({
            targetLive: !!target && !target.deletedAt,
            isRecordedMatch: recordedMatchIds.includes(adopterId),
            callerFullySees: !!visibility?.nothingMasked,
        });
        if (!decision.ok) {
            const errorId = generateErrorId();
            logger.warn('linkFormSubmissionToAdopter: refused', {
                submissionId, adopterId, actorEmail: currentUser, reason: decision.reason, errorId,
            });
            return { success: false, error: decision.reason, errorId };
        }

        // Only an UNLINKED form (auto-create failed) takes a profile this way.
        // A form already on a profile keeps it: moving it here would orphan
        // that profile and skip planFormLink's checks — linkFormToExistingAdopter
        // is the path for choosing a different person.
        const updated = await db
            .update(formSubmissions)
            .set({
                linkedAdopterId: adopterId,
                status: 'linked',
            })
            .where(and(
                eq(formSubmissions.id, submissionId),
                eq(formSubmissions.userId, currentUser),
                or(isNull(formSubmissions.linkedAdopterId), eq(formSubmissions.linkedAdopterId, adopterId)),
            ))
            .returning({ id: formSubmissions.id });

        if (!updated.length) {
            logger.warn('linkFormSubmissionToAdopter: refused (not owned, missing, or already on another profile)', {
                submissionId, adopterId, actorEmail: currentUser,
            });
            return { success: false, error: 'Submission not found, not owned, or already linked' };
        }

        await addFormRequestRecord(db, submissionId, adopterId, currentUser);
        revalidateFormLink(submissionId, adopterId);
        return { success: true };
    } catch (e) {
        const errorId = logger.error('linkFormSubmissionToAdopter failed', e, { submissionId, adopterId });
        return { success: false, error: e instanceof Error ? e.message : 'Unknown error', errorId };
    }
}

/** Transient status while linkFormToExistingAdopter holds the form (see the claim). */
const LINKING = 'linking';

/**
 * "Es la misma persona" on /form-results: the applicant is someone the
 * rescuer already has. Folds the profile auto-created from the form into the
 * chosen match (mergeAdopters — its records, photos and contacts move over;
 * the merge is undoable from admin), points the form at the match, adds the
 * adoption request to its history, and tells the match's creator.
 * The form counterpart of attachContractToExistingAdopter.
 *
 * Every refusal is decided by planFormLink (src/domain/formLink.ts): only the
 * submission's owner, only a match recorded for it at submit time (never an
 * arbitrary profile), never moving a form off a profile the rescuer already
 * chose. Idempotent — a retry after a timeout succeeds without re-merging.
 */
export async function linkFormToExistingAdopter(
    submissionId: string,
    adopterId: string,
): Promise<{ success: boolean; adopterName?: string; error?: string; errorId?: string }> {
    let actorEmail = '';
    // Set once the claim below is held, so a throw can release it — otherwise
    // the form would answer every retry with 'busy'.
    let releaseClaim: (() => Promise<unknown>) | null = null;
    try {
        if (!submissionId?.trim() || !adopterId?.trim()) return { success: false, error: 'Missing submissionId or adopterId' };
        const db = await getDb();
        actorEmail = await getUser();
        if (!db || !actorEmail) return { success: false, error: 'Unauthorized' };

        const sub = await db.select({
            userId: formSubmissions.userId,
            linkedAdopterId: formSubmissions.linkedAdopterId,
            autoAdopterId: formSubmissions.autoAdopterId,
        }).from(formSubmissions).where(eq(formSubmissions.id, submissionId)).get();
        // Owner only — same rule the page applies before rendering the cards.
        if (!sub || sub.userId !== actorEmail) return { success: false, error: 'Submission not found or not owned' };

        const [notif, target, auto] = await Promise.all([
            db.select({ metadata: notifications.metadata })
                .from(notifications)
                .where(and(
                    eq(notifications.userId, actorEmail),
                    eq(notifications.type, 'form_submission'),
                    sql`json_extract(${notifications.metadata}, '$.submissionId') = ${submissionId}`,
                ))
                .get(),
            db.select({ id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, deletedAt: adopters.deletedAt })
                .from(adopters).where(eq(adopters.id, adopterId)).get(),
            sub.autoAdopterId
                ? db.select({ deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, sub.autoAdopterId)).get()
                : Promise.resolve(null),
        ]);

        let recordedMatchIds: string[] = [];
        try {
            const meta = notif?.metadata ? JSON.parse(notif.metadata) : {};
            recordedMatchIds = (meta.matchedAdopters ?? []).map((m: { id: string }) => m.id);
        } catch (e) {
            logger.warn('linkFormToExistingAdopter: unreadable notification metadata', {
                submissionId, adopterId, actorEmail, error: e instanceof Error ? e.message : String(e),
            });
        }

        const plan = planFormLink({
            row: { linkedAdopterId: sub.linkedAdopterId, autoAdopterId: sub.autoAdopterId },
            targetId: adopterId,
            recordedMatchIds,
            targetLive: !!target && !target.deletedAt,
            autoLive: !!auto && !auto.deletedAt,
        });
        if (!plan.ok) {
            logger.warn('linkFormToExistingAdopter: refused', { submissionId, adopterId, actorEmail, reason: plan.reason });
            return { success: false, error: plan.reason };
        }

        if (plan.op === 'noop') {
            // Also heals a claim a crashed attempt left behind after its merge landed.
            await db.update(formSubmissions).set({ status: 'linked' })
                .where(and(eq(formSubmissions.id, submissionId), eq(formSubmissions.status, LINKING)));
        } else {
            // Claim the form, atomically against the state we planned from, so
            // two tabs cannot both merge (and split one applicant across two
            // profiles). The claim sits on `status`, not linked_adopter_id: the
            // merge must still find the form there to re-point it and record
            // that in its undo payload.
            const claimed = await db.update(formSubmissions)
                .set({ status: LINKING })
                .where(and(
                    eq(formSubmissions.id, submissionId),
                    or(isNull(formSubmissions.status), ne(formSubmissions.status, LINKING)),
                    sub.linkedAdopterId
                        ? eq(formSubmissions.linkedAdopterId, sub.linkedAdopterId)
                        : isNull(formSubmissions.linkedAdopterId),
                ))
                .returning({ id: formSubmissions.id });
            if (!claimed.length) {
                logger.warn('linkFormToExistingAdopter: lost the claim (concurrent link)', { submissionId, adopterId, actorEmail });
                return { success: false, error: 'busy' };
            }
            releaseClaim = () => db.update(formSubmissions).set({ status: 'linked' })
                .where(and(eq(formSubmissions.id, submissionId), eq(formSubmissions.status, LINKING)));
        }

        if (plan.op === 'merge') {
            // Request first, on the profile being folded in: the merge then
            // carries it to the target and its undo carries it back, so an
            // undone merge never leaves this request on the wrong person.
            await addFormRequestRecord(db, submissionId, plan.orphanId, actorEmail);
            const merged = await mergeAdopters(adopterId, plan.orphanId, actorEmail);
            if (!merged.success) {
                await releaseClaim?.();
                const errorId = logger.error('linkFormToExistingAdopter: merge failed', new Error(merged.error ?? 'merge failed'), {
                    submissionId, adopterId, orphanId: plan.orphanId, actorEmail,
                });
                return { success: false, error: merged.error, errorId };
            }
        }

        if (plan.op !== 'noop') {
            // The merge already re-pointed the form; 'link' has not. Either way
            // the end state is the same row.
            await db.update(formSubmissions)
                .set({ linkedAdopterId: adopterId, status: 'linked' })
                .where(eq(formSubmissions.id, submissionId));

            try {
                await db.insert(auditLog).values({
                    id: crypto.randomUUID(),
                    userId: actorEmail,
                    userEmail: actorEmail,
                    action: 'form_link_to_existing',
                    target: adopterId,
                    details: JSON.stringify({
                        submissionId,
                        op: plan.op,
                        mergedOrphanId: plan.op === 'merge' ? plan.orphanId : null,
                        matchedProfileCreator: target?.addedBy ?? null,
                    }),
                    createdAt: new Date(),
                });
            } catch (e) {
                logger.warn('linkFormToExistingAdopter: audit log insert failed (non-blocking)', {
                    submissionId, adopterId, actorEmail, error: e instanceof Error ? e.message : String(e),
                });
            }

            await notifyProfileCreator(target, adopterId, submissionId, actorEmail);
        }

        // 'link' writes the request here; after a merge it already arrived with
        // the profile, so this is a dedup no-op; on noop it heals a request a
        // timeout cut off.
        await addFormRequestRecord(db, submissionId, adopterId, actorEmail);
        revalidateFormLink(submissionId, adopterId);
        if (plan.op === 'merge') revalidatePath(`/adopter/${plan.orphanId}`);
        logger.info('linkFormToExistingAdopter: linked', { submissionId, adopterId, actorEmail, op: plan.op });
        return { success: true, adopterName: target?.name };
    } catch (e) {
        const errorId = logger.error('linkFormToExistingAdopter failed', e, { submissionId, adopterId, actorEmail });
        if (releaseClaim) {
            await releaseClaim().catch((releaseErr: unknown) => {
                logger.warn('linkFormToExistingAdopter: could not release the claim', {
                    submissionId, adopterId, actorEmail, errorId,
                    error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
                });
            });
        }
        return { success: false, error: e instanceof Error ? e.message : 'Unknown error', errorId };
    }
}

/**
 * Tell whoever created the matched profile that an adoption request was
 * attached to it — the same courtesy contracts get. Skipped for the actor's
 * own profiles and for admins (they reconcile in bulk). Best-effort.
 */
async function notifyProfileCreator(
    target: { name: string; addedBy: string | null } | null | undefined,
    adopterId: string,
    submissionId: string,
    actorEmail: string,
): Promise<void> {
    if (!target?.addedBy || target.addedBy === actorEmail || isAdmin(target.addedBy)) return;
    try {
        const actorName = await resolveDisplayName(actorEmail).catch((e: unknown) => {
            logger.warn('notifyProfileCreator: display name fallback', { adopterId, actorEmail, error: e instanceof Error ? e.message : String(e) });
            return actorEmail.split('@')[0];
        });
        await createNotification({
            userId: target.addedBy,
            type: 'form_attached',
            title: `${actorName} vinculó una solicitud de adopción a tu perfil ${target.name}`,
            body: 'Tocá para revisar.',
            url: `/adopter/${adopterId}`,
            icon: '📋',
            metadata: { attachedBy: actorEmail, submissionId },
        });
    } catch (e) {
        logger.warn('notifyProfileCreator: notification failed (non-blocking)', {
            submissionId, adopterId, actorEmail, error: e instanceof Error ? e.message : String(e),
        });
    }
}
