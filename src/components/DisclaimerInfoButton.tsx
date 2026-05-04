'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Small ⓘ icon button rendered next to the rating. Clicking opens a centered
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
                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-stone-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            >
                <span aria-hidden="true" className="text-sm">ⓘ</span>
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
                        className="bg-blue-50 border border-blue-200 rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4"
                    >
                        <div className="flex items-start gap-3">
                            <span className="text-2xl shrink-0" aria-hidden="true">ℹ️</span>
                            <p className="text-sm text-blue-900 leading-relaxed">
                                {t('legal.disclaimer') || 'Information is provided by community users. BuenAdoptante does not verify its accuracy.'}
                            </p>
                        </div>
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
