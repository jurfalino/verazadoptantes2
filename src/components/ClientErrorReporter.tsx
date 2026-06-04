'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/clientErrorReporter';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';

/**
 * Mounted once at the root. Captures uncaught errors and unhandled
 * promise rejections that bypass React's error boundaries, ships them
 * to Axiom via /api/log-client-error, and surfaces the returned errorId
 * to the user via toast so they can report it.
 *
 * Skips events that already carry an embedded "Error ID:" — those came
 * from a server action that already logged with that exact id.
 */
export default function ClientErrorReporter() {
    const toast = useShowToast();

    useEffect(() => {
        const handleError = (event: ErrorEvent) => {
            const message = event.message || event.error?.message || 'Unknown error';
            const existingId = extractErrorId(event.error || message);
            if (existingId) return; // server action already logged this

            const stack = event.error instanceof Error ? event.error.stack : undefined;
            const errorId = crypto.randomUUID().slice(0, 8);
            // Show the toast immediately with the id the user can report; the
            // POST writes Axiom under that exact id.
            toast.error('Algo salió mal', 'Se registró el error.', errorId);
            void reportClientError({
                errorId,
                message,
                stack,
                source: 'window-error',
                extra: {
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                },
            });
        };

        const handleRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const message = reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection');
            const existingId = extractErrorId(reason);
            if (existingId) return;

            const stack = reason instanceof Error ? reason.stack : undefined;

            // Suppress noisy background browser-platform rejections that
            // aren't actionable for the user. Observed in the wild:
            //  - Service-Worker registration races (ours: layout.tsx inline
            //    script; browser-internal: Chrome's Contact Picker API on
            //    Android triggers an internal serviceWorker.register call
            //    while the user types in the picker's search box, and that
            //    rejection bubbles to our unhandledrejection handler).
            //  - Aborted fetches (AbortController in our search debounce
            //    paths) — already silent in the originating code but a
            //    racy unmount sometimes leaks them here.
            // The console.warn keeps the signal for devtools without
            // toasting the user about something they can't act on.
            const suppressPatterns = [
                'serviceWorker.register',
                'ServiceWorker',
                'AbortError',
            ];
            const haystack = `${message}\n${stack ?? ''}`;
            if (suppressPatterns.some(p => haystack.includes(p))) {
                console.warn('[ClientErrorReporter] suppressed background rejection:', reason);
                return;
            }

            const errorId = crypto.randomUUID().slice(0, 8);
            toast.error('Algo salió mal', 'Se registró el error.', errorId);
            void reportClientError({
                errorId,
                message,
                stack,
                source: 'unhandled-rejection',
            });
        };

        window.addEventListener('error', handleError);
        window.addEventListener('unhandledrejection', handleRejection);
        return () => {
            window.removeEventListener('error', handleError);
            window.removeEventListener('unhandledrejection', handleRejection);
        };
    }, [toast]);

    return null;
}
