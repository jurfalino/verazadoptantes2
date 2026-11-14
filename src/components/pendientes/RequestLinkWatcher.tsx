'use client';

/**
 * A request's link followed while already on «Mis adoptantes» (review I-2): the bell and other in-app links
 * `router.push('/my-adopters?solicitud=…')` onto the same page, which neither remounts «Pendientes de revisar»
 * nor fires `hashchange`. This watches `?solicitud=` and tells the section (REQUEST_LINK_EVENT) when it changes
 * after the first render — the first one is read by the section's own first load. Its own tiny Suspense
 * boundary (useSearchParams), so the page itself never needs one.
 */
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

export const REQUEST_LINK_EVENT = 'pendientes:solicitud';

export default function RequestLinkWatcher() {
    const id = useSearchParams().get('solicitud');
    const first = useRef(true);
    useEffect(() => {
        if (first.current) { first.current = false; return; }
        if (id) window.dispatchEvent(new CustomEvent<string>(REQUEST_LINK_EVENT, { detail: id }));
    }, [id]);
    return null;
}
