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

/** The homepage animals card lists at most this many animals. */
export const HOME_ANIMAL_ROWS = 3;

/**
 * The homepage animals card's rows: the animals that need you first (a
 * check-up due, most overdue first), then the most recently updated ones to
 * fill the card. `moreDue` = due animals that didn't fit — the «N animales
 * más con controles pendientes» link. `due` and `recent` arrive already
 * ordered; an animal never appears twice.
 */
export function homeAnimalRows<D extends { id: string }, R extends { id: string }>(
    due: readonly D[],
    recent: readonly R[],
    limit: number = HOME_ANIMAL_ROWS,
): { due: D[]; recent: R[]; moreDue: number } {
    const dueShown = due.slice(0, limit);
    const taken = new Set(dueShown.map(a => a.id));
    const recentShown: R[] = [];
    for (const a of recent) {
        if (dueShown.length + recentShown.length >= limit) break;
        if (taken.has(a.id)) continue;
        taken.add(a.id);
        recentShown.push(a);
    }
    return { due: dueShown, recent: recentShown, moreDue: due.length - dueShown.length };
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
