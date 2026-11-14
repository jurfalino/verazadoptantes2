import type { DueTop } from '@/lib/animalFollowupsDue';

/** One card's data, or the errorId of why it could not load (shown, never hidden). */
export type HomeSection<T> = { ok: true; data: T } | { ok: false; errorId: string };

export type HomePersonRow = {
    id: string;
    name: string | null;
    thumbnail: string | null;
    avgRating: number | null;
};

/**
 * The first «Pendientes de revisar» row whose next move is the viewer's
 * (needsViewer): the homepage's amber row names it (Jon 2026-11-09, option A).
 */
export type HomePendingItem = {
    group: 'pair' | 'received' | 'declined';
    /** The two profiles' names, as the row shows them. */
    names: [string, string];
    /** The two profiles' ids: which row the panel opens (pairKey). */
    ids: [string, string];
    /** «{name} te pide unir» / «{name} no aceptó unir»: the request's other side. */
    by: string | null;
    /** «Coinciden: … · Distintos: …», as the closed row in Mis adoptantes says it. */
    summary: { same: string[]; diff: string[]; flagged: boolean };
};

export type HomeAdoptersData = {
    /** Same number as /my-adopters «Todos». */
    total: number;
    /**
     * Rows whose next move is the viewer's (needsViewer) — the same number as
     * the «Pendientes de revisar» section header. Form matches included (spec 2026-11-05).
     */
    pendingReview: number;
    /** The first of them (up to HOME_CARD_SLOTS), one row each, like Mis animales' due animals (option b). */
    pending: HomePendingItem[];
    /** General forms to evaluate (the team's), shown before `pending` (homeAdopterSlots). */
    requestsToEvaluate: number;
    /** The newest of them, up to HOME_CARD_SLOTS. */
    requests: HomeRequestItem[];
    /** Newest created first, as /my-adopters lists them. */
    recent: Array<HomePersonRow & {
        createdAt: number;
        viaForm: boolean;
        creatorIsSelf: boolean;
        creatorName: string | null;
        /** Only when the viewer is in 2+ groups — with one, it would repeat on every row. */
        groupName: string | null;
    }>;
};

/** One animal on the homepage card: photo, name and the line under it. */
export type HomeAnimalRow = {
    id: string;
    name: string | null;
    species: string | null;
    /** «macho» / «hembra» (or null): the offer row's «fue adoptada / adoptado». */
    sex: string | null;
    photo: string | null;
    /** Set when a check-up is due: the amber line. */
    due: { dueFollowups: number; dueTop: DueTop } | null;
    /** Where it is — the grey line when nothing is due, worded like /my-animals. */
    status: 'available' | 'foster' | 'adopted';
    /** The foster home or adopter, for «En tránsito con …» / «Adoptado por …». */
    personName: string | null;
    /** «N interesadas», for an available animal. */
    applicants: number;
    /** Applications still to evaluate: the amber «N solicitudes por evaluar» (when no check-up is due). */
    toEvaluate: number;
    /** Candidates to tell after the adoption closed them: «{animal} fue adoptada · avisá a N». 0 = none. */
    offer: number;
};

/**
 * A general form waiting to be evaluated, as a «Mis adoptantes» row (Jon 2026-11-13: a person, not an animal
 * row): «Formulario general · por evaluar», or «Pidió a … (ya adoptada/adoptado)» when it asked for an adopted animal.
 */
export type HomeRequestItem = { applicationId: string; adopterId: string | null; name: string; askedAnimal: { name: string; sex: string | null } | null };

export type HomeAnimalsData = {
    /** «Disponibles» tab count (available + in foster). */
    available: number;
    /** «Ya adoptados» tab count. */
    adopted: number;
    /** «Todos» tab count — «Ver los N animales». */
    total: number;
    /** «Con controles pendientes» tab count. */
    dueCount: number;
    /** Due animals not listed: «N animales más con controles pendientes» (homeAnimalRows). */
    moreDue: number;
    /** «Con solicitudes por evaluar» tab count: animals with applications to evaluate (general forms live in «Mis adoptantes»). */
    solicitudesCount: number;
    /** Application rows not listed: «N animales más con solicitudes» (homeAnimalRows). */
    moreApplications: number;
    /**
     * Up to 4 slots (an amber «N más» row takes one): the offers to tell, the animals with a
     * check-up due (most overdue first), the applications to evaluate, then the most recently
     * updated (homeAnimalRows).
     */
    rows: HomeAnimalRow[];
};

export type HomePostsData = {
    /** Same number as /my-adopters?filtro=posts. */
    people: number;
    /** When the team last brought in a post (epoch ms); the card shows only within the window. */
    lastPostAt: number | null;
    /** The people of the newest posts, newest first. */
    recent: Array<HomePersonRow & { at: number; sourceUrl: string }>;
};

export type HomeModulesData = {
    adopters: HomeSection<HomeAdoptersData>;
    /** null: ENABLE_ANIMALS_FOR_ADOPTION is off. */
    animals: HomeSection<HomeAnimalsData> | null;
    /** null: ENABLE_CONTENT_IMPORT is off. */
    posts: HomeSection<HomePostsData> | null;
};
