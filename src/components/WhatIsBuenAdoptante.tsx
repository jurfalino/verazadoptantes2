'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Homepage explainer, above the search card.
 *
 * The line itself is always visible and says what this is. Until v2.56.48 the
 * whole thing was a collapsed "¿Qué es Buen Adoptante?" toggle, so the state
 * almost everyone saw was a question with no answer — the only way to learn
 * anything was to click. It now answers first and keeps the toggle for the
 * mechanics.
 *
 * "¿Cómo funciona?" rides on the end of the line rather than sitting in its own
 * block, and the steps unfold directly beneath it, so the trigger and what it
 * reveals stay adjacent. Three parallel steps replaced the paragraph they came
 * from: that was one sentence with a semicolon and two branches, which the
 * reader had to hold both halves of to get either.
 *
 * Nothing persists — every page load starts collapsed. The panel stays in the
 * DOM (visibility-toggled via class instead of `hidden`) so the height can
 * animate.
 */
export default function WhatIsBuenAdoptante() {
    const { t, locale } = useLanguage();
    const [open, setOpen] = useState(false);

    const steps = [
        { lead: t('home.what_is.step1_lead'), text: t('home.what_is.step1') },
        { lead: t('home.what_is.step2_lead'), text: t('home.what_is.step2') },
        { lead: t('home.what_is.step3_lead'), text: t('home.what_is.step3') },
    ];

    return (
        <div className="text-center">
            <p className="max-w-xl mx-auto text-stone-600 text-sm md:text-[15px] leading-relaxed">
                {t('home.what_is.line')}{' '}
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    aria-expanded={open}
                    aria-controls="what-is-content"
                    className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800 transition-colors"
                >
                    {t('home.what_is.how_title')}
                    <svg
                        className={`w-3.5 h-3.5 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l5 5 5-5" />
                    </svg>
                </button>
            </p>

            <div
                id="what-is-content"
                className={`grid transition-all duration-300 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}
                aria-hidden={!open}
            >
                <div className="overflow-hidden">
                    <ol className="max-w-2xl mx-auto text-left flex flex-col md:flex-row gap-2.5 md:gap-3">
                        {steps.map((step, i) => (
                            <li
                                key={step.lead}
                                className="flex-1 flex items-start gap-2.5 bg-white border border-stone-200 rounded-xl px-3.5 py-3"
                            >
                                <span
                                    aria-hidden="true"
                                    className="shrink-0 mt-0.5 w-[22px] h-[22px] flex items-center justify-center rounded-full bg-teal-100 text-teal-700 text-[11px] font-bold"
                                >
                                    {i + 1}
                                </span>
                                <span className="min-w-0 text-sm text-stone-600 leading-snug">
                                    <b className="font-semibold text-stone-900">{step.lead}</b>{' '}
                                    {step.text}
                                </span>
                            </li>
                        ))}
                    </ol>
                    {/* The long explanation the paragraph used to carry still exists —
                        it lives in the guide, so the steps point there instead of
                        letting that detail disappear with the prose. */}
                    <a
                        href={locale === 'en' ? '/guide' : '/guia'}
                        className="inline-block mt-3 text-xs font-medium text-stone-500 underline underline-offset-2 hover:text-stone-700 transition-colors"
                        tabIndex={open ? 0 : -1}
                    >
                        {t('home.what_is.more')}
                    </a>
                </div>
            </div>
        </div>
    );
}
