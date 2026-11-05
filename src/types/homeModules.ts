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
    /** Same number as the «Pendientes de revisar» section header. */
    pendingReview: number;
    /** People with a «Por revisar» pill in /my-adopters?filtro=formularios. */
    formsToReview: number;
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

export type HomeAnimalsData = {
    /** «Disponibles» tab count (available + in foster). */
    available: number;
    /** «Ya adoptados» tab count. */
    adopted: number;
    /** «Con controles pendientes»: one entry per animal, most overdue first. */
    due: Array<{ id: string; name: string | null; dueFollowups: number; dueTop: DueTop }>;
    /** The newest «Disponibles» animals (up to 3). */
    listed: Array<{
        id: string;
        name: string | null;
        species: string | null;
        photo: string | null;
        fosterName: string | null;
        applicants: number;
    }>;
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
    firstStepsHidden: boolean;
};
