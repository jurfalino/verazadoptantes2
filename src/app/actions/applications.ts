'use server';

/**
 * The evaluation actions (spec docs/superpowers/specs/2026-11-10-applicant-evaluation-design.md):
 * «No avanzar», «Proponer un animal», the possible duplicate inside the
 * evaluation, and the offer to tell the other candidates after an adoption.
 *
 * Every export here is a browser-callable endpoint taking arguments a
 * stranger chooses. Each one reads the viewer from the session (signed out →
 * `unauthorized`), checks the shape of its arguments (`invalid`), and goes
 * through the access rule in `_applications.ts` — anyone outside it gets
 * `not_found`, never a hint the application or animal exists, and nothing is
 * written. The DB work lives in `_applications.ts` (not a server-action
 * module); these are thin orchestrators.
 */

import { logger } from '@/lib/logger';
import { getDb, getUser } from './_db';
import { APPLICATION_STATES, RECORD_TYPES } from '@/domain/constants';
import { formLinkKind, formResultsView } from '@/domain/formLink';
import type { FormMatchCardData } from '@/lib/formMatchCards';
import type { ProposalAnimal, OfferCandidate } from './_applications';
import type { ShareAnimal } from '@/domain/shareFormAnimals';
import type { ApplicantsLoad } from '@/lib/applicantsLoad';

/**
 * `observation_saved_already_decided` («No avanzar» only): the observation WAS saved, but the application
 * already had another outcome by the time it was to close (review M1) — never «No se guardó tu observación».
 */
export type ApplicationActionError = 'unauthorized' | 'not_found' | 'not_allowed' | 'invalid' | 'already_decided' | 'observation_saved_already_decided' | 'already_candidate' | 'animal_adopted' | 'same_person_unanswered' | 'already_acted' | 'failed';
export type Fail = { ok: false; error: ApplicationActionError; errorId?: string };

const fail = (error: Exclude<ApplicationActionError, 'failed'>): Fail => ({ ok: false, error });

/** The session's email, or null when signed out. `getUser` throws only for «no session» (it logs its own auth failures). */
async function sessionViewer(): Promise<string | null> {
    try {
        return await getUser();
    } catch {
        return null; // signed out → `unauthorized`, not an error
    }
}

async function requireDb() {
    const db = await getDb();
    if (!db) throw new Error('Database unavailable');
    return db;
}

/**
 * The viewer's team's general applications (formularios generales), in panel order; empty signed out; a failure
 * carries its errorId. `scope`: one request by id (a link opening it alone), or only the open ones (the
 * «Formularios generales» group) — never the whole history when a page needs less (review I4).
 */
export async function getGeneralApplications(scope?: { applicationId?: string; openOnly?: boolean }): Promise<ApplicantsLoad> {
    let viewer: string | null = null;
    const applicationId = scope && typeof scope === 'object' && typeof scope.applicationId === 'string' ? scope.applicationId : undefined;
    const openOnly = !!(scope && typeof scope === 'object' && scope.openOnly === true);
    try {
        viewer = await sessionViewer();
        if (!viewer) return { ok: true, applicants: [] };
        const { isId } = await import('./_applications');
        if (applicationId !== undefined && !isId(applicationId)) return { ok: true, applicants: [] };
        const db = await requireDb();
        const [{ getTeamEmails }, { loadGeneralApplications }] = await Promise.all([import('@/lib/orgMembership'), import('./_applicants')]);
        return { ok: true, applicants: await loadGeneralApplications(db, await getTeamEmails(viewer), viewer, { applicationId, openOnly }) };
    } catch (e) {
        const errorId = logger.error('getGeneralApplications failed', e, { viewer, applicationId: applicationId ?? null, openOnly });
        return { ok: false, errorId };
    }
}

/**
 * The «¿Es la misma persona?» cards inside the evaluation: the open pairs of
 * the profile this form sits on, as /form-results shows them (same cards, same
 * masking) — the profile auto-created from it, or the existing one it was
 * linked to. Both kinds defer their plain pairs while the application is to
 * evaluate (Q6, toEvaluateAdopterIds), so both show them here. Only an
 * auto-created profile answers «Sí» by linking the form (formResultsView
 * canLinkMatches); on an existing profile the cards are the compare, read-only.
 * A form with no profile has none.
 */
export async function getApplicationDuplicates(applicationId: string): Promise<{
    ok: true;
    applicant: { name: string; email?: string; phone?: string; address?: string };
    cards: FormMatchCardData[];
    canLink: boolean;
    willMerge: boolean;
} | Fail> {
    let viewer: string | null = null;
    try {
        viewer = await sessionViewer();
        if (!viewer) return fail('unauthorized');
        const { isId, loadAuthorizedApplication } = await import('./_applications');
        if (!isId(applicationId)) return fail('invalid');
        const db = await requireDb();
        const auth = await loadAuthorizedApplication(db, applicationId, viewer);
        if (!auth) return fail('not_found');
        const { submission } = auth;

        const kind = formLinkKind({ linkedAdopterId: submission.linkedAdopterId, autoAdopterId: submission.autoAdopterId });
        let matches: FormMatchCardData['match'][] = [];
        if (kind !== 'unlinked' && submission.linkedAdopterId) {
            const { loadOpenPairs } = await import('@/lib/openPairs');
            const pairs = await loadOpenPairs(db, submission.linkedAdopterId, viewer, { limit: 20 });
            // A teammate's «No sé» is shown under their name, never as «Respondiste» (UX review).
            const others = [...new Set(pairs.map(p => p.unsureBy).filter((e): e is string => !!e && e.trim().toLowerCase() !== (viewer ?? '').trim().toLowerCase()))];
            const sameBys = [...new Set(pairs.map(p => p.unsureSameBy).filter((e): e is string => !!e))];
            const names = others.length || sameBys.length ? await (await import('./notifications')).resolveDisplayNames([...others, ...sameBys]) : new Map<string, string>();
            matches = pairs.map(p => {
                const by = p.unsureBy ?? null;
                const byName = by && others.includes(by) ? names.get(by.trim().toLowerCase()) ?? null : null;
                const sameByName = p.unsureSameBy ? names.get(p.unsureSameBy.trim().toLowerCase()) ?? null : null;
                return { id: p.otherAdopterId, name: p.otherAdopterName, matchTypes: p.matchTypes, score: p.score, candidateId: p.id, canAnswer: p.onViewerList, unsureBy: by, ...(byName ? { unsureByName: byName } : {}), ...(sameByName ? { unsureSameByName: sameByName } : {}), ...(p.otherSide ? { otherSide: p.otherSide } : {}) };
            });
        }
        const { loadFormMatchCards } = await import('@/lib/formMatchCards');
        const cards = await loadFormMatchCards(db, viewer, matches, { submissionId: submission.id, typed: [submission.phone, submission.email] });
        return {
            ok: true,
            applicant: {
                name: submission.name,
                ...(submission.email ? { email: submission.email } : {}),
                ...(submission.phone ? { phone: submission.phone } : {}),
                ...(submission.address ? { address: submission.address } : {}),
            },
            cards,
            canLink: formResultsView(kind, cards.length).canLinkMatches,
            willMerge: kind === 'new_profile',
        };
    } catch (e) {
        const errorId = logger.error('getApplicationDuplicates failed', e, { applicationId, viewer });
        return { ok: false, error: 'failed', errorId };
    }
}

/**
 * «No avanzar»: a regular observation on the applicant's profile (rating
 * 1–5 and a reason, both required), then the application ends as «No avanzó»
 * pointing at it; a live contract link of this animal + person is voided.
 * The observation id is pre-seeded from the application id, so a retry (a
 * double tap, a network retry) is the same record, never a second one.
 *
 * Never over another rescuer's words (final review M8): an application no
 * longer open is refused before any write, and so is one whose observation
 * another rescuer already wrote (their decline in flight, or its close timed
 * out) — that one is finished with THEIR observation, and this call answers
 * `already_decided` (the dialog says this text was not saved). The observation
 * is written insert-if-absent, so two decliners at the same instant can't
 * overwrite each other either (review M2). If the observation landed but the
 * application then closed another way, the answer is
 * `observation_saved_already_decided` (review M1).
 */
export async function declineApplication(applicationId: string, input: { text: string; rating: number; reason: string }): Promise<{ ok: true; recordId: string } | Fail> {
    let viewer: string | null = null;
    try {
        viewer = await sessionViewer();
        if (!viewer) return fail('unauthorized');
        const { isId, parseDecline, loadAuthorizedApplication, liveAdopterExists, declineRecordId, retireLiveLink, markDeclined, declineRecordAuthor, isDeclinedWith, isTeamDeclineRecord } = await import('./_applications');
        if (!isId(applicationId)) return fail('invalid');
        const decline = parseDecline(input);
        if (!decline) return fail('invalid');
        const db = await requireDb();
        const auth = await loadAuthorizedApplication(db, applicationId, viewer);
        if (!auth) return fail('not_found');
        const { app, submission, animal } = auth;
        let recordId = declineRecordId(applicationId);
        const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();
        if (app.state !== APPLICATION_STATES.OPEN) {
            // This viewer's own decline already landed (a retry after a timeout the client saw): it worked —
            // never «No se guardó tu observación». Anyone else's outcome: already decided.
            if (await isDeclinedWith(db, applicationId, recordId) && norm(await declineRecordAuthor(db, recordId)) === norm(viewer)) {
                return { ok: true, recordId };
            }
            return fail('already_decided');
        }
        const adopterId = submission.linkedAdopterId;
        if (!adopterId || !(await liveAdopterExists(db, adopterId))) return fail('not_allowed');

        // 0. Another rescuer's observation already sits on the pre-seeded id: theirs is the decision. Nothing of
        //    this call is written; their decline is finished (CAS) so the application never stays open behind it.
        const finishTheirs = async (author: string | null) => {
            const finishedBy = author || viewer!;
            const nowSec = Math.floor(Date.now() / 1000);
            if (app.animalId) await retireLiveLink(db, app.animalId, [adopterId, submission.autoAdopterId], nowSec);
            if (await markDeclined(db, applicationId, recordId, finishedBy, nowSec)) {
                const { clearFormNotices } = await import('@/lib/formNotices');
                await clearFormNotices(db, submission.id, { op: 'declineApplication', applicationId, viewer, finishedFor: finishedBy });
            }
            logger.info("declineApplication: another rescuer's observation decides it — this one not saved", { applicationId, viewer, author });
            return fail('already_decided');
        };
        let author = await declineRecordAuthor(db, recordId);
        if (author !== undefined && !(await isTeamDeclineRecord(db, recordId, applicationId, adopterId))) {
            // Squatted (review S2): someone saved another record under this guessable id. It never decides;
            // the team's decline goes under a fresh id and the squat is left for an admin to see.
            logger.error('declineApplication: the decline id holds a record that is not this team\'s observation — writing under a fresh id',
                new Error('squatted decline id'), { applicationId, viewer, recordId, squatAuthor: author });
            recordId = `${recordId}-${crypto.randomUUID().slice(0, 8)}`;
            author = undefined;
        }
        if (author !== undefined && norm(author) !== norm(viewer)) return finishTheirs(author);

        // 1. The observation, through the one record save (visibility, history, notices as any observation).
        const { saveRecordFor } = await import('@/lib/recordSave');
        // `animalId` is a pass-through field of the record save (the event's animal), not a column of the `adoptions` view.
        const record: Parameters<typeof saveRecordFor>[0] & { animalId?: string } = {
            id: recordId,
            recordType: RECORD_TYPES.OBSERVATION,
            adopterId,
            rating: decline.rating,
            details: `${decline.text}\n${decline.reason}`,
            animalId: app.animalId ?? undefined,
            animalName: animal?.name ?? null,
        };
        // Insert-if-absent (review M2): never the edit branch over a record another call just wrote. When this
        // viewer's own observation already sits there (a retry after write 1 landed and write 3 did not), the
        // retry edits it: a 1★ picked by mistake and corrected on retry must not silently stay (re-review m1).
        const ownRetry = author !== undefined;
        const saved = await saveRecordFor(record, undefined, { notifyOwnerTeam: true, insertOnly: !ownRetry });
        if (saved.existed) {
            // Written between step 0 and this insert: by another rescuer → theirs decides; by this viewer
            // (a concurrent double tap) → the same record, carry on and close with it.
            const raced = await declineRecordAuthor(db, recordId);
            if (norm(raced) !== norm(viewer)) return finishTheirs(raced ?? null);
        }

        const nowSec = Math.floor(Date.now() / 1000);
        // 2. Their live contract link for this animal, if any, stops working.
        if (app.animalId) await retireLiveLink(db, app.animalId, [adopterId, submission.autoAdopterId], nowSec);
        // 3. The application ends, only if it is still open (a concurrent decision wins) — unless the call that
        //    won closed it with THIS observation (a teammate finishing it, step 0): then this one did land.
        if (!(await markDeclined(db, applicationId, saved.id, viewer, nowSec)) && !(await isDeclinedWith(db, applicationId, saved.id))) {
            // The observation is on the profile (and its notice sent): say so, never «No se guardó» (review M1).
            logger.info('declineApplication: observation saved, but the application already had another outcome', { applicationId, viewer, recordId: saved.id });
            return fail('observation_saved_already_decided');
        }
        // 4. Answered once: its bell notices read, for everyone (best-effort, logged).
        const { clearFormNotices } = await import('@/lib/formNotices');
        await clearFormNotices(db, submission.id, { op: 'declineApplication', applicationId, viewer });

        logger.info('declineApplication: declined', { applicationId, viewer, recordId: saved.id, animalId: app.animalId });
        return { ok: true, recordId: saved.id };
    } catch (e) {
        const errorId = logger.error('declineApplication failed', e, { applicationId, viewer });
        return { ok: false, error: 'failed', errorId };
    }
}

/** The picker of «Proponer un animal» for a general, open application. */
export async function getProposalAnimals(applicationId: string): Promise<{ ok: true; animals: ProposalAnimal[]; anyAnimals: boolean } | Fail> {
    let viewer: string | null = null;
    try {
        viewer = await sessionViewer();
        if (!viewer) return fail('unauthorized');
        const { isId, loadAuthorizedApplication, loadProposalAnimals } = await import('./_applications');
        if (!isId(applicationId)) return fail('invalid');
        const db = await requireDb();
        const auth = await loadAuthorizedApplication(db, applicationId, viewer);
        if (!auth) return fail('not_found');
        if (auth.app.animalId) return fail('not_allowed');
        // Open: «Sumar a un animal». Proposed: «Cambiar animal» lists the others (its current animal is left out as
        // one this person already has an open application for).
        if (auth.app.state !== APPLICATION_STATES.OPEN && auth.app.state !== APPLICATION_STATES.PROPOSED) return fail('already_decided');
        return { ok: true, ...(await loadProposalAnimals(db, viewer, auth)) };
    } catch (e) {
        const errorId = logger.error('getProposalAnimals failed', e, { applicationId, viewer });
        return { ok: false, error: 'failed', errorId };
    }
}

/**
 * «Compartir formulario» → «¿Para qué animal?»: the viewer's team's animals
 * that take applications, newest first. Session required; the team scope is
 * the viewer's own (myAnimalsScope), so a caller can never list another team.
 */
export async function getShareFormAnimals(): Promise<{ ok: true; animals: ShareAnimal[] } | Fail> {
    let viewer: string | null = null;
    try {
        viewer = await sessionViewer();
        if (!viewer) return fail('unauthorized');
        const { loadShareFormAnimals } = await import('./_applications');
        const db = await requireDb();
        return { ok: true, animals: await loadShareFormAnimals(db, viewer) };
    } catch (e) {
        const errorId = logger.error('getShareFormAnimals failed', e, { viewer });
        return { ok: false, error: 'failed', errorId };
    }
}

/** «Proponer un animal»: the person becomes a candidate of `animalId`; the general application ends as «Propuesta para …». */
export async function proposeAnimal(applicationId: string, animalId: string): Promise<{ ok: true; applicationId: string } | Fail> {
    let viewer: string | null = null;
    try {
        viewer = await sessionViewer();
        if (!viewer) return fail('unauthorized');
        const { isId, loadAuthorizedApplication, proposeAuthorized } = await import('./_applications');
        if (!isId(applicationId) || !isId(animalId)) return fail('invalid');
        const db = await requireDb();
        const auth = await loadAuthorizedApplication(db, applicationId, viewer);
        if (!auth) return fail('not_found');
        // «¿Es la misma persona?» first (Jon 2026-11-12), the same lock as «Enviar contrato».
        const { unansweredForSubmission } = await import('@/lib/samePersonGate');
        const waiting = await unansweredForSubmission(db, auth.submission, viewer);
        if (waiting > 0) {
            logger.info('proposeAnimal: refused — «¿Es la misma persona?» unanswered', { applicationId, animalId, viewer, waiting });
            return fail('same_person_unanswered');
        }
        const res = await proposeAuthorized(db, viewer, auth, animalId);
        if (!res.ok) return fail(res.error);
        // The general application is answered: its form's bell notices read, for everyone (best-effort, logged).
        const { clearFormNotices } = await import('@/lib/formNotices');
        await clearFormNotices(db, auth.submission.id, { op: 'proposeAnimal', applicationId, animalId, viewer });
        logger.info('proposeAnimal: proposed', { applicationId, animalId, viewer, proposedApplicationId: res.applicationId });
        return res;
    } catch (e) {
        const errorId = logger.error('proposeAnimal failed', e, { applicationId, animalId, viewer });
        return { ok: false, error: 'failed', errorId };
    }
}

/**
 * «Quitar de …» (Jon 2026-11-13): the general form `generalApplicationId`, added to an animal, goes back to
 * «por evaluar» — only while nothing happened on the animal's side (else `already_acted`). Team-internal: the
 * person is not told and no observation is written.
 */
export async function withdrawProposal(generalApplicationId: string): Promise<{ ok: true } | Fail> {
    let viewer: string | null = null;
    try {
        viewer = await sessionViewer();
        if (!viewer) return fail('unauthorized');
        const { isId, loadAuthorizedApplication, withdrawProposalAuthorized } = await import('./_applications');
        if (!isId(generalApplicationId)) return fail('invalid');
        const db = await requireDb();
        const auth = await loadAuthorizedApplication(db, generalApplicationId, viewer);
        if (!auth) return fail('not_found');
        const res = await withdrawProposalAuthorized(db, viewer, auth);
        if (!res.ok) {
            logger.info('withdrawProposal: refused', { applicationId: generalApplicationId, viewer, error: res.error });
            return fail(res.error);
        }
        logger.info('withdrawProposal: done', { applicationId: generalApplicationId, candidacyId: res.candidacyId, animalId: res.animalId, viewer });
        return { ok: true };
    } catch (e) {
        const errorId = logger.error('withdrawProposal failed', e, { applicationId: generalApplicationId, viewer });
        return { ok: false, error: 'failed', errorId };
    }
}

/**
 * «Cambiar animal»: the same withdraw, then «Sumar a un animal» with `animalId`. When the new animal can't take
 * it, the first animal is added back, so the person is never left with neither.
 */
export async function changeProposedAnimal(generalApplicationId: string, animalId: string): Promise<{ ok: true; applicationId: string } | Fail> {
    let viewer: string | null = null;
    try {
        viewer = await sessionViewer();
        if (!viewer) return fail('unauthorized');
        const { isId, loadAuthorizedApplication, withdrawProposalAuthorized, proposeAuthorized } = await import('./_applications');
        if (!isId(generalApplicationId) || !isId(animalId)) return fail('invalid');
        const db = await requireDb();
        const auth = await loadAuthorizedApplication(db, generalApplicationId, viewer);
        if (!auth) return fail('not_found');
        const { unansweredForSubmission } = await import('@/lib/samePersonGate');
        if ((await unansweredForSubmission(db, auth.submission, viewer)) > 0) return fail('same_person_unanswered');

        const out = await withdrawProposalAuthorized(db, viewer, auth);
        if (!out.ok) return fail(out.error);
        const reopened = await loadAuthorizedApplication(db, generalApplicationId, viewer);
        if (!reopened) return fail('not_found');
        const res = await proposeAuthorized(db, viewer, reopened, animalId);
        if (res.ok) {
            logger.info('changeProposedAnimal: moved', { applicationId: generalApplicationId, from: out.animalId, to: animalId, viewer });
            return res;
        }
        // Put the first animal back (best effort): never leave the person with neither.
        const again = await loadAuthorizedApplication(db, generalApplicationId, viewer);
        const back = again ? await proposeAuthorized(db, viewer, again, out.animalId) : { ok: false as const, error: 'not_found' as const };
        if (!back.ok) {
            logger.error('changeProposedAnimal: the new animal refused and the first could not be restored', new Error(back.error),
                { applicationId: generalApplicationId, from: out.animalId, to: animalId, viewer, refused: res.error });
        } else {
            logger.info('changeProposedAnimal: refused, first animal restored', { applicationId: generalApplicationId, from: out.animalId, to: animalId, viewer, refused: res.error });
        }
        return fail(res.error);
    } catch (e) {
        const errorId = logger.error('changeProposedAnimal failed', e, { applicationId: generalApplicationId, animalId, viewer });
        return { ok: false, error: 'failed', errorId };
    }
}

/** The offer sheet after an adoption: the candidates it closed that were not told yet, with the contacts they left. */
export async function getAdoptionOffer(animalId: string): Promise<{ ok: true; animalName: string | null; animalSex: string | null; candidates: OfferCandidate[] } | Fail> {
    let viewer: string | null = null;
    try {
        viewer = await sessionViewer();
        if (!viewer) return fail('unauthorized');
        const { isId, loadAuthorizedAnimal, loadOfferCandidates } = await import('./_applications');
        if (!isId(animalId)) return fail('invalid');
        const db = await requireDb();
        const gate = await loadAuthorizedAnimal(db, animalId, viewer);
        if (!gate) return fail('not_found');
        const candidates = await loadOfferCandidates(db, animalId, gate.team);
        return { ok: true, animalName: gate.animal.name, animalSex: gate.animal.sex, candidates };
    } catch (e) {
        const errorId = logger.error('getAdoptionOffer failed', e, { animalId, viewer });
        return { ok: false, error: 'failed', errorId };
    }
}

/** «Listo» / «Ahora no»: the offer is done; the row leaves the home and Mis animales. */
export async function markOfferDone(animalId: string): Promise<{ ok: true; count: number } | Fail> {
    let viewer: string | null = null;
    try {
        viewer = await sessionViewer();
        if (!viewer) return fail('unauthorized');
        const { isId, loadAuthorizedAnimal, markOfferRowsDone } = await import('./_applications');
        if (!isId(animalId)) return fail('invalid');
        const db = await requireDb();
        const gate = await loadAuthorizedAnimal(db, animalId, viewer);
        if (!gate) return fail('not_found');
        const count = await markOfferRowsDone(db, animalId, gate.team, Math.floor(Date.now() / 1000));
        logger.info('markOfferDone: offer done', { animalId, viewer, count });
        return { ok: true, count };
    } catch (e) {
        const errorId = logger.error('markOfferDone failed', e, { animalId, viewer });
        return { ok: false, error: 'failed', errorId };
    }
}
