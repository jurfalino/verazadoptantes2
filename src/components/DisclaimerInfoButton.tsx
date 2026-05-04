'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

const InfoIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg
        className={className}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
    >
        <circle cx="10" cy="10" r="8" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 9.5v4M10 6.5h.01" />
    </svg>
);

/**
 * Small info-icon button rendered next to the rating. Clicking opens a centered
 * modal with the full legal disclaimer. Pairs with DisclaimerToast — that one
 * fires on first profile view; this one is the "find it again later" entry point.
 */
export function DisclaimerInfoButton() {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(true); }}
                aria-label={t('legal.disclaimer_aria') || 'Information disclaimer'}
                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            >
                <InfoIcon className="w-3.5 h-3.5" />
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'var(--overlay-bg)' }}
                    onClick={() => setOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('legal.disclaimer_aria') || 'Information disclaimer'}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4 border"
                        style={{
                            background: 'var(--status-info-bg)',
                            borderColor: 'var(--status-info-border)',
                            color: 'var(--text-primary)',
                        }}
                    >
                        <div className="flex items-start gap-3">
                            <InfoIcon className="w-6 h-6 shrink-0 mt-0.5" />
                            <p className="text-sm leading-relaxed">
                                {t('legal.disclaimer') || 'Information is provided by community users. BuenAdoptante does not verify its accuracy.'}
                            </p>
                        </div>
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
                                style={{
                                    background: 'var(--btn-primary-bg)',
                                    color: 'var(--btn-primary-text)',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--btn-primary-hover)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--btn-primary-bg)'; }}
                            >
                                {t('common.close') || 'Close'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
