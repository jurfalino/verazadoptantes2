'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Homepage heading, above the search card.
 *
 * Names the page — "Registro de Adopciones" — and doubles as the disclosure for
 * how the thing works. One element instead of two: until v2.56.54 a sentence
 * carried a separate "¿Cómo funciona?" link at its end, which meant the page's
 * only heading was a line of body copy with a link stuck to it.
 *
 * The heading IS the button, so the whole phrase is the hit target, with a
 * chevron because a heading that does nothing looks exactly like a heading that
 * does. Three parallel steps sit behind it, replacing the paragraph they came
 * from: one sentence with a semicolon and two branches the reader had to hold
 * both halves of to get either.
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
            <h2>
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    aria-expanded={open}
                    aria-controls="what-is-content"
                    className="inline-flex items-center gap-2 text-lg md:text-xl font-bold tracking-tight text-stone-900 hover:text-teal-800 transition-colors"
                >
                    {t('home.what_is.heading')}
                    <svg
                        className={`w-4 h-4 shrink-0 text-stone-400 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        aria-hidden="true"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l5 5 5-5" />
                    </svg>
                </button>
            </h2>

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
