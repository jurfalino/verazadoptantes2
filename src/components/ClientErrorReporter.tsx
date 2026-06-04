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

            // Deploy-churn recovery (v2.16.0-45). webpack's lazy-load
            // runtime references content-hashed chunk filenames. If the
            // user loaded the page on an older deploy and we've since
            // shipped a new build (chunks rewritten with new hashes,
            // old ones GC'd from the Pages CDN), the next dynamic
            // import inside the running SPA 404s and webpack throws
            // ChunkLoadError. The standard fix: detect and force-
            // reload — fresh HTML has fresh chunk references.
            // Reload at most once per session (sessionStorage guard)
            // to avoid loops if the new deploy is also broken.
            const errName = event.error?.name || '';
            const isChunkLoadError = errName === 'ChunkLoadError'
                || /Loading (CSS )?chunk \d+ failed/.test(message);
            if (isChunkLoadError) {
                const RELOAD_GUARD = 'buenadoptante.chunk_reload_attempted';
                if (!sessionStorage.getItem(RELOAD_GUARD)) {
                    sessionStorage.setItem(RELOAD_GUARD, '1');
                    console.warn('[ClientErrorReporter] ChunkLoadError — forcing reload to pick up fresh chunk hashes:', message);
                    window.location.reload();
                    return;
                }
                // Already reloaded once in this session and the same
                // error fires again — surface a clear hint instead of
                // the generic toast so the user knows what to try.
                console.error('[ClientErrorReporter] ChunkLoadError persists after reload:', message);
                toast.error(
                    'Recargá la app',
                    'Hubo una actualización mientras usabas la app. Cerrá y volvé a abrir.',
                );
                return;
            }

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

            // Same ChunkLoadError auto-reload path as the window-error
            // handler above (v2.16.0-45). Next.js's dynamic import can
            // surface chunk failures as a rejected promise rather than
            // an error event, so we need the recovery here too.
            const errName = reason instanceof Error ? reason.name : '';
            const isChunkLoadError = errName === 'ChunkLoadError'
                || /Loading (CSS )?chunk \d+ failed/.test(message);
            if (isChunkLoadError) {
                const RELOAD_GUARD = 'buenadoptante.chunk_reload_attempted';
                if (!sessionStorage.getItem(RELOAD_GUARD)) {
                    sessionStorage.setItem(RELOAD_GUARD, '1');
                    console.warn('[ClientErrorReporter] ChunkLoadError (rejection) — forcing reload:', message);
                    window.location.reload();
                    return;
                }
                console.error('[ClientErrorReporter] ChunkLoadError (rejection) persists after reload:', message);
                toast.error(
                    'Recargá la app',
                    'Hubo una actualización mientras usabas la app. Cerrá y volvé a abrir.',
                );
                return;
            }

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
