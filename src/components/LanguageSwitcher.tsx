'use client';

import { useLanguage } from '@/context/LanguageContext';

export function LanguageSwitcher() {
    const { locale, setLocale } = useLanguage();

    return (
        <div className="flex items-center gap-2 text-sm font-medium">
            <button
                onClick={() => setLocale('en')}
                className={`px-2 py-1 rounded transition-colors ${locale === 'en' ? 'bg-emerald-100 text-emerald-700 font-bold' : 'text-emerald-600/60 hover:text-emerald-800'}`}
            >
                EN
            </button>
            <span className="text-emerald-200">|</span>
            <button
                onClick={() => setLocale('es')}
                className={`px-2 py-1 rounded transition-colors ${locale === 'es' ? 'bg-emerald-100 text-emerald-700 font-bold' : 'text-emerald-600/60 hover:text-emerald-800'}`}
            >
                ES
            </button>
        </div>
    );
}
