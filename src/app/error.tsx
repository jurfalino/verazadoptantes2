'use client';

import { useEffect, useState } from 'react';
import { extractErrorId } from '@/lib/errorUtils';
import { reportClientError } from '@/lib/clientErrorReporter';
import { isChunkLoadError } from '@/domain/clientErrors';
import { attemptStaleReload } from '@/lib/staleDeploy';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const [copied, setCopied] = useState(false);
    // Set once a reload has been requested. location.reload() does not stop
    // this component re-rendering, so this covers the window before the
    // navigation actually lands — usually imperceptible, but on a slow
    // connection it is the difference between a blank frame and an error
    // screen the user is about to be navigated away from anyway.
    const [recovering, setRecovering] = useState(false);
    // The id is generated once and never changes — it's what the user copies
    // and what the server uses when writing to Axiom, so they match by
    // construction (server-thrown errors that already carry an id keep it).
    const [errorId] = useState<string>(() =>
        extractErrorId(error) || error.digest?.slice(0, 8) || crypto.randomUUID().slice(0, 8)
    );

    useEffect(() => {
        // A chunk that vanished under us is a deploy artefact, not a failure
        // the user can act on: their tab predates the build now on the CDN.
        // Reload once and they carry on — Reintentar would only re-render the
        // same missing chunk. (errorId 7092aed7, 2026-09-10.)
        if (isChunkLoadError(error)) {
            if (attemptStaleReload()) {
                setRecovering(true);
                return;
            }
            console.error('[error boundary] ChunkLoadError persists after reload:', error.message);
        }

        // Already-logged server errors carry their id in the message — skip the POST.
        if (extractErrorId(error)) return;
        void reportClientError({
            errorId,
            message: error.message,
            stack: error.stack,
            source: 'boundary',
            digest: error.digest,
        });
    }, [error, errorId]);

    const handleCopy = () => {
        navigator.clipboard.writeText(errorId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (recovering) return null;

    return (
        <div className="min-h-[60vh] flex items-center justify-center px-4">
            <div className="max-w-md w-full text-center space-y-4">
                <div className="text-5xl">😿</div>
                <h2 className="text-xl font-extrabold text-stone-900">
                    Algo salió mal / Something went wrong
                </h2>
                <p className="text-stone-500 text-sm">
                    Si el problema persiste, envianos el código de error.
                    <br />
                    If the issue persists, send us the error code.
                </p>
                <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-2 font-mono text-xs px-3 py-1.5 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 transition-colors"
                >
                    {copied ? '✓ Copied' : '📋 Copy'} Error ID: {errorId}
                </button>
                <div className="pt-2">
                    <button
                        onClick={reset}
                        className="px-6 py-2.5 bg-teal-600 text-white rounded-xl font-semibold text-sm hover:bg-teal-700 transition-colors shadow-md"
                    >
                        Reintentar / Try Again
                    </button>
                </div>
            </div>
        </div>
    );
}
