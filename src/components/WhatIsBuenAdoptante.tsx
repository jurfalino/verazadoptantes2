'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Homepage hero explainer — replaces the old "Busca adoptantes y Registra
 * adopciones" subtitle. Click-to-expand pattern: the question always renders
 * collapsed; tapping reveals the two-paragraph product + workflow explainer.
 *
 * No state persistence — every page load starts collapsed (per UX sign-off
 * favoring simplicity over returning-user fatigue mitigation; if fatigue
 * becomes a real complaint we can layer in localStorage dismissal later).
 *
 * The expanded panel stays in the DOM (visibility-toggled via class instead
 * of `hidden`) so the height transition can animate.
 */
export default function WhatIsBuenAdoptante() {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);

    return (
        <div className="text-center">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-controls="what-is-content"
                className="inline-flex items-center gap-1.5 text-stone-600 text-sm md:text-base font-medium hover:text-stone-700 transition-colors"
            >
                <span>{t('home.what_is.title')}</span>
                <svg
                    className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l5 5 5-5" />
                </svg>
            </button>

            <div
                id="what-is-content"
                className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}
                aria-hidden={!open}
            >
                <div className="overflow-hidden">
                    <div className="max-w-2xl mx-auto px-2 text-left text-stone-600 text-sm leading-relaxed space-y-3">
                        <p>{t('home.what_is.intro')}</p>
                        <p className="font-semibold text-stone-700">{t('home.what_is.how_title')}</p>
                        <p>{t('home.what_is.how_body')}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
