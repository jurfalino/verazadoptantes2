'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

const STORAGE_KEY = 'disclaimerAcknowledged';

/**
 * One-time legal-disclaimer toast shown the first time a user opens an adopter profile
 * (or any page that mounts this component). Acknowledged via localStorage; never shown
 * again to that browser. The persistent ⓘ icon next to the rating provides a way to
 * re-discover the disclaimer after it's dismissed.
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
            // localStorage unavailable (private mode, SSR) — show the toast as a safe default
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
            className="rounded-xl p-4 shadow-sm flex items-start gap-3 border"
            style={{
                background: 'var(--status-info-bg)',
                borderColor: 'var(--status-info-border)',
                color: 'var(--text-primary)',
            }}
        >
            <span className="text-xl shrink-0 mt-0.5" aria-hidden="true">ℹ️</span>
            <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed">
                    {t('legal.disclaimer') || 'Information is provided by community users. BuenAdoptante does not verify its accuracy.'}
                </p>
                <div className="flex justify-end mt-3">
                    <button
                        type="button"
                        onClick={acknowledge}
                        className="px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors"
                        style={{
                            background: 'var(--btn-primary-bg)',
                            color: 'var(--btn-primary-text)',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--btn-primary-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--btn-primary-bg)'; }}
                    >
                        {t('legal.disclaimer_ack') || 'Got it'}
                    </button>
                </div>
            </div>
            <button
                type="button"
                onClick={acknowledge}
                aria-label={t('legal.disclaimer_dismiss') || 'Dismiss notice'}
                className="p-1 transition-colors shrink-0"
                style={{ color: 'var(--text-secondary)' }}
            >
                ✕
            </button>
        </div>
    );
}
