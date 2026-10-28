/**
 * Focus rules for the one dialog shell (components/ui/Modal — fix round 2, item 8).
 *
 * - Tab stays inside the topmost open dialog (`aria-modal` promises it):
 *   `tabTrapTarget` says where Tab / Shift+Tab goes from the focused element.
 * - Only the topmost dialog answers Escape and Tab (`openDialogs`): a dialog
 *   opened from another dialog closes on its own.
 * - Closing gives the focus back to what opened the dialog. A dialog opened
 *   from a ⋯ menu item (AnchoredMenu) can't go back to the item — the menu
 *   is gone — so it goes back to the menu's ⋯ button (`noteMenuAnchor`).
 */

/**
 * What Tab can land on inside a dialog. Every selector excludes `tabindex="-1"`:
 * an element taken out of the tab order on purpose (a menu's roving items, a
 * scroll container) is never a stop of the trap, whatever its tag.
 */
export const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]',
].map(sel => `${sel}:not([tabindex="-1"])`).join(', ');

/**
 * What the dialog does with a keypress: close it (Escape, unless busy), keep
 * Tab inside it ('tab'), or nothing. Nothing when the key was already handled
 * (`defaultPrevented`) — a menu or a picker inside the dialog that answers
 * Escape / Tab itself must not also close or trap the dialog — and nothing
 * unless this dialog is the topmost one.
 */
export function modalKeyAction(
    e: { key: string; defaultPrevented: boolean },
    dialog: { isTop: boolean; busy: boolean },
): 'close' | 'tab' | null {
    if (e.defaultPrevented) return null;
    if (!dialog.isTop) return null;
    if (e.key === 'Escape') return dialog.busy ? null : 'close';
    if (e.key === 'Tab') return 'tab';
    return null;
}

/** Where Tab (or Shift+Tab) moves the focus, or null to let the browser move it. */
export function tabTrapTarget<T>(focusables: readonly T[], active: T | null, shift: boolean): T | null {
    if (focusables.length === 0) return null;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const at = active == null ? -1 : focusables.indexOf(active);
    if (at === -1) return shift ? last : first;
    if (shift && at === 0) return last;
    if (!shift && at === focusables.length - 1) return first;
    return null;
}

const stack: symbol[] = [];
export const openDialogs = {
    push(id: symbol) { stack.push(id); },
    remove(id: symbol) { const i = stack.lastIndexOf(id); if (i !== -1) stack.splice(i, 1); },
    isTop(id: symbol) { return stack[stack.length - 1] === id; },
};

let menuAnchor: { el: HTMLElement; at: number } | null = null;
/** An AnchoredMenu item was chosen: a dialog it opens returns the focus to this ⋯ button. */
export function noteMenuAnchor(el: HTMLElement | null) { menuAnchor = el ? { el, at: Date.now() } : null; }

const usable = (el: Element | null | undefined): el is HTMLElement =>
    !!el && el instanceof HTMLElement && el.isConnected && el !== document.body;

/**
 * Whom a dialog gives the focus back to, decided as it opens: what had the focus
 * (`active`, read before the dialog took it) if it is still on the page; else —
 * a ⋯ menu item that closed with its menu — the ⋯ chosen from just now. The
 * noted ⋯ is used once, and only right after its item was chosen.
 */
export function dialogOpener(active: Element | null): HTMLElement | null {
    const noted = menuAnchor && Date.now() - menuAnchor.at < 2000 ? menuAnchor.el : null;
    menuAnchor = null;
    if (usable(active)) return active;
    return usable(noted) ? noted : null;
}

/** On close: the opener, if it is still on the page. */
export function returnFocusTarget(opener: HTMLElement | null): HTMLElement | null {
    return usable(opener) ? opener : null;
}
