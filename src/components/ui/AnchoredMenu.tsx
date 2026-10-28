'use client';

/**
 * A small menu opened from a button (a household row's «⋯», «¿En qué hogar?»):
 * rendered on <body> with fixed coordinates next to the button, so no
 * ancestor's stacking context can put a later card on top of it — the last
 * member's «Eliminar perfil» / «Pedir eliminación» used to open UNDER the
 * «¿Qué pasó con …?» card and the tap landed on «Otro motivo» (audit
 * 2026-10-28, A1). The same reason ConfirmDialog and the bell's sheet portal.
 *
 * Placement is placeAnchoredPanel: below the button, or above it when the
 * screen has no room below, 16px from the edges, never under the sticky nav.
 * It is measured again whenever the panel's content changes size (an item
 * that appears after a check, e.g. the delete row once checkAdopterDeletable
 * answers) and follows the button on scroll and resize.
 *
 * Closes on a tap outside (a transparent backdrop) and on Escape, giving the
 * focus back to the button (useEscapeToClose) — one behaviour for every menu.
 * On <body> the panel is no longer next to its button in the tab order, so it
 * takes the focus itself: its first enabled item once placed; ArrowDown /
 * ArrowUp (wrapping), Home and End move between the enabled items (rovingTarget);
 * Tab / Shift+Tab out of it closes it, back on the button.
 */
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import { placeAnchoredPanel, type AnchoredPlacement } from '@/lib/anchoredPlacement';
import { rovingTarget } from '@/lib/menuRovingFocus';

const ENABLED_ITEM = '[role="menuitem"]:not(:disabled)';

// useLayoutEffect warns on the server; the menu only ever opens on the client.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function AnchoredMenu({ open, anchorRef, onClose, align = 'right', role = 'menu', ariaLabel, testId, className = 'w-64', children }: {
    open: boolean;
    anchorRef: RefObject<HTMLElement | null>;
    onClose: () => void;
    /** Which edge of the button the panel lines up with. */
    align?: 'left' | 'right';
    role?: 'menu' | 'dialog' | 'listbox';
    ariaLabel?: string;
    testId?: string;
    /** Width (and any extra classes) of the panel. */
    className?: string;
    children: ReactNode;
}) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    const contentRef = useRef<HTMLDivElement>(null);
    const [place, setPlace] = useState<AnchoredPlacement | null>(null);
    useEscapeToClose(open, onClose, anchorRef);

    const measure = useCallback(() => {
        const anchor = anchorRef.current;
        const content = contentRef.current;
        if (!anchor || !content) return;
        const r = anchor.getBoundingClientRect();
        // The content's natural size (the panel itself may be height-capped).
        const panel = { width: content.offsetWidth + 2, height: content.offsetHeight + 2 /* 1px border each side */ };
        setPlace(placeAnchoredPanel({
            anchor: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
            panel,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            align,
        }));
    }, [anchorRef, align]);

    useIsoLayoutEffect(() => {
        if (!open || !mounted) { setPlace(null); return; }
        measure();
        const content = contentRef.current;
        const ro = typeof ResizeObserver !== 'undefined' && content ? new ResizeObserver(() => measure()) : null;
        if (ro && content) ro.observe(content);
        // Capture: a scroll inside any container moves the button too.
        window.addEventListener('scroll', measure, true);
        window.addEventListener('resize', measure);
        return () => {
            ro?.disconnect();
            window.removeEventListener('scroll', measure, true);
            window.removeEventListener('resize', measure);
        };
    }, [open, mounted, measure]);

    // Keyboard: the first enabled item takes the focus once the panel is placed (once per opening).
    const focused = useRef(false);
    useEffect(() => {
        if (!open) { focused.current = false; return; }
        if (!place || focused.current) return;
        focused.current = true;
        contentRef.current?.querySelector<HTMLElement>(ENABLED_ITEM)?.focus({ preventScroll: true });
    }, [open, place]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            onClose();
            anchorRef.current?.focus();
            return;
        }
        // Roving focus over the enabled items, read at the keypress: an item can
        // turn enabled after the panel opened (the delete row once its check answers).
        const items = Array.from(contentRef.current?.querySelectorAll<HTMLElement>(ENABLED_ITEM) ?? []);
        const next = rovingTarget(e.key, items.indexOf(document.activeElement as HTMLElement), items.length);
        if (next === null) return;
        e.preventDefault();
        items[next].focus();
    };

    if (!open || !mounted) return null;
    const above = place?.placement === 'above';
    return createPortal(
        <>
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} data-testid={testId ? `${testId}-backdrop` : undefined} />
            <div
                role={role}
                aria-label={ariaLabel}
                data-testid={testId}
                data-placement={place?.placement}
                onKeyDown={onKeyDown}
                className={`fixed z-50 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-stone-200 overflow-x-hidden overflow-y-auto animate-in fade-in duration-150 ${above ? 'slide-in-from-bottom-2' : 'slide-in-from-top-2'} ${className}`}
                style={{
                    top: place?.top ?? 0,
                    left: place?.left ?? 0,
                    maxHeight: place?.maxHeight ?? undefined,
                    // Transparent (not visibility:hidden, which keeps its items unfocusable for the
                    // keyboard) for the one frame before it is measured: no flash in the corner.
                    opacity: place ? undefined : 0,
                }}
            >
                <div ref={contentRef} className="flex flex-col divide-y divide-stone-100">{children}</div>
            </div>
        </>,
        document.body,
    );
}

/**
 * One item of an AnchoredMenu (audit B3): a 20px lucide icon (teal; rose on a
 * destructive item), a 14px/600 title and an optional 12px line under it,
 * 44px+ tall. The profile header's «⋯» and a household row's «⋯» both use it,
 * so the same menu reads the same everywhere. `href` renders a link.
 */
export function AnchoredMenuItem({ icon: Icon, title, desc, danger = false, disabled = false, onClick, href, testId }: {
    icon: LucideIcon;
    title: ReactNode;
    desc?: ReactNode;
    danger?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    href?: string;
    testId?: string;
}) {
    const cls = 'w-full flex items-start gap-3 px-4 py-3 min-h-[44px] hover:bg-stone-50 transition-colors text-left disabled:cursor-wait';
    const body = (
        <>
            <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${danger ? 'text-rose-700' : disabled ? 'text-stone-400' : 'text-teal-700'}`} strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0">
                <span className={`block text-sm font-semibold ${danger ? 'text-rose-700' : disabled ? 'text-stone-500' : 'text-stone-900'}`}>{title}</span>
                {desc && <span className="block text-xs text-stone-500 mt-0.5">{desc}</span>}
            </span>
        </>
    );
    return href
        ? <a href={href} role="menuitem" onClick={onClick} data-testid={testId} className={cls}>{body}</a>
        : <button type="button" role="menuitem" disabled={disabled} onClick={onClick} data-testid={testId} className={cls}>{body}</button>;
}

/**
 * The «⋯» that opens an AnchoredMenu: a 44px tap area around the small chip
 * (the profile header and every household row — audit B3/B9).
 */
export const OverflowMenuButton = forwardRef<HTMLButtonElement, { open: boolean; onClick: () => void; label: string; testId?: string; title?: string }>(
    function OverflowMenuButton({ open, onClick, label, testId, title }, ref) {
        return (
            <button ref={ref} type="button" onClick={onClick} aria-label={label} title={title} aria-haspopup="menu" aria-expanded={open} data-testid={testId}
                className="group inline-flex min-w-[44px] min-h-[44px] items-center justify-center text-stone-500 hover:text-stone-600">
                <span className="flex items-center p-1.5 rounded-lg bg-stone-50 group-hover:bg-stone-100 transition-all duration-150">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                </span>
            </button>
        );
    },
);
