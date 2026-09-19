'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/clientErrorReporter';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { classifyWindowError, isChunkLoadError, isDeploymentSkewError } from '@/domain/clientErrors';
import { markDeploymentStale } from '@/lib/staleDeploy';
import { attemptStaleReload } from '@/lib/staleDeploy';

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

            // Which branch this belongs in is decided in one tested place —
            // the ORDER is the part that has twice shown a user a code for
            // something they could not act on. See src/domain/clientErrors.ts.
            const kind = classifyWindowError({
                message,
                name: event.error?.name,
                stack,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
            });

            // Deploy-churn recovery (v2.16.0-45): a tab open across a deploy
            // 404s on its next lazy chunk. Detection and the one-shot reload
            // both live in shared modules now, because the React error
            // boundaries need exactly the same recovery — see
            // src/lib/staleDeploy.ts.
            // A stale tab's rejection that no catch block handled. Not an error
            // to report or toast: StaleDeployWatcher offers the reload.
            if (kind === 'skew') {
                markDeploymentStale();
                return;
            }

            if (kind === 'chunk') {
                if (attemptStaleReload()) {
                    console.warn('[ClientErrorReporter] ChunkLoadError — reloading to pick up fresh chunk hashes:', message);
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

            // React hydration mismatches arrive here because React 19's default
            // onRecoverableError calls reportError(), which fires a window
            // 'error' event — but React has already re-rendered the subtree and
            // the page is fine. Log them (they're real defects) without
            // alarming the user, who has nothing to act on. See
            // src/domain/clientErrors.ts and errorId 43d67f9e.
            if (kind === 'hydration') {
                console.warn('[ClientErrorReporter] recovered hydration mismatch:', message);
                void reportClientError({
                    message,
                    stack,
                    source: 'window-error',
                    level: 'warn',
                    extra: {
                        filename: event.filename,
                        lineno: event.lineno,
                        colno: event.colno,
                    },
                });
                return;
            }

            // A cross-origin script threw and the browser withheld every
            // detail. Almost always a third-party tag on a page that is
            // working fine — that is how errorId b1f16983 showed a red toast
            // to a visitor in the Instagram in-app browser on 2026-09-17.
            // Same treatment as a recovered hydration mismatch: keep it in
            // Axiom at warn, don't alarm someone who has nothing to act on.
            if (kind === 'opaque') {
                console.warn('[ClientErrorReporter] opaque cross-origin script error:', message);
                void reportClientError({
                    message,
                    source: 'window-error',
                    level: 'warn',
                    extra: {
                        filename: event.filename,
                        lineno: event.lineno,
                        colno: event.colno,
                    },
                });
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

            // An uncaught stale-tab rejection (a server call whose promise nobody
            // awaited in a try) — hand over to StaleDeployWatcher, no toast.
            if (isDeploymentSkewError(reason)) {
                markDeploymentStale();
                return;
            }

            // Same ChunkLoadError recovery as the window-error handler above:
            // Next.js's dynamic import can surface chunk failures as a
            // rejected promise rather than an error event.
            if (isChunkLoadError({
                name: reason instanceof Error ? reason.name : undefined,
                message,
                stack,
            })) {
                if (attemptStaleReload()) {
                    console.warn('[ClientErrorReporter] ChunkLoadError (rejection) — reloading:', message);
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
