import type { DueTop } from '@/lib/animalFollowupsDue';

/** One card's data, or the errorId of why it could not load (shown, never hidden). */
export type HomeSection<T> = { ok: true; data: T } | { ok: false; errorId: string };

export type HomePersonRow = {
    id: string;
    name: string | null;
    thumbnail: string | null;
    avgRating: number | null;
};

export type HomeAdoptersData = {
    /** Same number as /my-adopters «Todos». */
    total: number;
    /** Same number as the «Pendientes de revisar» section header — form matches included (spec 2026-11-05). */
    pendingReview: number;
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
    photo: string | null;
    /** Set when a check-up is due: the amber line. */
    due: { dueFollowups: number; dueTop: DueTop } | null;
    /** Where it is — the grey line when nothing is due, worded like /my-animals. */
    status: 'available' | 'foster' | 'adopted';
    /** The foster home or adopter, for «En tránsito con …» / «Adoptado por …». */
    personName: string | null;
    /** «N interesadas», for an available animal. */
    applicants: number;
};

export type HomeAnimalsData = {
    /** «Disponibles» tab count (available + in foster). */
    available: number;
    /** «Ya adoptados» tab count. */
    adopted: number;
    /** «Todos» tab count — «Ver los N animales». */
    total: number;
    /** «Con controles pendientes» tab count. */
    dueCount: number;
    /** Up to 3: the animals with a check-up due (most overdue first), then the most recently updated (homeAnimalRows). */
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
