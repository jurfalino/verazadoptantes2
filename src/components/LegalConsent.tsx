'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface LegalConsentProps {
    accepted: boolean;
    onChange: (accepted: boolean) => void;
}

export default function LegalConsent({ accepted, onChange }: LegalConsentProps) {
    const { t } = useLanguage();

    return (
        <label className="flex items-start gap-2 cursor-pointer group py-2">
            <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-teal-600 rounded border-stone-300 focus:ring-teal-500 cursor-pointer"
            />
            <span className="text-xs text-stone-500 leading-snug">
                {t('legal.consent_checkbox')}{' '}
                <a href="/terms" target="_blank" className="text-teal-600 underline underline-offset-2 hover:text-teal-800">
                    {t('legal.terms_link')}
                </a>{' '}
                {t('legal.and')}{' '}
                <a href="/privacy" target="_blank" className="text-teal-600 underline underline-offset-2 hover:text-teal-800">
                    {t('legal.privacy_link')}
                </a>.
            </span>
        </label>
    );
}
