'use server';

import { formSubmissions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getDb, getUser } from './_db';

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

        const speciesLabel = row.species === 'dog' ? 'Perro' : row.species === 'cat' ? 'Gato' : row.species || '';
        const lifeStageLabel = row.lifeStage === 'puppy' ? 'Cachorro' : row.lifeStage === 'young' ? 'Joven' : row.lifeStage === 'senior' ? 'Senior' : row.lifeStage || '';
        const intentLabel = row.intent === 'self' ? 'Para sí' : row.intent === 'gift' ? 'Regalo' : '';
        const summaryParts = [speciesLabel, lifeStageLabel, intentLabel].filter(Boolean);
        let notes = summaryParts.length > 0
            ? `Formulario PetShield: ${summaryParts.join(' · ')}`
            : 'Datos del formulario de adopción.';

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
 * Only updates if the submission belongs to the current user (rescuer).
 */
export async function linkFormSubmissionToAdopter(submissionId: string, adopterId: string): Promise<{ success: boolean; error?: string }> {
    if (!submissionId?.trim() || !adopterId?.trim()) return { success: false, error: 'Missing submissionId or adopterId' };
    try {
        const db = await getDb();
        const currentUser = await getUser();
        if (!db || !currentUser) return { success: false, error: 'Unauthorized' };

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

        return updated ? { success: true } : { success: false, error: 'Submission not found or not owned' };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
}
