'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A step's action row that stays pinned to the bottom of the screen on phones.
 *
 * Wizard steps carry long post text, photo grids and review fields, and on a
 * phone their buttons scrolled away under them (Jon, 2026-10-21). Below `md` the
 * row is `sticky bottom-0` inside its card — it rides the bottom edge while the
 * card is on screen and settles into place at the card's end. From `md` up it is
 * an ordinary row.
 *
 * The SAME buttons are pinned, not a second copy: `FormResultsContent` renders
 * its CTA twice (inline + fixed), which breaks `.first()` e2e selectors.
 *
 * Expects to sit as the last child of a card padded `p-6` (it bleeds to the
 * card's edges). Publishes its height as `--bottom-actions-h` while pinned, so
 * the floating chat bubble can sit above it.
 */
export default function StickyActions({ children, className = '' }: { children: ReactNode; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const root = document.documentElement;
        const el = ref.current;
        const mq = window.matchMedia('(min-width: 768px)');
        if (!el) return;
        const publish = () => root.style.setProperty('--bottom-actions-h', mq.matches ? '0px' : `${Math.round(el.getBoundingClientRect().height)}px`);
        publish();
        const ro = new ResizeObserver(publish);
        ro.observe(el);
        mq.addEventListener('change', publish);
        return () => {
            ro.disconnect();
            mq.removeEventListener('change', publish);
            root.style.setProperty('--bottom-actions-h', '0px');
        };
    }, []);

    return (
        <div
            ref={ref}
            data-testid="import-actions"
            className={
                'sticky bottom-0 z-10 -mx-6 -mb-6 px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] rounded-b-2xl ' +
                'border-t shadow-[0_-4px_12px_rgba(0,0,0,0.06)] ' +
                'md:static md:mx-0 md:mb-0 md:px-0 md:pt-2 md:pb-0 md:border-t-0 md:shadow-none md:rounded-none md:!bg-transparent ' +
                className
            }
            // --surface-card, not bg-white/95: an opacity variant has no [data-theme]
            // remap and renders a white slab in Azul Noche (same note as FormResultsContent).
            style={{ background: 'var(--surface-card)', borderColor: 'var(--border-default)' }}
        >
            {children}
        </div>
    );
}
