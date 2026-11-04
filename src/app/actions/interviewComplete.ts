'use server';

/**
 * Saves a finished interview to the profile the rescuer chose (spec §3.5,
 * §5.2, D1/D2/D8). Reuses the existing write paths so tokens, history,
 * audit and pending-search closure behave as everywhere else. The status
 * flips LAST; adopter_id and event_id are persisted as soon as they exist,
 * so a retry after a partial failure resumes instead of duplicating.
 */
import { and, eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import { resolveMergedAdopterId } from '@/lib/mergedAdopterRedirect';
import { safeError } from '@/lib/interviews/safeError';
import { rowsAffected } from '@/lib/interviews/rowsAffected';
import { adopterEvents, adopters, interviews } from '@/db/schema';
import { buildContactEntries } from '@/lib/contactEntries';
import { contactKey, deriveKnownFacts } from '@/domain/interview/facts';
import { QUESTION_BANK } from '@/domain/interview/bank';
import { contextFor, loadInterview } from '@/lib/interviews/store';
import { completeInputSchema, type CompleteInput } from '@/lib/interviews/validation';
import type { ActionResult } from './interviewTypes';

export async function completeInterview(interviewId: string, input: CompleteInput): Promise<ActionResult<{ adopterId: string }>> {
    let actor: string | undefined;
    const id = String(interviewId);
    try {
        if (!(await getFeatureFlag('ENABLE_INTERVIEW_GUIDE'))) return { ok: false, error: 'disabled' };
        actor = await getUser();
        const parsed = completeInputSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: 'invalid' };
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const s = await loadInterview(db, id);
        if (!s || s.status === 'discarded') return { ok: false, error: 'not_found' };
        if (s.conductedBy !== actor) return { ok: false, error: 'forbidden' };
        if (s.status === 'completed' && s.adopterId) return { ok: true, adopterId: s.adopterId };

        const { rating, summary } = parsed.data;
        let target = parsed.data.adopterId;
        if (target !== 'new' && !s.candidateIds.includes(target)) return { ok: false, error: 'forbidden' };
        // A candidate merged into another profile while the interview was open: save onto
        // the profile that absorbed it (it already holds that candidate's data).
        if (target !== 'new' && !s.adopterId) {
            const survivorId = await resolveMergedAdopterId(target).catch((e) => {
                logger.warn('interviews.complete: merge lookup failed', { interviewId: id, adopterId: target, error: e instanceof Error ? e.message : String(e) });
                return null;
            });
            if (survivorId) {
                logger.info('interviews.complete: target was merged, saving to its survivor', { interviewId: id, adopterId: target, survivorId });
                target = survivorId;
            }
        }

        // An existing target must still be a live profile: a merged (soft-deleted) one would
        // receive contacts and an observation nobody sees. Checked before any write.
        let targetOwner: string | null = null;
        if (target !== 'new') {
            const t = await db.select({ addedBy: adopters.addedBy, deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, target)).get();
            if (!t || t.deletedAt) {
                logger.warn('interviews.complete: target profile is deleted or missing', { interviewId: id, adopterId: target });
                return { ok: false, error: 'invalid' };
            }
            targetOwner = t.addedBy ?? null;
        }

        // Only what this interview actually collected may be written (no free-form injection).
        const known = deriveKnownFacts(contextFor(s, []), QUESTION_BANK);
        const knownKeys = new Set([
            ...known.phones.map(v => `phone:${contactKey('phone', v)}`),
            ...known.emails.map(v => `email:${contactKey('email', v)}`),
            ...known.socials.map(v => `social:${contactKey('social', v)}`),
        ]);
        const contacts = parsed.data.additions.contacts.filter(c => knownKeys.has(`${c.type}:${contactKey(c.type, c.value)}`));
        // Each addition keeps its position in the input: the membership's source key, stable across retries.
        const household = parsed.data.additions.household
            .map((h, index) => ({ ...h, index }))
            .filter(h => known.household.some(k => k.name === h.name.trim() && k.relationship === h.relationship));
        const address = parsed.data.additions.address && known.address === parsed.data.additions.address.trim() ? known.address : null;
        const entriesJson = () => JSON.stringify(buildContactEntries({
            phones: contacts.filter(c => c.type === 'phone').map(c => c.value),
            emails: contacts.filter(c => c.type === 'email').map(c => c.value),
            socials: contacts.filter(c => c.type === 'social').map(c => c.value),
        }));

        const { saveAdopter, appendToExistingAdopter } = await import('./adopters');
        const { saveAdoption } = await import('./adoptions');

        // A retry must resolve to the profile this interview already chose.
        if (s.adopterId && target !== 'new' && target !== s.adopterId) return { ok: false, error: 'invalid' };

        // 1. Target profile.
        let adopterId = s.adopterId;
        let created = false;
        if (!adopterId) {
            if (target === 'new') {
                const res = await saveAdopter({ id: crypto.randomUUID(), name: s.prep.name, contactEntries: entriesJson(), addressInfo: address ?? undefined });
                if (!res.success) throw new Error(`saveAdopter refused: ${res.error}`);
                adopterId = res.id;
                created = true;
            } else {
                adopterId = target;
            }
            await db.update(interviews).set({ adopterId, updatedAt: new Date() }).where(eq(interviews.id, id));
        }

        // 2. Additions. A new profile already holds the contacts/address from its create.
        if (created || target !== 'new') {
            const owner = created ? actor : targetOwner;
            const { isAdminAsync } = await import('@/config/admins');
            const { isOrgMate } = await import('@/lib/orgMembership');
            const canEdit = created || owner === actor || (await isAdminAsync(actor)) || (await isOrgMate(actor, owner));
            if (canEdit) {
                if (!created && (contacts.length || address)) {
                    const r = await appendToExistingAdopter(adopterId, { contactEntries: entriesJson(), ...(address ? { addressInfo: address } : {}) });
                    if (!r.success) logger.warn('interviews.complete: append refused', { interviewId: id, adopterId, error: r.error });
                }
                // Households as profiles: each person becomes a profile (owned by the profile's
                // owner) in this profile's household. No duplicate check (nobody to answer it);
                // someone of the same name already in that household is not added again, and a
                // retry finds each membership by its source key.
                if (household.length) {
                    const { attachHouseholdPeople } = await import('@/lib/householdPeople');
                    const res = await attachHouseholdPeople(db, {
                        anchorAdopterId: adopterId,
                        people: household.map(h => ({ name: h.name.trim(), relationship: h.relationship, index: h.index })),
                        actor, ownerEmail: owner ?? actor, sourceKey: `interview:${id}`, requestId: id,
                    });
                    const failed = res.skipped.filter(s => s.reason === 'failed');
                    if (failed.length) logger.warn('interviews.complete: household people not all added', { interviewId: id, adopterId, failed: failed.length });
                }
            }
        }

        // 3. The observation that anchors the interview on the timeline (D8).
        if (!s.eventId) {
            // Deterministic id: a retry after a partial failure finds the row instead of minting a second one.
            const eventId = `${id}-obs`;
            const existing = await db.select({ id: adopterEvents.id }).from(adopterEvents).where(eq(adopterEvents.id, eventId)).get();
            if (!existing) {
                await saveAdoption({
                    id: eventId, recordType: 'observation', adopterId, rating: rating ?? null, details: summary?.trim() || null, date: new Date(),
                });
            }
            await db.update(interviews).set({ eventId, updatedAt: new Date() }).where(eq(interviews.id, id));
        }

        // 4. Done — last.
        const now = new Date();
        const done = await db.update(interviews).set({ status: 'completed', completedAt: now, updatedAt: now })
            .where(and(eq(interviews.id, id), eq(interviews.status, 'draft'))).run();
        if (rowsAffected(done) === 0) {
            // Someone else moved the row on (a concurrent completion, or a discard in another tab).
            const after = await loadInterview(db, id);
            if (after?.status === 'completed' && after.adopterId) return { ok: true, adopterId: after.adopterId };
            logger.warn('interviews.complete: interview left draft before completing', { interviewId: id, adopterId, status: after?.status ?? null });
            return { ok: false, error: 'invalid' };
        }
        logger.info('interviews.complete', {
            interviewId: id, adopterId, actor, created,
            answeredCount: Object.values(s.answers).filter(a => a.status === 'answered').length,
            addedContacts: contacts.length, addedHousehold: household.length,
        });
        return { ok: true, adopterId };
    } catch (e) {
        if (e instanceof Error && e.message === 'Authentication required') return { ok: false, error: 'forbidden' };
        return { ok: false, error: 'generic', errorId: logger.error('interviews.complete failed', safeError(e), { interviewId: id, actor }) };
    }
}
