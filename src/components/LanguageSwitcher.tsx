'use client';

import { useLanguage } from '@/context/LanguageContext';

export function LanguageSwitcher() {
    const { locale, setLocale } = useLanguage();

    return (
        <div className="flex items-center gap-2 text-sm font-medium">
            <button
                onClick={() => setLocale('en')}
                className={`px-2 py-1 rounded transition-colors ${locale === 'en' ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-500 hover:text-gray-700'}`}
            >
                EN
            </button>
            <span className="text-gray-300">|</span>
            <button
                onClick={() => setLocale('es')}
                className={`px-2 py-1 rounded transition-colors ${locale === 'es' ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-500 hover:text-gray-700'}`}
            >
                ES
            </button>
        </div>
    );
}
