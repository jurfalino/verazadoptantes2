'use client';

import { useSyncExternalStore } from 'react';

/**
 * Is the viewport at least `px` wide (Tailwind's `md` is 768)? For the rare
 * piece that must be MOUNTED in one of two slots — never drawn twice and
 * CSS-hidden (a hidden copy would answer a `.first()` selector, and an id
 * must point at the visible one). The server and the first client render say
 * `false` (mobile first); a resize moves it.
 */
export function useMinWidth(px: number): boolean {
    const query = `(min-width: ${px}px)`;
    return useSyncExternalStore(
        (onChange) => {
            if (typeof window === 'undefined' || !window.matchMedia) return () => {};
            const mq = window.matchMedia(query);
            mq.addEventListener('change', onChange);
            return () => mq.removeEventListener('change', onChange);
        },
        () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches),
        () => false,
    );
}
