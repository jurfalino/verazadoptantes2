'use client';

import { useLanguage } from '@/context/LanguageContext';

export default function LegalConsent() {
    const { t } = useLanguage();

    return (
        <p className="text-xs text-stone-500 leading-snug py-1">
            {t('legal.consent_checkbox')}{' '}
            <a href="/terms" target="_blank" className="text-teal-700 underline underline-offset-2 hover:text-teal-800">
                {t('legal.terms_link')}
            </a>{' '}
            {t('legal.and')}{' '}
            <a href="/privacy" target="_blank" className="text-teal-700 underline underline-offset-2 hover:text-teal-800">
                {t('legal.privacy_link')}
            </a>.
        </p>
    );
}
