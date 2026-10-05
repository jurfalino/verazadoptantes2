/**
 * The adoption request a form leaves on a profile's history ("Ver formulario
 * completado"), and its human-readable description. NOT 'use server': the
 * form submit route records it at submit time (spec 2026-10-04 §3), and an
 * export of a 'use server' module would be a browser-callable action.
 */
import { formSubmissions, adoptions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { insertRecord } from '@/app/actions/_recordWrite';
import { RECORD_TYPES } from '@/domain/constants';
import { logger } from '@/lib/logger';

// ── Human-readable label helpers ──────────────────────────────────

export const SPECIES_LABELS: Record<string, string> = {
    dog: 'Perro', cat: 'Gato', both: 'Ambos', other: 'Otro',
};
export const LIFE_STAGE_LABELS: Record<string, string> = {
    puppy: 'Cachorro', young: 'Joven', senior: 'Senior',
};
export const INTENT_LABELS: Record<string, string> = {
    self: 'Para sí mismx', gift: 'Regalo para otra persona',
};
const HOUSEHOLD_LABELS: Record<string, string> = {
    children: 'Niños en el hogar', pets: 'Otras mascotas', outdoor: 'Espacio exterior seguro', presence: 'Presencia frecuente en casa',
};

export function buildDetailedDescription(formRow: {
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

/**
 * Add the form's adoption request to an adopter's history. Idempotent (dedup
 * via sourceUrl `form:<id>`) and best-effort: the link is what the rescuer
 * asked for, so a failure here is logged, never thrown.
 */
export async function addFormRequestRecord(
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

