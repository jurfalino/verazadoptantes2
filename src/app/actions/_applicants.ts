/**
 * Applicant reads + the team access rule behind them. NOT a `'use server'`
 * module: every export of one is a public endpoint, and these helpers take
 * the scope as an argument and trust the caller to have authorized it.
 * Callers: `getApplicantsForAnimal` (applicants.ts — the gated action),
 * `/api/my-animals` (the card count), `/form-results/[id]` and the
 * form-submission prefill/link actions.
 *
 * The scope rule itself (owner's team, fail closed, case-insensitive) lives in
 * `src/lib/applicantScope.ts` so the page and the card share it verbatim.
 */

import { selfieUrlColumn } from '@/lib/selfieLink';
import { photoLinks } from '@/domain/formPhotos';
import { logger } from '@/lib/logger';
import { computeAvgRating } from '@/domain/ratings';
import { buildFlags } from '@/domain/flags';
import { NO_PERIOD_ALERTS, periodAlerts } from '@/domain/periodAlerts';
import { NO_HOUSEMATE_ALERT } from '@/domain/households';
import { APPLICATION_ORIGINS, APPLICATION_STATES, RECORD_TYPES, type ApplicationState, type ApplicationCloseReason } from '@/domain/constants';
import { applicationStatus, panelOrder, proposalUndoable, type InvitationLike } from '@/domain/applications';
import { healMissingApplications } from '@/lib/applicationWrites';
import { applicantScopeWhere, generalScopeWhere, isInTeamScope, normalizeTeamScope, teammateVisibleAnimal } from '@/lib/applicantScope';
import type { AdopterFlags } from '@/types/adopter';
import type { ApplicantSummary, ApplicantAdopterContext } from './applicants';
import type { FormSubmissionRef, FormSubmissionAccessDeps } from '@/lib/formSubmissionAccess';

/* eslint-disable @typescript-eslint/no-explicit-any -- the D1/better-sqlite db union is untyped here, as in the callers */
type Db = any;

/**
 * Owner, org-mate of the owner, or admin. The animal gate in
 * `getAnimalProfile` admits admins too (they can already delete the animal
 * and edit its events), so applicants and form results follow it — otherwise
 * an admin on an animal page they may modify sees the applicants block
 * silently missing. Admin is checked only after the cheaper team check fails.
 */
export async function isOwnerOrgMateOrAdmin(
    viewerEmail: string | null | undefined,
    ownerEmail: string | null | undefined,
): Promise<boolean> {
    const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
    if (await isOwnerOrOrgMate(viewerEmail, ownerEmail)) return true;
    const { isAdminAsync } = await import('@/config/admins');
    return isAdminAsync(viewerEmail);
}

/**
 * May `viewerEmail` open / act on a form submission? The ONE rule shared by
 * /form-results, the «Crear adoptante» prefill and «Vincular» — see
 * src/lib/formSubmissionAccess.ts (form-link owner's team, admin, or the
 * animal owner's team with the form link inside it). Pass the submission
 * row when the caller already has it, else its id. False when it does not
 * exist.
 */
export async function canAccessFormSubmission(
    db: Db,
    submission: string | FormSubmissionRef,
    viewerEmail: string | null | undefined,
): Promise<boolean> {
    if (!viewerEmail) return false;
    const { formSubmissions } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    let ref: FormSubmissionRef | undefined;
    if (typeof submission === 'string') {
        if (!submission) return false;
        ref = await db.select({ userId: formSubmissions.userId, selectedAnimalId: formSubmissions.selectedAnimalId })
            .from(formSubmissions)
            .where(eq(formSubmissions.id, submission))
            .get() as FormSubmissionRef | undefined;
    } else {
        ref = submission;
    }
    if (!ref) return false;

    // STRICT variants: a D1 failure throws instead of reading as "not a
    // teammate / not an admin", so callers show an error with its errorId
    // (and log it) rather than a 404 to someone who is allowed in.
    const { isOrgMateStrict } = await import('@/lib/orgMembership');
    const { canViewerAccessFormSubmission } = await import('@/lib/formSubmissionAccess');
    const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();
    return canViewerAccessFormSubmission(viewerEmail, ref, {
        isOwnerOrOrgMate: async (viewer, owner) => {
            const v = norm(viewer), o = norm(owner);
            if (!v || !o) return false;
            return v === o || isOrgMateStrict(v, o);
        },
        ...(await formSubmissionAccessLookups(db)),
    });
}

/**
 * The DB lookups behind the form-access rule other than the team check —
 * STRICT (a D1 failure throws). Shared by canAccessFormSubmission and
 * /my-adopters (openableSubmissionIds), so the form line is a link exactly
 * when /form-results would open it.
 */
export async function formSubmissionAccessLookups(db: Db): Promise<Omit<FormSubmissionAccessDeps, 'isOwnerOrOrgMate'>> {
    const { animals } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const { getTeamEmails } = await import('@/lib/orgMembership');
    const { isAdminAsyncStrict } = await import('@/config/admins');
    return {
        isAdmin: isAdminAsyncStrict,
        getTeamEmails,
        // Same table and deleted-check as the animal page (getAnimalProfile).
        getAnimalOwner: async (animalId) => {
            const animal = await db.select({ addedBy: animals.addedBy, deletedAt: animals.deletedAt })
                .from(animals)
                .where(eq(animals.id, animalId))
                .get() as { addedBy: string | null; deletedAt: unknown } | undefined;
            return animal && !animal.deletedAt ? animal.addedBy : null;
        },
    };
}

/**
 * Application + submission ids only — what the /my-animals card needs for its
 * count. One query per animal, same WHERE as the full list; «replaced» rows
 * (superseded by a merge) never count. Fails closed to [] (no query) when the
 * team scope is empty.
 */
export async function listApplicantIdsForAnimal(
    db: Db,
    animalId: string,
    teamEmails: readonly string[],
): Promise<Array<{ submissionId: string; applicationId: string }>> {
    const where = applicantScopeWhere(animalId, teamEmails);
    if (!where) return [];
    const { applications, formSubmissions } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select({ applicationId: applications.id, submissionId: applications.submissionId })
        .from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        .where(where)
        .all() as Array<{ applicationId: string; submissionId: string }>;
    return rows.map(r => ({ submissionId: r.submissionId, applicationId: r.applicationId }));
}

type ApplicationRow = {
    applicationId: string; origin: string; askedAnimalId: string | null; animalId: string | null;
    proposedApplicationId: string | null; replacedByApplicationId: string | null;
    state: string; closeReason: string | null; closedAt: number | null; closedBy: string | null;
    id: string; name: string;
    email: string | null; phone: string | null; address: string | null;
    selfieUrl: string | null; photoKeys: string | null; latitude: string | null; longitude: string | null;
    intent: string | null; species: string | null; lifeStage: string | null;
    household: string | null; answersJson: string | null;
    linkedAdopterId: string | null; autoAdopterId: string | null; createdAt: Date | null;
};

/** The application columns every list reads, joined to its form (the scope already drops «replaced» rows). */
async function selectApplicationRows(db: Db, where: unknown): Promise<ApplicationRow[]> {
    const { applications, formSubmissions } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    return await db.select({
        applicationId: applications.id,
        origin: applications.origin,
        askedAnimalId: applications.askedAnimalId,
        animalId: applications.animalId,
        proposedApplicationId: applications.proposedApplicationId,
        replacedByApplicationId: applications.replacedByApplicationId,
        state: applications.state,
        closeReason: applications.closeReason,
        closedAt: applications.closedAt,
        closedBy: applications.closedBy,
        id: formSubmissions.id,
        name: formSubmissions.name,
        email: formSubmissions.email,
        phone: formSubmissions.phone,
        address: formSubmissions.address,
        selfieUrl: selfieUrlColumn, // private selfies → their checked route (src/lib/selfieLink.ts)
        photoKeys: formSubmissions.photoKeys, // → checked links below; never returned
        latitude: formSubmissions.latitude,
        longitude: formSubmissions.longitude,
        intent: formSubmissions.intent,
        species: formSubmissions.species,
        lifeStage: formSubmissions.lifeStage,
        household: formSubmissions.household,
        answersJson: formSubmissions.answersJson,
        linkedAdopterId: formSubmissions.linkedAdopterId,
        autoAdopterId: formSubmissions.autoAdopterId,
        createdAt: formSubmissions.createdAt,
    })
        .from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        .where(where as never)
        .all() as ApplicationRow[];
}

type ProposalInfo = NonNullable<ApplicantSummary['proposal']>;

/**
 * The «Sumar a un animal» link of a row, both sides: a general form in state proposed (→ its candidacy), or a
 * candidacy of origin proposed (→ the general form that made it). `canUndo` counts every contract link ever
 * issued for that animal to either profile of the form. Null for any other row.
 */
async function proposalOf(db: Db, row: ApplicationRow): Promise<{ info: ProposalInfo; proposerEmail: string | null } | null> {
    const { applications, contractInvitations } = await import('@/db/schema');
    const { eq, and, sql } = await import('drizzle-orm');
    let generalApplicationId: string; let closedBy: string | null; let candidacy: { id: string; animalId: string | null; state: string };
    if (row.origin === APPLICATION_ORIGINS.PROPOSED) {
        const g = await db.select({ id: applications.id, closedBy: applications.closedBy }).from(applications)
            .where(eq(applications.proposedApplicationId, row.applicationId)).get() as { id: string; closedBy: string | null } | undefined;
        if (!g) return null;
        generalApplicationId = g.id; closedBy = g.closedBy;
        candidacy = { id: row.applicationId, animalId: row.animalId, state: row.state };
    } else if (row.state === APPLICATION_STATES.PROPOSED && row.proposedApplicationId) {
        const c = await db.select({ id: applications.id, animalId: applications.animalId, state: applications.state }).from(applications)
            .where(eq(applications.id, row.proposedApplicationId)).get() as { id: string; animalId: string | null; state: string } | undefined;
        if (!c) return null;
        generalApplicationId = row.applicationId; closedBy = row.closedBy; candidacy = c;
    } else {
        return null;
    }
    const profiles = [...new Set([row.linkedAdopterId, row.autoAdopterId].filter((x): x is string => !!x))];
    const links = !candidacy.animalId ? 0 : (await Promise.all(profiles.map(id => db.select({ n: sql<number>`count(*)` }).from(contractInvitations)
        .where(and(eq(contractInvitations.animalId, candidacy.animalId!), eq(contractInvitations.adopterId, id))).get() as Promise<{ n: number } | undefined>)))
        .reduce((sum, r) => sum + (r?.n ?? 0), 0);
    // Another application a merge pointed at the candidacy keeps it (review M2): no undo offered.
    const pointedAt = await db.select({ id: applications.id }).from(applications)
        .where(eq(applications.replacedByApplicationId, candidacy.id)).get() as { id: string } | undefined;
    return {
        info: { generalApplicationId, candidacyId: candidacy.id, animal: null, byName: null, canUndo: !pointedAt && proposalUndoable({ candidacyState: candidacy.state, invitationsEver: links }) },
        proposerEmail: closedBy,
    };
}

type EnrichCtx = { op: string; animalId: string | null; teamEmails: readonly string[]; viewerEmail: string | null | undefined };

/**
 * The full, enriched applicant list for one animal within `teamEmails` (the
 * animal OWNER's team): to evaluate first, then contract sent, then outcomes.
 * The caller has already authorized the viewer.
 */
export async function loadApplicantsForAnimal(
    db: Db,
    animal: { id: string; adopterId: string | null },
    teamEmails: readonly string[],
    /** Who is looking: the housemate chips are read as this viewer's search card reads them. */
    viewerEmail: string | null | undefined,
): Promise<ApplicantSummary[]> {
    const where = applicantScopeWhere(animal.id, teamEmails);
    if (!where) {
        logger.warn('loadApplicantsForAnimal: empty team scope — failing closed', { animalId: animal.id });
        return [];
    }
    await healMissingApplications(db, teamEmails);
    const rows = await selectApplicationRows(db, where);
    return panelOrder(await enrichApplicantRows(db, rows, { op: 'loadApplicantsForAnimal', animalId: animal.id, teamEmails, viewerEmail }));
}

/**
 * The viewer's team's general applications (forms with no animal, or for an
 * animal that was already adopted), enriched like an animal's list.
 */
export async function loadGeneralApplications(
    db: Db,
    teamEmails: readonly string[],
    viewerEmail: string | null | undefined,
    /**
     * What to read (review I4: the whole history grows with every form ever received, and each row costs
     * several D1 queries): `applicationId` = that one request (a link or a row opens it alone). Neither = every
     * general application. The «Formularios generales» list reads light rows instead (`listGeneralToEvaluate`, I-3).
     */
    scope: { applicationId?: string } = {},
): Promise<ApplicantSummary[]> {
    const team = generalScopeWhere(teamEmails);
    if (!team) {
        logger.warn('loadGeneralApplications: empty team scope — failing closed', { viewer: viewerEmail ?? null });
        return [];
    }
    const { applications } = await import('@/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const where = scope.applicationId ? and(team as never, eq(applications.id, scope.applicationId)) : team;
    // One request by id already has its row: the heal (forms missing their application) is for the lists.
    if (!scope.applicationId) await healMissingApplications(db, teamEmails);
    const rows = await selectApplicationRows(db, where);
    return panelOrder(await enrichApplicantRows(db, rows, { op: 'loadGeneralApplications', animalId: null, teamEmails, viewerEmail }));
}

/**
 * Per-row enrichment shared by both lists. D1-safe — no inArray: each linked
 * adopter gets parallel lookups, and an animal row one invitations read.
 */
async function enrichApplicantRows(db: Db, rows: ApplicationRow[], ctx: EnrichCtx): Promise<ApplicantSummary[]> {
    if (rows.length === 0) return [];
    const { adopters, adoptions, applications, contractInvitations, adopterFlags } = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');
    const { animalId, viewerEmail } = ctx;
    const nowSec = Math.floor(Date.now() / 1000);

    const parseHousehold = (raw: string | null): string[] | null => {
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
            return null;
        } catch {
            return null;
        }
    };

    // Each linked person's records, kept for their alerts (read below, once the list is built).
    type AlertRecord = { recordType: string | null; date: Date | number | null; addedBy: string | null };
    const recordsByAdopter = new Map<string, AlertRecord[]>();

    // Per-applicant enrichment. D1-safe — no inArray. Each linked adopter
    // gets parallel lookups for name+context, activity records (for both
    // rating + counts), flag rows, and contract-invite state. Orphan
    // submissions (linkedAdopterId=null) get a zeroed shape.
    // Who added each proposed person (the general form's closer): names resolved in one batch below.
    const proposerOf = new Map<string, string>();
    const enriched = await Promise.all(rows.map(async (row): Promise<ApplicantSummary> => {
        let adopterName = row.name;
        let adopterRating: number | null = null;
        let adoptionCount = 0;
        let requestCount = 0;
        let flags: AdopterFlags | null = null;
        let adopterContext: ApplicantAdopterContext | null = null;
        // The profile the form sits on, when it is LIVE: a soft-deleted or missing one reads as unlinked (no
        // to-do — `isToDo`), as the counts' `openOnProfile` reads it (applicationCounts.ts).
        let profileId: string | null = null;

        type LinkedRecord = { rating: number | null; recordType: string | null; date: Date | number | null; addedBy: string | null; identityVerified: number | null; deliveredToHome: number | null; verifiedAddress: string | null };
        let records: LinkedRecord[] = [];
        let flagRows: Array<{ reason: string | null; targetAdopterId: string | null; details: string | null }> = [];
        if (row.linkedAdopterId) {
            let adopter: { name: string; addedBy: string | null; source: string | null; country: string | null; deletedAt: unknown } | undefined;
            [adopter, records, flagRows] = await Promise.all([
                db.select({
                    name: adopters.name,
                    addedBy: adopters.addedBy,
                    source: adopters.source,
                    country: adopters.country,
                    deletedAt: adopters.deletedAt,
                })
                    .from(adopters)
                    .where(eq(adopters.id, row.linkedAdopterId))
                    .get() as Promise<{ name: string; addedBy: string | null; source: string | null; country: string | null; deletedAt: unknown } | undefined>,
                db.select({ rating: adoptions.rating, recordType: adoptions.recordType, date: adoptions.date, addedBy: adoptions.addedBy, identityVerified: adoptions.identityVerified, deliveredToHome: adoptions.deliveredToHome, verifiedAddress: adoptions.verifiedAddress })
                    .from(adoptions)
                    .where(eq(adoptions.adopterId, row.linkedAdopterId))
                    .all() as Promise<Array<{ rating: number | null; recordType: string | null; date: Date | number | null; addedBy: string | null; identityVerified: number | null; deliveredToHome: number | null; verifiedAddress: string | null }>>,
                db.select({ reason: adopterFlags.reason, targetAdopterId: adopterFlags.targetAdopterId, details: adopterFlags.details })
                    .from(adopterFlags)
                    .where(eq(adopterFlags.adopterId, row.linkedAdopterId))
                    .all() as Promise<Array<{ reason: string | null; targetAdopterId: string | null; details: string | null }>>,
            ]);
            if (adopter && !adopter.deletedAt) {
                profileId = row.linkedAdopterId;
                adopterName = adopter.name;
                adopterContext = {
                    addedBy: adopter.addedBy,
                    addedByName: null, // filled below in one batched lookup
                    source: adopter.source,
                    country: adopter.country,
                };
            }
        }
        if (profileId) {
            adopterRating = computeAvgRating(records);
            for (const r of records) {
                if (r.recordType === 'adoption') adoptionCount++;
                else if (r.recordType === 'adoption_request') requestCount++;
            }
            // systemDuplicateCount=0 here — looking up duplicate_candidates per
            // applicant would add another N queries with no UI consumer (panel
            // surfaces flag pills, not the system-duplicate badge). If we ever
            // surface it, add a third parallel query above.
            // The period alerts are filled in below, once per list (P2), and only when read.
            flags = { ...buildFlags(flagRows.map(f => ({ adopterId: profileId!, ...f })), 0, records), ...NO_PERIOD_ALERTS };
            recordsByAdopter.set(profileId, records);
        }

        // Every invitation of this animal + adopter: the status (contract sent / retired link) reads them.
        let invitations: InvitationLike[] = [];
        if (row.animalId && profileId) {
            invitations = await db.select({
                createdAt: contractInvitations.createdAt,
                expiresAt: contractInvitations.expiresAt,
                usedAt: contractInvitations.usedAt,
            })
                .from(contractInvitations)
                .where(and(eq(contractInvitations.animalId, row.animalId), eq(contractInvitations.adopterId, profileId)))
                .all() as InvitationLike[];
        }
        const status = applicationStatus(
            { state: row.state as ApplicationState, closeReason: row.closeReason as ApplicationCloseReason | null, closedAt: row.closedAt },
            invitations, nowSec,
        );

        // «Pidió a …» / «Propuesta para …» / «También pidió a …»: only an animal of the viewer's team is named.
        // `allowUnnamed`: a proposal's animal is the team's own by construction (proposeAnimal gates it) —
        // an unnamed one is still returned (blank name; the panel says «Sin nombre»), never another team's.
        // `allowUnnamed` is the proposal's lookup: it also says whether that animal is adopted by now (Jon 2026-11-13:
        // the person stays added — «Quitar» still works — but the request shows the animal is no longer available).
        const teamAnimal = async (animalId: string, what: string, opts: { allowUnnamed?: boolean } = {}): Promise<ApplicantSummary['outcomeAnimal']> => {
            try {
                const a = await db.select({ id: adoptions.id, name: adoptions.animalName, sex: adoptions.sex, owner: adoptions.addedBy, recordType: adoptions.recordType })
                    .from(adoptions)
                    .where(eq(adoptions.id, animalId))
                    .get() as { id: string; name: string | null; sex: string | null; owner: string | null; recordType: string | null } | undefined;
                if (!a) return null;
                const adopted = opts.allowUnnamed && a.recordType === RECORD_TYPES.ADOPTION ? { adopted: true } : {};
                if (opts.allowUnnamed && !a.name?.trim()) {
                    return a.owner && isInTeamScope(a.owner, normalizeTeamScope(ctx.teamEmails)) ? { id: a.id, name: '', sex: a.sex, ...adopted } : null;
                }
                const visible = teammateVisibleAnimal({ id: a.id, name: a.name, owner: a.owner }, ctx.teamEmails);
                return visible ? { id: visible.id, name: visible.name, sex: a.sex, ...adopted } : null;
            } catch (e) {
                logger.warn(`${ctx.op}: ${what} lookup fallback`, {
                    applicationId: row.applicationId, animalId, error: e instanceof Error ? e.message : String(e),
                });
                return null;
            }
        };
        const askedAnimal = row.origin === APPLICATION_ORIGINS.ADOPTED_ANIMAL && row.askedAnimalId
            ? await teamAnimal(row.askedAnimalId, 'asked-animal')
            : null;
        // The application a general one led to: the proposal, or the same person's application for an animal.
        const ledTo = row.state === APPLICATION_STATES.PROPOSED ? row.proposedApplicationId
            : row.state === APPLICATION_STATES.ALSO_APPLIED ? row.replacedByApplicationId
                : null;
        let outcomeAnimal: ApplicantSummary['outcomeAnimal'] = null;
        if (ledTo) {
            try {
                const target = await db.select({ animalId: applications.animalId })
                    .from(applications)
                    .where(eq(applications.id, ledTo))
                    .get() as { animalId: string | null } | undefined;
                if (target?.animalId) outcomeAnimal = await teamAnimal(target.animalId, 'outcome-animal', { allowUnnamed: row.state === APPLICATION_STATES.PROPOSED });
            } catch (e) {
                logger.warn(`${ctx.op}: outcome-animal lookup fallback`, {
                    applicationId: row.applicationId, ledTo, error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        let proposal: ProposalInfo | null = null;
        try {
            const p = await proposalOf(db, row);
            if (p) {
                const general = row.state === APPLICATION_STATES.PROPOSED;
                // An animal this viewer's team can't see (the person was added in another group): named nowhere, never undone from here.
                proposal = { ...p.info, animal: general ? outcomeAnimal : null, canUndo: p.info.canUndo && (!general || outcomeAnimal !== null) };
                if (p.proposerEmail) proposerOf.set(row.applicationId, p.proposerEmail);
            }
        } catch (e) {
            // Without it the panel shows no «Cambiar / Quitar»: logged, never a lost list.
            logger.warn(`${ctx.op}: proposal lookup fallback`, { applicationId: row.applicationId, error: e instanceof Error ? e.message : String(e) });
        }

        return {
            applicationId: row.applicationId,
            origin: row.origin as ApplicantSummary['origin'],
            proposal,
            status,
            askedAnimal,
            outcomeAnimal,
            submissionId: row.id,
            adopterId: profileId,
            adopterName,
            adopterRating,
            profileFromThisForm: !!row.linkedAdopterId && row.linkedAdopterId === row.autoAdopterId,
            appliedAt: row.createdAt ? Math.floor(row.createdAt.getTime() / 1000) : null,
            hasInvite: status.kind === 'contract_sent',
            // A foster holder's own application is not «Firmado»: only the adopter's adopted application is.
            isSigned: status.kind === 'adopted',
            flags,
            alertsChecked: false,
            housemateAlert: NO_HOUSEMATE_ALERT,
            adoptionCount,
            requestCount,
            intent: row.intent,
            species: row.species,
            lifeStage: row.lifeStage,
            submission: {
                email: row.email,
                phone: row.phone,
                address: row.address,
                selfieUrl: row.selfieUrl,
                photos: photoLinks(row.id, row.photoKeys),
                latitude: row.latitude,
                longitude: row.longitude,
                household: parseHousehold(row.household),
                answersJson: row.answersJson,
            },
            adopterContext,
        } satisfies ApplicantSummary;
    }));

    // The person's ALERTS, as the full profile shows them (P2 — Jon, 2026-11-08): their
    // period alerts by the one rule (periodAlerts, the Admin thresholds, requests counted
    // per rescue) and the housemate chips, read as a search card reads them. Each half is
    // read strictly and settles on its own: what was read is shown, a failed half is
    // logged, and «checked» (the panel's «Sin alertas en el perfil») needs both.
    const linkedIds = [...recordsByAdopter.keys()];
    if (linkedIds.length > 0) {
        const alertsCtx = { animalId, viewer: viewerEmail ?? null, applicants: linkedIds.length };
        const warnFailed = (half: string) => (e: unknown) => {
            logger.warn(`${ctx.op}: ${half} alerts lookup failed, the panel claims no «Sin alertas»`, {
                ...alertsCtx, error: e instanceof Error ? e.message : String(e),
            });
            return null;
        };
        const needKeys = [...recordsByAdopter.values()].some(rs => rs.some(r => r.recordType === RECORD_TYPES.REQUEST));
        const [period, housemates] = await Promise.all([
            (async () => {
                const [{ getAdoptionConfig }, { loadRescueKeys, withRescueKeys }] = await Promise.all([import('./config'), import('@/lib/rescueKeys')]);
                const [config, keys] = await Promise.all([
                    getAdoptionConfig({ strict: true }),
                    needKeys ? loadRescueKeys(db, ctx.op) : Promise.resolve(new Map<string, string>()),
                ]);
                return (adopterId: string) => periodAlerts(withRescueKeys(recordsByAdopter.get(adopterId) ?? [], keys), config);
            })().catch(warnFailed('period')),
            (async () => {
                const { housemateAlertsFor } = await import('@/lib/households');
                return await housemateAlertsFor(db, viewerEmail, linkedIds, { strict: true });
            })().catch(warnFailed('housemate')),
        ]);
        for (const a of enriched) {
            if (!a.adopterId || !a.flags) continue;
            if (period) a.flags = { ...a.flags, ...period(a.adopterId) };
            if (housemates) a.housemateAlert = housemates[a.adopterId] ?? NO_HOUSEMATE_ALERT;
            a.alertsChecked = !!period && !!housemates;
        }
    }

    // «Sumó …»: the proposer's name, in one batch (D1-safe), degrading to the email handle.
    if (proposerOf.size > 0) {
        try {
            const { resolveDisplayNames } = await import('./notifications');
            const names = await resolveDisplayNames([...new Set(proposerOf.values())]);
            for (const a of enriched) {
                const email = proposerOf.get(a.applicationId);
                if (a.proposal && email) a.proposal.byName = names.get(email.toLowerCase()) ?? email.split('@')[0];
            }
        } catch (e) {
            logger.warn(`${ctx.op}: proposer name lookup fallback`, { animalId, count: proposerOf.size, error: e instanceof Error ? e.message : String(e) });
            for (const a of enriched) {
                const email = proposerOf.get(a.applicationId);
                if (a.proposal && email) a.proposal.byName = email.split('@')[0];
            }
        }
    }

    // "Agregado por": the rescuer's name, not their email handle. One
    // batched, D1-safe lookup for every distinct addedBy on this animal.
    const addedByEmails = enriched
        .map(a => a.adopterContext?.addedBy)
        .filter((e): e is string => !!e);
    if (addedByEmails.length > 0) {
        try {
            const { resolveDisplayNames } = await import('./notifications');
            const names = await resolveDisplayNames(addedByEmails);
            for (const a of enriched) {
                const ctx = a.adopterContext;
                if (ctx?.addedBy) ctx.addedByName = names.get(ctx.addedBy.toLowerCase()) ?? null;
            }
        } catch (e) {
            // Names degrade to the email handle at render; never lose the list.
            logger.warn(`${ctx.op}: addedBy name lookup fallback`, {
                animalId, count: addedByEmails.length,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    return enriched;
}
