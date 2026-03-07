'use client';

import { useEffect, useState } from 'react';
import { extractErrorId } from '@/lib/errorUtils';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const [copied, setCopied] = useState(false);
    const errorId = extractErrorId(error) || error.digest?.slice(0, 8) || crypto.randomUUID().slice(0, 8);

    useEffect(() => {
        console.error(`[PAGE ERROR] (ID: ${errorId})`, error);
    }, [error, errorId]);

    const handleCopy = () => {
        navigator.clipboard.writeText(errorId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

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
                        className="px-6 py-2.5 bg-teal-600 text-white rounded-xl font-bold text-sm hover:bg-teal-700 transition-colors shadow-md"
                    >
                        Reintentar / Try Again
                    </button>
                </div>
            </div>
        </div>
    );
}
