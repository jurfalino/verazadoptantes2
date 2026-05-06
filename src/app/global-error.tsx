'use client';

import { useEffect, useState } from 'react';
import { extractErrorId } from '@/lib/errorUtils';
import { reportClientError } from '@/lib/clientErrorReporter';

type Palette = {
    pageBg: string;
    cardBg: string;
    textPrimary: string;
    textSecondary: string;
    codeText: string;
    codeBg: string;
    btnBg: string;
    btnText: string;
};

const PALETTES: Record<'light' | 'dark', Palette> = {
    light: {
        pageBg: '#fafaf9',
        cardBg: '#ffffff',
        textPrimary: '#1c1917',
        textSecondary: '#78716c',
        codeText: '#a8a29e',
        codeBg: '#f5f5f4',
        btnBg: '#0d9488',
        btnText: '#ffffff',
    },
    dark: {
        pageBg: '#0a1628',
        cardBg: '#1e293b',
        textPrimary: '#e0e7ff',
        textSecondary: '#94a3b8',
        codeText: '#64748b',
        codeBg: '#0f172a',
        btnBg: '#14b8a6',
        btnText: '#ffffff',
    },
};

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    // Generated once; the same id is sent to /api/log-client-error and stored
    // in Axiom, so what the user copies is exactly what an admin can look up.
    const [errorId] = useState<string>(() =>
        extractErrorId(error) || error.digest?.slice(0, 8) || crypto.randomUUID().slice(0, 8)
    );
    const [palette, setPalette] = useState(PALETTES.light);

    useEffect(() => {
        try {
            const stored = localStorage.getItem('theme');
            if (stored === 'dark') setPalette(PALETTES.dark);
        } catch { /* localStorage unavailable */ }

        if (extractErrorId(error)) return;
        void reportClientError({
            errorId,
            message: error.message,
            stack: error.stack,
            source: 'global-error',
            digest: error.digest,
        });
    }, [error, errorId]);

    return (
        <html>
            <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                <div style={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: palette.pageBg,
                    padding: '1rem',
                }}>
                    <div style={{
                        maxWidth: '400px',
                        textAlign: 'center',
                        padding: '2rem',
                        background: palette.cardBg,
                        borderRadius: '1rem',
                    }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: palette.textPrimary, marginBottom: '0.5rem' }}>
                            Something went wrong
                        </h1>
                        <p style={{ color: palette.textSecondary, fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                            An unexpected error occurred. Please try again.
                        </p>
                        <p style={{
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                            color: palette.codeText,
                            background: palette.codeBg,
                            padding: '0.5rem 1rem',
                            borderRadius: '0.5rem',
                            marginBottom: '1.5rem',
                        }}>
                            Error ID: {errorId}
                        </p>
                        <button
                            onClick={reset}
                            style={{
                                background: palette.btnBg,
                                color: palette.btnText,
                                border: 'none',
                                padding: '0.75rem 2rem',
                                borderRadius: '0.75rem',
                                fontWeight: 700,
                                fontSize: '0.875rem',
                                cursor: 'pointer',
                            }}
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
