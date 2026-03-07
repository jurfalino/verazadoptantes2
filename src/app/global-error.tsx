'use client';

import { useEffect } from 'react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const errorId = error.digest?.slice(0, 8) || crypto.randomUUID().slice(0, 8);

    useEffect(() => {
        console.error(`[GLOBAL ERROR] (ID: ${errorId})`, error);
    }, [error, errorId]);

    return (
        <html>
            <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                <div style={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#fafaf9',
                    padding: '1rem',
                }}>
                    <div style={{
                        maxWidth: '400px',
                        textAlign: 'center',
                        padding: '2rem',
                    }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1c1917', marginBottom: '0.5rem' }}>
                            Something went wrong
                        </h1>
                        <p style={{ color: '#78716c', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                            An unexpected error occurred. Please try again.
                        </p>
                        <p style={{
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                            color: '#a8a29e',
                            background: '#f5f5f4',
                            padding: '0.5rem 1rem',
                            borderRadius: '0.5rem',
                            marginBottom: '1.5rem',
                        }}>
                            Error ID: {errorId}
                        </p>
                        <button
                            onClick={reset}
                            style={{
                                background: '#0d9488',
                                color: 'white',
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
