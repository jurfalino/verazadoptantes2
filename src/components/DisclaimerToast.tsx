'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

const STORAGE_KEY = 'disclaimerAcknowledged';

/**
 * One-time legal-disclaimer notice shown the first time a user opens an adopter
 * profile (or any page that mounts this component). Acknowledged via localStorage;
 * never shown again to that browser.
 *
 * Compact strip layout (v2.12.1-36): info icon + text + close, single row, low
 * visual weight. Long-term reference for the disclaimer text lives at /terms,
 * linked from the homepage footer — no per-profile re-discovery affordance is
 * needed (the previous DisclaimerInfoButton ⓘ was redundant and was removed in
 * v2.12.1-37).
 */
export function DisclaimerToast() {
    const { t } = useLanguage();
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        try {
            if (localStorage.getItem(STORAGE_KEY) !== 'true') {
                setVisible(true);
            }
        } catch {
            // localStorage unavailable (private mode, SSR) — show as a safe default
            setVisible(true);
        }
    }, []);

    if (!visible) return null;

    const acknowledge = () => {
        try {
            localStorage.setItem(STORAGE_KEY, 'true');
        } catch { /* ignore */ }
        setVisible(false);
    };

    return (
        <div
            role="status"
            aria-live="polite"
            aria-label={t('legal.disclaimer_aria') || 'Information disclaimer'}
            className="rounded-lg border px-3 py-2 flex items-center gap-2.5"
            style={{
                background: 'var(--status-info-bg)',
                borderColor: 'var(--status-info-border)',
                color: 'var(--text-secondary)',
            }}
        >
            <svg
                className="w-4 h-4 shrink-0"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
            >
                <circle cx="10" cy="10" r="8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9.5v4M10 6.5h.01" />
            </svg>
            <p className="flex-1 text-xs leading-snug">
                {t('legal.disclaimer') || 'Information is provided by community users. BuenAdoptante does not verify its accuracy.'}
            </p>
            <button
                type="button"
                onClick={acknowledge}
                aria-label={t('legal.disclaimer_dismiss') || 'Dismiss notice'}
                className="shrink-0 p-1 rounded-md hover:opacity-70 transition-opacity"
            >
                <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" d="M6 6l8 8M14 6l-8 8" />
                </svg>
            </button>
        </div>
    );
}
