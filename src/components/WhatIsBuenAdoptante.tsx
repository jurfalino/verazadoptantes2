'use client';

import { useLanguage } from '@/context/LanguageContext';

/**
 * Homepage heading, above the search card: names the page and says, in one
 * always-visible paragraph, what it is for and how it is used.
 *
 * Until v2.56.120 the heading was a disclosure button hiding three numbered
 * steps and a link to the guide; the paragraph replaces both, so nothing
 * needs a tap to be read.
 */
export default function WhatIsBuenAdoptante() {
    const { t } = useLanguage();

    return (
        <div className="text-center">
            <h2 className="text-lg md:text-xl font-bold tracking-tight text-stone-900">
                {t('home.what_is.heading')}
            </h2>
            <p className="mt-2 max-w-2xl mx-auto text-sm md:text-[15px] leading-relaxed text-stone-600">
                {t('home.what_is.intro')}
            </p>
        </div>
    );
}
