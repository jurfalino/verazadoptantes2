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
import { safeError } from '@/lib/interviews/safeError';
import { rowsAffected } from '@/lib/interviews/rowsAffected';
import { adopterEvents, adopters, interviews } from '@/db/schema';
import { deserializeHouseholdMembers } from '@/lib/householdMembers';
import { normalizeText } from '@/lib/tokenizer';
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

        const { adopterId: target, rating, summary } = parsed.data;
        if (target !== 'new' && !s.candidateIds.includes(target)) return { ok: false, error: 'forbidden' };

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
        const household = parsed.data.additions.household.filter(h =>
            known.household.some(k => k.name === h.name.trim() && k.relationship === h.relationship));
        const address = parsed.data.additions.address && known.address === parsed.data.additions.address.trim() ? known.address : null;
        const entriesJson = () => JSON.stringify(buildContactEntries({
            phones: contacts.filter(c => c.type === 'phone').map(c => c.value),
            emails: contacts.filter(c => c.type === 'email').map(c => c.value),
            socials: contacts.filter(c => c.type === 'social').map(c => c.value),
        }));

        const { saveAdopter, appendToExistingAdopter } = await import('./adopters');
        const { addHouseholdMember } = await import('./householdMembers');
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
                // addHouseholdMember always appends, so a retry must skip people already there.
                const rawRow = created ? null : await db.select({ hm: adopters.householdMembers }).from(adopters).where(eq(adopters.id, adopterId)).get();
                const present = deserializeHouseholdMembers(rawRow?.hm ?? null);
                const have = (h: { name: string; relationship: string | null }) =>
                    present.some(m => normalizeText(m.name.trim()) === normalizeText(h.name.trim()) && m.relationship === h.relationship);
                for (const h of household.filter(h => !have(h))) {
                    const r = await addHouseholdMember({ adopterId, name: h.name, relationship: h.relationship });
                    if (!r.ok) logger.warn('interviews.complete: household add refused', { interviewId: id, adopterId, error: r.error });
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
