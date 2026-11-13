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

/**
 * Mis adoptantes and Mis animales are built from the same parts so that, side
 * by side on desktop, they come out the same height (Jon 2026-11-09, option 1):
 * every card has HOME_CARD_SLOTS slots of one row each, and an amber row or
 * the «Importar desde tus contactos» link takes a slot like a row does.
 */
export const HOME_CARD_SLOTS = 4;

/**
 * Mis adoptantes' pending rows, the same way Mis animales lists its due
 * animals (Jon 2026-11-09, option b): every row waiting on the viewer is its
 * own row, up to the slots; with more than fit, one fewer is listed and the
 * «N más esperan tu respuesta» amber row takes the last slot. `more` counts
 * every pending row not listed (also any the feed couldn't build).
 */
/**
 * «Mis adoptantes» rows that wait on the viewer (Jon 2026-11-13): general forms to evaluate first, then the
 * «¿Es la misma persona?» items, within the card's slots. When they don't all fit, the last slot is one
 * «N más esperan tu respuesta» row (never one «más» row per kind).
 */
export function homeAdopterSlots(requests: number, pending: number, slots: number = HOME_CARD_SLOTS): { requests: number; pending: number; more: number } {
    const total = requests + pending;
    if (total <= slots) return { requests, pending, more: 0 };
    const room = slots - 1;
    const r = Math.min(requests, room);
    const p = Math.min(pending, room - r);
    return { requests: r, pending: p, more: total - r - p };
}

export function homePendingRows<T>(pending: readonly T[], total: number, slots: number = HOME_CARD_SLOTS): { shown: T[]; more: number } {
    const limit = total > slots ? slots - 1 : slots;
    const shown = pending.slice(0, Math.min(limit, total));
    return { shown, more: Math.max(0, total - shown.length) };
}

/** The id of the «Sin animal elegido» row (general applications): never an animal id. */
export const GENERAL_ROW_ID = 'general';

/**
 * The homepage animals card's rows. What waits on the rescuer comes first,
 * one row each: the offers to tell the other candidates, the animals with a
 * check-up due (most overdue first), the applications to evaluate (the
 * «Sin animal elegido» row, then animals by how many wait). An animal is
 * listed once, as its first kind (a check-up due wins over its applications —
 * spec «Calls I made»). When they fit, the most recently updated fill the
 * card. Otherwise one fewer is listed and an amber «N más» row takes the
 * slot — two fewer when both due animals and applications are left out
 * (each kind has its own «more» row: `moreDue`, `moreApplications`, counted by
 * membership in the input lists, so each equals what its tab lists beyond the
 * card). A hidden offer is never counted as «more»: it waits for a free slot.
 * Every list arrives already ordered.
 */
export function homeAnimalRows<O extends { id: string }, D extends { id: string }, A extends { id: string }, R extends { id: string }>(
    todo: { offers: readonly O[]; due: readonly D[]; applications: readonly A[] },
    recent: readonly R[],
    slots: number = HOME_CARD_SLOTS,
): { offers: O[]; due: D[]; applications: A[]; recent: R[]; moreDue: number; moreApplications: number } {
    type Item = { kind: 'offer'; row: O } | { kind: 'due'; row: D } | { kind: 'application'; row: A };
    const seen = new Set<string>();
    const items: Item[] = [];
    const add = (item: Item) => { if (!seen.has(item.row.id)) { seen.add(item.row.id); items.push(item); } };
    for (const row of todo.offers) add({ kind: 'offer', row });
    for (const row of todo.due) add({ kind: 'due', row });
    for (const row of todo.applications) add({ kind: 'application', row });

    // «More» counts what each tab lists that the card doesn't show, by membership in the ORIGINAL
    // lists: an animal both due and with applications, hidden, is one more in both tabs (the
    // dedup above only decides how a SHOWN animal reads).
    const hiddenOf = (list: readonly { id: string }[], shownIds: ReadonlySet<string>) => list.filter(x => !shownIds.has(x.id)).length;
    const idsOf = (n: number) => new Set(items.slice(0, n).map(i => i.row.id));
    let n = slots;
    if (items.length > slots) {
        n = slots - 1;
        const ids = idsOf(n);
        if (hiddenOf(todo.due, ids) > 0 && hiddenOf(todo.applications, ids) > 0) n = slots - 2;
    }
    const shown = items.slice(0, n);
    const shownIds = idsOf(n);

    const recentShown: R[] = [];
    if (items.length <= slots) {
        for (const a of recent) {
            if (shown.length + recentShown.length >= slots) break;
            if (seen.has(a.id)) continue;
            seen.add(a.id);
            recentShown.push(a);
        }
    }
    const of = <K extends Item['kind']>(kind: K) => shown.flatMap(i => (i.kind === kind ? [i.row as Extract<Item, { kind: K }>['row']] : []));
    return {
        offers: of('offer'),
        due: of('due'),
        applications: of('application'),
        recent: recentShown,
        moreDue: hiddenOf(todo.due, shownIds),
        moreApplications: hiddenOf(todo.applications, shownIds),
    };
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
