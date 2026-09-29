/**
 * The number in a /my-animals tab label ("Ya Adoptados (12)").
 *
 * The page holds one list at a time, fetched for `loadedView`. Only that tab
 * may show the list's length (it matches what is on screen, filters aside).
 * Every other tab — including the one just switched to, while its list is
 * still loading — shows its total from `/api/my-animals?counts=1`, or "..."
 * until that arrives.
 */
export type MyAnimalsTab = 'available' | 'adopted';

export function myAnimalsTabCount(
    tab: MyAnimalsTab,
    view: string,
    loadedView: string | null,
    listLength: number,
    counts: { available: number; adopted: number } | null,
): number | string {
    if (tab === view && loadedView === view) return listLength;
    return counts?.[tab] ?? '...';
}
