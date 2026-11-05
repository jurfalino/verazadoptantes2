/**
 * The number in a /my-animals tab label ("Ya Adoptados (12)").
 *
 * The page holds one list at a time, fetched for `loadedView`. Only that tab
 * may show the list's length (it matches what is on screen, filters aside).
 * Every other tab — including the one just switched to, while its list is
 * still loading — shows its total from `/api/my-animals?counts=1`, or "..."
 * until that arrives.
 */
export type MyAnimalsTab = 'available' | 'adopted' | 'pendientes';

/** ?counts=1 — `pending` is the «Con controles pendientes» tab. */
export type MyAnimalsTabCounts = { available: number; adopted: number; pending: number };

const COUNT_KEY: Record<MyAnimalsTab, keyof MyAnimalsTabCounts> = { available: 'available', adopted: 'adopted', pendientes: 'pending' };

export function myAnimalsTabCount(
    tab: MyAnimalsTab,
    view: string,
    loadedView: string | null,
    listLength: number,
    counts: MyAnimalsTabCounts | null,
): number | string {
    if (tab === view && loadedView === view) return listLength;
    return counts?.[COUNT_KEY[tab]] ?? '...';
}
