/**
 * Keyboard roving inside a menu (AnchoredMenu, review of audit A1): the
 * index of the item an arrow key moves the focus to, among the menu's enabled
 * items, or null when the key doesn't move it. ArrowDown / ArrowUp wrap,
 * Home / End jump to the ends; Tab is not a move (it closes the menu). Pure.
 */
export function rovingTarget(key: string, current: number, count: number): number | null {
    if (count <= 0) return null;
    switch (key) {
        case 'ArrowDown': return current < 0 ? 0 : (current + 1) % count;
        case 'ArrowUp': return current < 0 ? count - 1 : (current - 1 + count) % count;
        case 'Home': return 0;
        case 'End': return count - 1;
        default: return null;
    }
}
