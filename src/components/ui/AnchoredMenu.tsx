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
 * takes the focus itself: its first enabled item once placed; Tab / Shift+Tab
 * out of it closes it, back on the button.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import { placeAnchoredPanel, type AnchoredPlacement } from '@/lib/anchoredPlacement';

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
        contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    }, [open, place]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        onClose();
        anchorRef.current?.focus();
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
                <div ref={contentRef} className="flex flex-col">{children}</div>
            </div>
        </>,
        document.body,
    );
}
