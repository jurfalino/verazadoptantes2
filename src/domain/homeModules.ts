import { RECORD_TYPES } from './constants';

/**
 * The homepage modules (Mis adoptantes, Mis animales, Posts de redes):
 * which ones show as cards, in what order, and how many rows each lists.
 * Pure — the server action fetches, these decide.
 *
 * Design: .agents/plans/2026-11-04-home-modules.md
 */

export type HomeModuleKey = 'adopters' | 'animals' | 'posts';

/**
 * - `todo`: something waits on the rescuer (an amber row).
 * - `content`: has rows, nothing to do.
 * - `empty`: nothing yet — shown as a step of «Para empezar» / «También podés».
 * - `off`: the feature is off for this account; neither card nor step.
 */
export type HomeModuleState = 'todo' | 'content' | 'empty' | 'off';

/** Ties keep this order, so a card only moves when a to-do appears or is resolved. */
const MODULE_ORDER: readonly HomeModuleKey[] = ['adopters', 'animals', 'posts'];
const STATE_RANK: Record<Exclude<HomeModuleState, 'off'>, number> = { todo: 0, content: 1, empty: 2 };

/**
 * Cards with something to do first, then cards with content; empty modules
 * never become a card — they are the steps of the one «Para empezar» card.
 * `firstSteps` tells that card which title to use: «Para empezar» when
 * nothing has content yet, «También podés» otherwise.
 */
export function orderHomeModules(states: Record<HomeModuleKey, HomeModuleState>): {
    cards: HomeModuleKey[];
    steps: HomeModuleKey[];
    firstSteps: 'start' | 'more';
} {
    const live = MODULE_ORDER.filter(k => states[k] !== 'off');
    const cards = live
        .filter(k => states[k] !== 'empty')
        .sort((a, b) => STATE_RANK[states[a] as 'todo' | 'content'] - STATE_RANK[states[b] as 'todo' | 'content']
            || MODULE_ORDER.indexOf(a) - MODULE_ORDER.indexOf(b));
    const steps = live.filter(k => states[k] === 'empty');
    return { cards, steps, firstSteps: cards.length === 0 ? 'start' : 'more' };
}

/** A list shows at most 3 rows, 2 when amber rows sit above it. */
export function homeListLimit(hasTodoRows: boolean): number {
    return hasTodoRows ? 2 : 3;
}

/**
 * Amber follow-up rows: one per animal, at most 2. With 3 or more animals
 * the second row folds the rest into «N animales más con controles
 * pendientes» — `moreCount` is that N, 0 when every animal has its row.
 */
export function dueRowsShown<T>(dueAnimals: readonly T[]): { rows: T[]; moreCount: number } {
    if (dueAnimals.length <= 2) return { rows: [...dueAnimals], moreCount: 0 };
    return { rows: dueAnimals.slice(0, 1), moreCount: dueAnimals.length - 1 };
}

/**
 * A record that came from a social post: the observation the post importer
 * writes carries the post's link (both when it creates the profile and when
 * it adds to an existing one). Spreadsheet and contacts imports leave the
 * link empty; a form request stores `form:<id>`, not a link.
 */
export function isPostRecord(r: { recordType: string | null | undefined; sourceUrl: string | null | undefined }): boolean {
    return r.recordType === RECORD_TYPES.OBSERVATION && /^https?:\/\//i.test((r.sourceUrl || '').trim());
}

/**
 * The «Posts de redes» card shows only while the team brought in a post
 * within `windowDays` (HOME_POSTS_WINDOW_DAYS); otherwise «Importá un post»
 * is a step of «Para empezar» / «También podés».
 */
export function postsCardLive(lastPostAt: number | null, nowMs: number, windowDays: number): boolean {
    return lastPostAt != null && nowMs - lastPostAt <= windowDays * 24 * 60 * 60 * 1000;
}
