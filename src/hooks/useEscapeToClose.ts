'use client';

import { useEffect, type RefObject } from 'react';
import { claimEscape } from '@/lib/dialogFocus';

/**
 * A small menu (the profile's ⋯, a household row's ⋯, «¿En qué hogar?») closes
 * on Escape and gives the focus back to the button that opened it — one
 * behaviour for every such menu on the profile.
 *
 * Inside a Modal, one Escape closes only the menu: the listener is in the
 * CAPTURE phase and marks the event handled (`claimEscape`), so the Modal's
 * bubbling document listener sees `defaultPrevented` and stays open.
 */
export function useEscapeToClose(open: boolean, close: () => void, returnFocusTo: RefObject<HTMLElement | null>) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (!claimEscape(e)) return;
            close();
            returnFocusTo.current?.focus();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [open, close, returnFocusTo]);
}
