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
