'use client';

import { useEffect, type RefObject } from 'react';

/**
 * A small menu (the profile's ⋯, a household row's ⋯, «¿En qué hogar?») closes
 * on Escape and gives the focus back to the button that opened it — one
 * behaviour for every such menu on the profile.
 */
export function useEscapeToClose(open: boolean, close: () => void, returnFocusTo: RefObject<HTMLElement | null>) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            close();
            returnFocusTo.current?.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, close, returnFocusTo]);
}
