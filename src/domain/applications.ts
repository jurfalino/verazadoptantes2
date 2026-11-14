/**
 * Adoption-application rules — pure domain (no DB / server / React imports).
 * Times are unix seconds, except animal birth dates (ms).
 */
import {
    APPLICATION_STATES, APPLICATION_ORIGINS, APPLICATION_CLOSE_REASONS, INVITATION_TTL_DAYS, LIFE_STAGE_YEARS,
    type ApplicationState, type ApplicationOrigin, type ApplicationCloseReason,
} from './constants';

const DAY_SEC = 86_400;

export type InvitationLike = { createdAt: number; expiresAt: number | null; usedAt: number | null };

/** Live = unused and unexpired; expires_at NULL counts as live (by-token/submit treat it so). */
export function isLiveInvitation(inv: InvitationLike, nowSec: number): boolean {
    return inv.usedAt == null && (inv.expiresAt == null || inv.expiresAt > nowSec);
}

export type ContractNote = { kind: 'replaced' | 'expired'; at: number };

/** Why an open application has no live contract: its newest unused link was retired early or ran out. */
export function contractNote(invitations: readonly InvitationLike[], nowSec: number): ContractNote | null {
    if (invitations.some((i) => isLiveInvitation(i, nowSec))) return null;
    const dead = invitations.filter((i) => i.usedAt == null && i.expiresAt != null);
    if (dead.length === 0) return null;
    const newest = dead.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const at = newest.expiresAt as number;
    return { kind: at < newest.createdAt + INVITATION_TTL_DAYS * DAY_SEC ? 'replaced' : 'expired', at };
}

export type ApplicationFacts = { state: ApplicationState; closeReason: ApplicationCloseReason | null; closedAt: number | null };
export type ApplicationStatus =
    | { kind: 'to_evaluate'; note: ContractNote | null }
    | { kind: 'contract_sent'; sentAt: number }
    | { kind: 'declined'; at: number | null }
    | { kind: 'closed'; reason: ApplicationCloseReason }
    | { kind: 'adopted' } | { kind: 'proposed' } | { kind: 'replaced' } | { kind: 'also_applied' };

export function applicationStatus(app: ApplicationFacts, invitations: readonly InvitationLike[], nowSec: number): ApplicationStatus {
    switch (app.state) {
        case APPLICATION_STATES.OPEN: {
            const liveLinks = invitations.filter((i) => isLiveInvitation(i, nowSec));
            if (liveLinks.length > 0) return { kind: 'contract_sent', sentAt: Math.max(...liveLinks.map((i) => i.createdAt)) };
            return { kind: 'to_evaluate', note: contractNote(invitations, nowSec) };
        }
        case APPLICATION_STATES.DECLINED: return { kind: 'declined', at: app.closedAt };
        case APPLICATION_STATES.CLOSED: return { kind: 'closed', reason: app.closeReason ?? APPLICATION_CLOSE_REASONS.ADOPTED_OTHER };
        case APPLICATION_STATES.ADOPTED: return { kind: 'adopted' };
        case APPLICATION_STATES.PROPOSED: return { kind: 'proposed' };
        case APPLICATION_STATES.REPLACED: return { kind: 'replaced' };
        default: return { kind: 'also_applied' };
    }
}

export function isToEvaluate(s: ApplicationStatus): boolean {
    return s.kind === 'to_evaluate';
}

/** What deleting the animal loses: its applications still open (to evaluate, or with a live contract). Declined / closed / replaced ones are already outcomes. */
export function candidatesLostOnDelete(items: ReadonlyArray<{ status: ApplicationStatus }>): number {
    return items.filter((a) => a.status.kind === 'to_evaluate' || a.status.kind === 'contract_sent').length;
}

/** What every count counts: to evaluate AND on a profile. A form whose profile auto-create failed is listed (with «Ver formulario») but is no to-do until linked: it can't be declined or proposed. */
export function isToDo(a: { status: ApplicationStatus; adopterId: string | null }): boolean {
    return isToEvaluate(a.status) && a.adopterId != null;
}

function outcomeAt(s: ApplicationStatus): number {
    return s.kind === 'declined' ? (s.at ?? 0) : 0;
}

/** To evaluate (oldest first), then contract sent (oldest first), then outcomes (newest first). */
export function panelOrder<T extends { status: ApplicationStatus; appliedAt: number | null }>(items: readonly T[]): T[] {
    const rank = (s: ApplicationStatus) => (s.kind === 'to_evaluate' ? 0 : s.kind === 'contract_sent' ? 1 : 2);
    const applied = (i: T) => i.appliedAt ?? 0;
    return [...items].sort((a, b) => {
        const ra = rank(a.status), rb = rank(b.status);
        if (ra !== rb) return ra - rb;
        if (ra === 2) return applied(b) - applied(a) || outcomeAt(b.status) - outcomeAt(a.status);
        return applied(a) - applied(b);
    });
}

/** The next to-evaluate item after `from`, wrapping to the first; -1 when none is left. */
export function nextToEvaluateIndex(statuses: readonly ApplicationStatus[], from: number): number {
    for (let i = from + 1; i < statuses.length; i++) if (isToEvaluate(statuses[i])) return i;
    return statuses.findIndex(isToEvaluate);
}

export type AdoptionVia = 'invitation' | 'in_app' | 'open_link';

/**
 * Who gets what when an animal is adopted: the adopter's own application →
 * adopted; every other open one → closed. The adopter is recognised on either
 * profile of the form — the one it sits on or the one it created (review S3:
 * a link sent to the auto-created profile, signed after a «Sí» linked the form
 * elsewhere). On the open link (no token — anyone who knows the animal can
 * sign it) only the signer's own application moves: the others stay open, so a
 * prank or a mistaken signature never loses the team's candidates (review S1).
 */
export function planAdoptionClose(open: ReadonlyArray<{ id: string; adopterIds: ReadonlyArray<string | null> }>, adopterId: string, via: AdoptionVia):
    Array<{ id: string; state: 'closed' | 'adopted'; closeReason: ApplicationCloseReason | null }> {
    type Step = { id: string; state: 'closed' | 'adopted'; closeReason: ApplicationCloseReason | null };
    return open.flatMap((a): Step[] => {
        if (a.adopterIds.includes(adopterId)) return [{ id: a.id, state: 'adopted' as const, closeReason: null }];
        if (via === 'open_link') return [];
        return [{ id: a.id, state: 'closed' as const, closeReason: APPLICATION_CLOSE_REASONS.ADOPTED_OTHER }];
    });
}

export type MergeApp = { id: string; animalId: string | null; state: ApplicationState; createdAt: number; formOwner: string };

/** After two profiles merge: the newest open application per animal stays; a same-team general is subsumed. */
export function planMergeDedupe(apps: readonly MergeApp[], sameTeam: (a: string, b: string) => boolean):
    Array<{ id: string; state: 'replaced' | 'also_applied'; replacedBy: string }> {
    const open = apps.filter((a) => a.state === APPLICATION_STATES.OPEN);
    const out: Array<{ id: string; state: 'replaced' | 'also_applied'; replacedBy: string }> = [];
    const newestFirst = (a: MergeApp, b: MergeApp) => b.createdAt - a.createdAt;

    const survivors: MergeApp[] = [];
    const byAnimal = new Map<string, MergeApp[]>();
    for (const a of open) if (a.animalId != null) byAnimal.set(a.animalId, [...(byAnimal.get(a.animalId) ?? []), a]);
    for (const group of byAnimal.values()) {
        const [keep, ...rest] = [...group].sort(newestFirst);
        survivors.push(keep);
        for (const r of rest) out.push({ id: r.id, state: APPLICATION_STATES.REPLACED, replacedBy: keep.id });
    }

    const generals = open.filter((a) => a.animalId == null).sort(newestFirst);
    const keptGenerals: MergeApp[] = [];
    for (const g of generals) {
        const animalRow = [...survivors].sort(newestFirst).find((s) => sameTeam(g.formOwner, s.formOwner));
        if (animalRow) {
            out.push({ id: g.id, state: APPLICATION_STATES.ALSO_APPLIED, replacedBy: animalRow.id });
            continue;
        }
        const newer = keptGenerals.find((k) => sameTeam(g.formOwner, k.formOwner));
        if (newer) out.push({ id: g.id, state: APPLICATION_STATES.REPLACED, replacedBy: newer.id });
        else keptGenerals.push(g);
    }
    return out.sort((a, b) => apps.findIndex((x) => x.id === a.id) - apps.findIndex((x) => x.id === b.id));
}

/** What a submitted form applies for: an adopted animal → a general application remembering the ask; unknown id → general; lookup failure (undefined) → the animal. */
export function submissionApplication(selectedAnimalId: string | null, animal: { recordType: string | null; adopterId: string | null } | null | undefined):
    { animalId: string | null; origin: ApplicationOrigin; askedAnimalId: string | null } {
    if (selectedAnimalId == null) return { animalId: null, origin: APPLICATION_ORIGINS.FORM, askedAnimalId: null };
    if (animal === undefined) return { animalId: selectedAnimalId, origin: APPLICATION_ORIGINS.FORM, askedAnimalId: null };
    if (animal === null) return { animalId: null, origin: APPLICATION_ORIGINS.FORM, askedAnimalId: null };
    if (animal.recordType === 'adoption' && animal.adopterId) {
        return { animalId: null, origin: APPLICATION_ORIGINS.ADOPTED_ANIMAL, askedAnimalId: selectedAnimalId };
    }
    return { animalId: selectedAnimalId, origin: APPLICATION_ORIGINS.FORM, askedAnimalId: null };
}

/**
 * Where a form's bell notice leads (spec «Notifications»: its link opens the panel for that
 * application): «Con solicitudes por evaluar» on Mis animales, at that application — a general form
 * opens alone in «Mis adoptantes» (`requestHref`). The form itself when Mis animales is off, when no
 * application was written, or when the application's animal is not the link owner's team's (a
 * forged `?animal=`: nobody's to evaluate — `teamApplicationsWhere`).
 */
export function formNoticeUrl(n: { submissionId: string; applicationId: string | null; animalId: string | null; animalInTeam: boolean; animalsOn: boolean }): string {
    const form = `/form-results/${n.submissionId}`;
    if (!n.animalsOn || !n.applicationId || (n.animalId && !n.animalInTeam)) return form;
    // A general form is a person to evaluate: it opens alone in «Mis adoptantes» (Jon 2026-11-13).
    if (!n.animalId) return requestHref(n.applicationId);
    return animalApplicationHref(n.animalId, n.applicationId);
}

/** One application on its animal's candidates («Mis animales» → «Con solicitudes por evaluar», the panel at it). */
export function animalApplicationHref(animalId: string, applicationId: string): string {
    return `/my-animals?view=solicitudes&animal=${encodeURIComponent(animalId)}&solicitud=${encodeURIComponent(applicationId)}`;
}

/** «Cargar un animal» from «Proponer un animal» (Jon 2026-11-13): «Agregar animal», proposing to this application on save. */
export function proposeNewAnimalHref(applicationId: string): string {
    return `/my-animals/new?proponer=${encodeURIComponent(applicationId)}`;
}

/**
 * A general form's request, opened alone in «Mis adoptantes» → «Pendientes de revisar» (Jon 2026-11-13:
 * general forms are people, not an animal card). The bell notice, the email and «Cargar un animal»'s
 * return all lead here; old /my-animals links redirect here.
 */
export function requestHref(applicationId: string): string {
    return `/my-adopters?solicitud=${encodeURIComponent(applicationId)}#pendientes`;
}

/** Kept for its callers: the general request's link is `requestHref`. */
export function generalRequestHref(applicationId: string): string {
    return requestHref(applicationId);
}

/**
 * «Cambiar animal» / «Quitar de …» on a team-added candidate: only while nothing happened on the animal's
 * side for that person — the candidacy still open (no «No avanzar», not adopted or closed) and no contract
 * link ever issued (the person would have been told).
 */
export function proposalUndoable(f: { candidacyState: string; invitationsEver: number }): boolean {
    return f.candidacyState === APPLICATION_STATES.OPEN && f.invitationsEver === 0;
}

/** `?proponer=` as read from the address: an id's shape, or nothing. */
export function proposeParam(raw: string | null | undefined): string | null {
    return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

export type LifeStage = 'puppy' | 'young' | 'senior';

export function lifeStageOf(birthMs: number | null, nowMs: number): LifeStage | null {
    if (birthMs == null) return null;
    const years = (nowMs - birthMs) / (365.25 * DAY_SEC * 1000);
    return years < LIFE_STAGE_YEARS.PUPPY_UNDER ? 'puppy' : years >= LIFE_STAGE_YEARS.SENIOR_FROM ? 'senior' : 'young';
}

/** «Prefiere»: species none/null = any, both = dog or cat, other = neither; life stage none/null = any. */
export function matchesPreference(animal: { species: string | null; birthMs: number | null }, pref: { species: string | null; lifeStage: string | null }, nowMs: number): boolean {
    const isDogOrCat = animal.species === 'dog' || animal.species === 'cat';
    let speciesOk: boolean;
    if (!pref.species || pref.species === 'none') speciesOk = true;
    else if (pref.species === 'both') speciesOk = isDogOrCat;
    else if (pref.species === 'other') speciesOk = !isDogOrCat;
    else speciesOk = animal.species === pref.species;
    if (!speciesOk) return false;
    if (!pref.lifeStage || pref.lifeStage === 'none') return true;
    return lifeStageOf(animal.birthMs, nowMs) === pref.lifeStage;
}

/** Animals that match the applicant's preference first, then by name. */
export function rankProposalAnimals<T extends { name: string | null; species: string | null; birthMs: number | null }>(animals: readonly T[], pref: { species: string | null; lifeStage: string | null }, nowMs: number): Array<T & { matches: boolean }> {
    return animals
        .map((a) => ({ ...a, matches: matchesPreference(a, pref, nowMs) }))
        .sort((a, b) => Number(b.matches) - Number(a.matches) || (a.name ?? '￿').localeCompare(b.name ?? '￿'));
}

/**
 * «Agregar animal» opened from a request (`?proponer=`): what saving does with the new animal (UX review S3).
 * `add` — the request is still to evaluate: the person joins the new animal's candidates. `change` — the person
 * is already among another animal's candidates and that can still be undone («Cambiar animal» → «Cargar otro
 * animal»): they move to the new one. Null — decided, not undoable, or not this viewer's: the plain page.
 */
export function newAnimalProposeMode(a: {
    adopterName: string;
    status: ApplicationStatus;
    proposal?: { canUndo: boolean; animal: { name: string; sex: string | null } | null } | null;
} | null): { kind: 'add'; name: string } | { kind: 'change'; name: string; from: { name: string; sex: string | null } } | null {
    if (!a) return null;
    if (a.status.kind === 'to_evaluate') return { kind: 'add', name: a.adopterName };
    if (a.status.kind === 'proposed' && a.proposal?.canUndo && a.proposal.animal) {
        return { kind: 'change', name: a.adopterName, from: { name: a.proposal.animal.name, sex: a.proposal.animal.sex } };
    }
    return null;
}
