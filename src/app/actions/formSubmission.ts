'use server';

import { formSubmissions, adoptions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';

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
            } catch {
                // keep notes as is
            }
        }

        return {
            name: row.name || '',
            contactInfo,
            selfieUrl: row.selfieUrl || null,
            notes: notes.trim(),
        };
    } catch {
        return null;
    }
}

/**
 * Link a form submission to an adopter profile (sets linkedAdopterId and status = 'linked').
 * Also creates an adoption_request record from the form's structured data.
 * Idempotent: skips if the adoption request already exists (dedup via sourceUrl).
 * Only updates if the submission belongs to the current user (rescuer).
 */
export async function linkFormSubmissionToAdopter(submissionId: string, adopterId: string): Promise<{ success: boolean; error?: string }> {
    if (!submissionId?.trim() || !adopterId?.trim()) return { success: false, error: 'Missing submissionId or adopterId' };
    try {
        const db = await getDb();
        const currentUser = await getUser();
        if (!db || !currentUser) return { success: false, error: 'Unauthorized' };

        // 1. Link the form submission
        await db
            .update(formSubmissions)
            .set({
                linkedAdopterId: adopterId,
                status: 'linked',
            })
            .where(and(
                eq(formSubmissions.id, submissionId),
                eq(formSubmissions.userId, currentUser),
            ));

        const updated = await db
            .select({ id: formSubmissions.id })
            .from(formSubmissions)
            .where(and(
                eq(formSubmissions.id, submissionId),
                eq(formSubmissions.linkedAdopterId, adopterId),
            ))
            .get();

        if (!updated) return { success: false, error: 'Submission not found or not owned' };

        // 2. Create adoption_request record from form data (idempotent)
        try {
            const sourceUrl = `form:${submissionId}`;

            // Dedup guard — skip if already created
            const existing = await db.select({ id: adoptions.id })
                .from(adoptions)
                .where(and(
                    eq(adoptions.adopterId, adopterId),
                    eq(adoptions.sourceUrl, sourceUrl),
                )).get();

            if (!existing) {
                const formRow = await db.select({
                    species: formSubmissions.species,
                    lifeStage: formSubmissions.lifeStage,
                    intent: formSubmissions.intent,
                    specialNeeds: formSubmissions.specialNeeds,
                    household: formSubmissions.household,
                    createdAt: formSubmissions.createdAt,
                }).from(formSubmissions).where(eq(formSubmissions.id, submissionId)).get();

                if (formRow) {
                    await db.insert(adoptions).values({
                        id: crypto.randomUUID(),
                        adopterId,
                        recordType: 'adoption_request',
                        species: formRow.species,
                        status: 'pending',
                        details: buildDetailedDescription(formRow) || 'Solicitud de adopción',
                        sourceUrl,
                        addedBy: currentUser,
                        date: formRow.createdAt,
                    });
                }
            }
        } catch (adoptionErr) {
            // Non-blocking: the link succeeded, adoption request creation is best-effort
            console.warn('[formSubmission] Failed to create adoption_request record', adoptionErr);
        }

        return { success: true };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
}
