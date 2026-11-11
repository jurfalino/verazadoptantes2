/**
 * Authorization and DB work behind the evaluation actions
 * (src/app/actions/applications.ts). NOT a `'use server'` module: every
 * export of one is a public endpoint, and these take the viewer as an
 * argument and trust the caller to have read it from the session.
 *
 * The access rule is the applicant list's (applicantScope.ts): an animal's
 * application belongs to the animal OWNER's team, and only when the form link
 * that produced it is in that team too (a forged `?animal=` row is nobody's);
 * a general one to whoever may open its form (canAccessFormSubmission); a
 * «replaced» application is in no access decision. Anything else is
 * «not found» — never a hint that it exists.
 */
import { and, eq, isNotNull, isNull, ne, or, gt, sql } from 'drizzle-orm';
import { adopterEvents, adopterImages, adopters, adoptions, animals, applications, contractInvitations, formSubmissions, placements } from '@/db/schema';
import { APPLICATION_CLOSE_REASONS, APPLICATION_ORIGINS, APPLICATION_STATES, DECLINE_REASON_MAX, DECLINE_TEXT_MAX, RECORD_TYPES } from '@/domain/constants';
import { rankProposalAnimals } from '@/domain/applications';
import { takesContract } from '@/domain/placements';
import { applicantScopeWhere, isInTeamScope, normalizeTeamScope } from '@/lib/applicantScope';
import { countOpenByAnimal } from '@/lib/applicationCounts';
import { firstName } from '@/lib/householdCopy';
import { logger } from '@/lib/logger';
import { myAnimalsScope } from '@/lib/myAnimalsScope';
import { getTeamEmails } from '@/lib/orgMembership';
import { animalPrimaryFirst } from '@/lib/showcase';
import { canAccessFormSubmission, createOwnerTeamResolver, isOwnerOrgMateOrAdmin } from './_applicants';
import type { getDb } from '@/lib/db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Ids the browser sends: a non-empty string the length of any id we mint (the record validator's cap). */
export const MAX_ID_LENGTH = 64;
export { DECLINE_TEXT_MAX, DECLINE_REASON_MAX };
/** The pre-seeded observation id of a decline: a retry writes the SAME record. */
export const declineRecordId = (applicationId: string) => `decline-${applicationId}`;

export function isId(v: unknown): v is string {
    return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

/** A decline the server may write: rating an integer 1–5; text and reason trimmed, non-blank, capped. Null when invalid. */
export function parseDecline(input: unknown): { text: string; reason: string; rating: number } | null {
    if (!input || typeof input !== 'object') return null;
    const { text, reason, rating } = input as Record<string, unknown>;
    if (typeof text !== 'string' || typeof reason !== 'string' || typeof rating !== 'number') return null;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
    const t = text.trim(), r = reason.trim();
    if (!t || t.length > DECLINE_TEXT_MAX || !r || r.length > DECLINE_REASON_MAX) return null;
    return { text: t, reason: r, rating };
}

export type GateAnimal = {
    id: string; name: string | null; sex: string | null; species: string | null; birthMs: number | null;
    addedBy: string | null; adopterId: string | null; recordType: string;
};

/** A live (not deleted) animal with its current custody — the `adoptions` view's animal row, read from its tables (never an event id). */
async function readAnimal(db: Db, animalId: string): Promise<GateAnimal | null> {
    const row = await db.select({
        id: animals.id, name: animals.name, sex: animals.sex, species: animals.species, birth: animals.estimatedBirthDate,
        addedBy: animals.addedBy, adopterId: placements.adopterId, recordType: placements.recordType,
    })
        .from(animals)
        .leftJoin(placements, and(eq(placements.animalId, animals.id), isNull(placements.endedAt)))
        .where(and(eq(animals.id, animalId), isNull(animals.deletedAt)))
        .get() as { id: string; name: string | null; sex: string | null; species: string | null; birth: Date | null; addedBy: string | null; adopterId: string | null; recordType: string | null } | undefined;
    if (!row) return null;
    return {
        id: row.id, name: row.name, sex: row.sex, species: row.species, birthMs: row.birth ? row.birth.getTime() : null,
        addedBy: row.addedBy, adopterId: row.adopterId, recordType: row.recordType ?? RECORD_TYPES.AVAILABLE,
    };
}

/**
 * The animal gate (as the animal page's): the animal exists, is not deleted,
 * and the viewer is its owner, an org-mate of the owner, or an admin. Returns
 * the owner's team (whose applications are the animal's). Null otherwise.
 */
export async function loadAuthorizedAnimal(db: Db, animalId: string, viewer: string): Promise<{ animal: GateAnimal; team: string[] } | null> {
    const animal = await readAnimal(db, animalId);
    if (!animal) return null;
    if (!(await isOwnerOrgMateOrAdmin(viewer, animal.addedBy))) return null;
    return { animal, team: await getTeamEmails(animal.addedBy) };
}

export type AuthorizedApplication = {
    app: { id: string; submissionId: string; animalId: string | null; origin: string; state: string };
    submission: {
        id: string; userId: string; name: string; email: string | null; phone: string | null; address: string | null;
        species: string | null; lifeStage: string | null; selectedAnimalId: string | null;
        linkedAdopterId: string | null; autoAdopterId: string | null;
    };
    /** The application's animal (null for a general application). */
    animal: GateAnimal | null;
};

/** The application if `viewer` may act on it (see the module comment); null — «not found» — otherwise. */
export async function loadAuthorizedApplication(db: Db, applicationId: string, viewer: string): Promise<AuthorizedApplication | null> {
    const app = await db.select({
        id: applications.id, submissionId: applications.submissionId, animalId: applications.animalId,
        origin: applications.origin, state: applications.state,
    })
        .from(applications)
        .where(and(eq(applications.id, applicationId), ne(applications.state, APPLICATION_STATES.REPLACED)))
        .get() as AuthorizedApplication['app'] | undefined;
    if (!app) return null;
    const submission = await db.select({
        id: formSubmissions.id, userId: formSubmissions.userId, name: formSubmissions.name,
        email: formSubmissions.email, phone: formSubmissions.phone, address: formSubmissions.address,
        species: formSubmissions.species, lifeStage: formSubmissions.lifeStage, selectedAnimalId: formSubmissions.selectedAnimalId,
        linkedAdopterId: formSubmissions.linkedAdopterId, autoAdopterId: formSubmissions.autoAdopterId,
    })
        .from(formSubmissions)
        .where(eq(formSubmissions.id, app.submissionId))
        .get() as AuthorizedApplication['submission'] | undefined;
    if (!submission) return null;

    if (app.animalId) {
        const gate = await loadAuthorizedAnimal(db, app.animalId, viewer);
        if (!gate || !isInTeamScope(submission.userId, normalizeTeamScope(gate.team))) return null;
        return { app, submission, animal: gate.animal };
    }
    const allowed = await canAccessFormSubmission(db, { userId: submission.userId, selectedAnimalId: submission.selectedAnimalId }, viewer);
    return allowed ? { app, submission, animal: null } : null;
}

/** The linked profile, when it is live. */
export async function liveAdopterExists(db: Db, adopterId: string | null): Promise<boolean> {
    if (!adopterId) return false;
    const row = await db.select({ id: adopters.id }).from(adopters)
        .where(and(eq(adopters.id, adopterId), isNull(adopters.deletedAt))).get();
    return !!row;
}

/**
 * «No avanzar» voids a live contract link of this animal + person (spec Q1):
 * the same retirement a newer send does (`createContractInvitation`), so the
 * link answers «expired». Used links are history and stay as they are.
 */
export async function retireLiveLink(db: Db, animalId: string, adopterId: string, nowSec: number): Promise<void> {
    await db.update(contractInvitations)
        .set({ expiresAt: nowSec })
        .where(and(
            eq(contractInvitations.animalId, animalId),
            eq(contractInvitations.adopterId, adopterId),
            isNull(contractInvitations.usedAt),
            or(isNull(contractInvitations.expiresAt), gt(contractInvitations.expiresAt, nowSec)),
        ));
}

/** Compare-and-swap: an OPEN application becomes «declined», pointing at its observation. False when it was no longer open. */
/**
 * Who wrote the pre-seeded «No avanzar» observation of this application, if it exists (`undefined`: none
 * yet). Another rescuer's means their decline is in flight (or its close timed out): this call must not
 * take the record save's EDIT branch over their text.
 */
export async function declineRecordAuthor(db: Db, recordId: string): Promise<string | null | undefined> {
    const row = await db.select({ recordedBy: adopterEvents.recordedBy }).from(adopterEvents)
        .where(eq(adopterEvents.id, recordId)).get() as { recordedBy: string | null } | undefined;
    return row ? row.recordedBy : undefined;
}

/** The application ended «No avanzó» with this observation — whoever's call closed it. */
export async function isDeclinedWith(db: Db, applicationId: string, recordId: string): Promise<boolean> {
    const row = await db.select({ state: applications.state, declineRecordId: applications.declineRecordId }).from(applications)
        .where(eq(applications.id, applicationId)).get() as { state: string; declineRecordId: string | null } | undefined;
    return !!row && row.state === APPLICATION_STATES.DECLINED && row.declineRecordId === recordId;
}

export async function markDeclined(db: Db, applicationId: string, recordId: string, viewer: string, nowSec: number): Promise<boolean> {
    const won = await db.update(applications)
        .set({ state: APPLICATION_STATES.DECLINED, declineRecordId: recordId, closedAt: nowSec, closedBy: viewer })
        .where(and(eq(applications.id, applicationId), eq(applications.state, APPLICATION_STATES.OPEN)))
        .returning({ id: applications.id }) as Array<{ id: string }>;
    return won.length > 0;
}

/** Animals of `animalIds` where this person (their profile, else this one form) has an OPEN application. */
async function openApplicationAnimals(db: Db, person: { adopterId: string | null; submissionId: string }): Promise<Set<string>> {
    const whose = person.adopterId
        ? eq(formSubmissions.linkedAdopterId, person.adopterId)
        : eq(applications.submissionId, person.submissionId);
    const rows = await db.select({ animalId: applications.animalId })
        .from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        .where(and(whose, eq(applications.state, APPLICATION_STATES.OPEN), isNotNull(applications.animalId)))
        .all() as Array<{ animalId: string | null }>;
    return new Set(rows.flatMap(r => (r.animalId ? [r.animalId] : [])));
}

export type ProposalAnimal = { id: string; name: string | null; species: string | null; photo: string | null; matches: boolean; candidates: number };

/**
 * The picker of «Proponer un animal»: the viewer's team's animals that take
 * applications (available + fostered — `availableWhere`), whose owner's team
 * contains the form's link owner, minus the animals this person already has an
 * open application for; matching the form's «Prefiere» first, each with its
 * open candidates (one grouped count per distinct owner team) and lead photo.
 */
export async function loadProposalAnimals(db: Db, viewer: string, auth: AuthorizedApplication): Promise<ProposalAnimal[]> {
    const { submission } = auth;
    const { availableWhere } = await myAnimalsScope(viewer);
    const [rows, alreadyApplied] = await Promise.all([
        db.select({ id: adoptions.id, name: adoptions.animalName, species: adoptions.species, birth: adoptions.estimatedBirthDate, addedBy: adoptions.addedBy })
            .from(adoptions)
            .where(availableWhere)
            .all() as Promise<Array<{ id: string; name: string | null; species: string | null; birth: Date | null; addedBy: string | null }>>,
        openApplicationAnimals(db, { adopterId: submission.linkedAdopterId, submissionId: submission.id }),
    ]);

    // Owner → team once each; a team → its open counts once.
    const teamOf = createOwnerTeamResolver();
    const countsByTeam = new Map<string, Promise<Map<string, number>>>();
    const candidatesIn = (team: string[]) => {
        const key = normalizeTeamScope(team).slice().sort().join(',');
        let hit = countsByTeam.get(key);
        if (!hit) { hit = countOpenByAnimal(db, team); countsByTeam.set(key, hit); }
        return hit;
    };
    const eligible = (await Promise.all(rows.map(async (r) => {
        if (alreadyApplied.has(r.id)) return null;
        const team = await teamOf(r.addedBy);
        if (!isInTeamScope(submission.userId, normalizeTeamScope(team))) return null;
        return { ...r, team };
    }))).filter((r): r is NonNullable<typeof r> => r !== null);

    const ranked = rankProposalAnimals(
        eligible.map(r => ({ ...r, birthMs: r.birth ? r.birth.getTime() : null })),
        { species: submission.species, lifeStage: submission.lifeStage },
        Date.now(),
    );
    return Promise.all(ranked.map(async (a): Promise<ProposalAnimal> => {
        const [counts, photo] = await Promise.all([
            candidatesIn(a.team),
            // The lead photo, as the home row and the /my-animals card pick it.
            db.select({ url: adopterImages.url }).from(adopterImages)
                .where(eq(adopterImages.adoptionId, a.id))
                .orderBy(animalPrimaryFirst(), sql`rowid ASC`).limit(1).get()
                .then((r: { url: string } | undefined) => r?.url ?? null)
                .catch((e: unknown) => {
                    logger.warn('getProposalAnimals: animal photo D1 fallback hit', { animalId: a.id, viewer, error: e instanceof Error ? e.message : String(e) });
                    return null;
                }),
        ]);
        return { id: a.id, name: a.name, species: a.species, photo, matches: a.matches, candidates: counts.get(a.id) ?? 0 };
    }));
}

export type ProposeOutcome = { ok: true; applicationId: string } | { ok: false; error: 'not_found' | 'not_allowed' | 'animal_adopted' | 'already_candidate' | 'already_decided' };

/**
 * A general application becomes a candidacy for `animalId` (origin
 * «proposed»), and the general one ends as «Propuesta para …». The insert is
 * idempotent (unique per form + animal); the general one closes by
 * compare-and-swap, and a call that loses it takes back only the row it made.
 */
export async function proposeAuthorized(db: Db, viewer: string, auth: AuthorizedApplication, animalId: string): Promise<ProposeOutcome> {
    const { app, submission } = auth;
    if (app.animalId) return { ok: false, error: 'not_allowed' };
    if (app.state !== APPLICATION_STATES.OPEN) return { ok: false, error: 'already_decided' };
    if (!(await liveAdopterExists(db, submission.linkedAdopterId))) return { ok: false, error: 'not_allowed' };

    const gate = await loadAuthorizedAnimal(db, animalId, viewer);
    if (!gate) return { ok: false, error: 'not_found' };
    if (!isInTeamScope(submission.userId, normalizeTeamScope(gate.team))) return { ok: false, error: 'not_allowed' };
    if (!takesContract(gate.animal)) return { ok: false, error: 'animal_adopted' };

    const proposalOf = () => db.select({ id: applications.id, state: applications.state })
        .from(applications)
        .where(and(eq(applications.submissionId, submission.id), eq(applications.animalId, animalId), eq(applications.origin, APPLICATION_ORIGINS.PROPOSED)))
        .get() as Promise<{ id: string; state: string } | undefined>;
    const existing = await proposalOf();
    if (existing && existing.state !== APPLICATION_STATES.OPEN) return { ok: false, error: 'already_decided' };

    // Already an open candidate of this animal (another form of the same person), not counting this proposal.
    const scope = applicantScopeWhere(animalId, gate.team);
    if (scope) {
        const candidate = await db.select({ id: applications.id })
            .from(applications)
            .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
            .where(and(
                scope,
                eq(formSubmissions.linkedAdopterId, submission.linkedAdopterId!),
                eq(applications.state, APPLICATION_STATES.OPEN),
                ...(existing ? [ne(applications.id, existing.id)] : []),
            ))
            .get();
        if (candidate) return { ok: false, error: 'already_candidate' };
    }

    let proposalId = existing?.id ?? null;
    let inserted = false;
    if (!proposalId) {
        const made = await db.insert(applications).values({
            id: `app-${crypto.randomUUID()}`,
            submissionId: submission.id,
            animalId,
            origin: APPLICATION_ORIGINS.PROPOSED,
            state: APPLICATION_STATES.OPEN,
            createdAt: new Date(),
        }).onConflictDoNothing().returning({ id: applications.id }) as Array<{ id: string }>;
        inserted = made.length > 0;
        // A concurrent call made it first: the unique index (one proposal per form + animal) kept theirs.
        proposalId = inserted ? made[0].id : ((await proposalOf())?.id ?? null);
        if (!proposalId) throw new Error('proposeAnimal: the proposal row is neither inserted nor found');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const won = await db.update(applications)
        .set({ state: APPLICATION_STATES.PROPOSED, proposedApplicationId: proposalId, closedAt: nowSec, closedBy: viewer })
        .where(and(eq(applications.id, app.id), eq(applications.state, APPLICATION_STATES.OPEN)))
        .returning({ id: applications.id }) as Array<{ id: string }>;
    if (won.length === 0) {
        if (inserted) {
            // Take back only our own row, and never one the winner points at.
            const pointed = await db.select({ id: applications.id }).from(applications)
                .where(eq(applications.proposedApplicationId, proposalId)).get();
            if (!pointed) await db.delete(applications).where(eq(applications.id, proposalId));
        }
        return { ok: false, error: 'already_decided' };
    }
    return { ok: true, applicationId: proposalId };
}

/** The offer sheet's rows (and the home row's count, offerCountsByAnimal): closed by another adoption, offer not done, on a profile. */
function offerRowsWhere(animalId: string, team: readonly string[]) {
    const scope = applicantScopeWhere(animalId, team);
    if (!scope) return null;
    return and(
        scope,
        eq(applications.state, APPLICATION_STATES.CLOSED),
        eq(applications.closeReason, APPLICATION_CLOSE_REASONS.ADOPTED_OTHER),
        isNull(applications.offerDoneAt),
        isNotNull(formSubmissions.linkedAdopterId),
    );
}

export type OfferCandidate = { applicationId: string; firstName: string; phone: string | null; email: string | null };

/** The candidates to tell: their first name and the contacts they typed on the form. */
export async function loadOfferCandidates(db: Db, animalId: string, team: readonly string[]): Promise<OfferCandidate[]> {
    const where = offerRowsWhere(animalId, team);
    if (!where) return [];
    const rows = await db.select({ applicationId: applications.id, name: formSubmissions.name, phone: formSubmissions.phone, email: formSubmissions.email })
        .from(applications)
        .innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
        .where(where)
        .orderBy(applications.createdAt)
        .all() as Array<{ applicationId: string; name: string; phone: string | null; email: string | null }>;
    return rows.map(r => ({ applicationId: r.applicationId, firstName: firstName(r.name), phone: r.phone || null, email: r.email || null }));
}

/** «Listo» / «Ahora no»: the offer is done for every row the sheet listed. One statement per row; returns how many changed. */
export async function markOfferRowsDone(db: Db, animalId: string, team: readonly string[], nowSec: number): Promise<number> {
    const rows = await loadOfferCandidates(db, animalId, team);
    let count = 0;
    for (const r of rows) {
        const won = await db.update(applications)
            .set({ offerDoneAt: nowSec })
            .where(and(
                eq(applications.id, r.applicationId),
                eq(applications.state, APPLICATION_STATES.CLOSED),
                eq(applications.closeReason, APPLICATION_CLOSE_REASONS.ADOPTED_OTHER),
                isNull(applications.offerDoneAt),
            ))
            .returning({ id: applications.id }) as Array<{ id: string }>;
        count += won.length;
    }
    return count;
}
