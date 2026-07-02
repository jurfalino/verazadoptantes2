'use client';

import { useLanguage } from '@/context/LanguageContext';
import { useState, useRef, useEffect } from 'react';

const languages = [
    { id: 'en' as const, label: 'English', flag: '🇺🇸' },
    { id: 'es' as const, label: 'Español', flag: '🇦🇷' },
    { id: 'pt' as const, label: 'Português', flag: '🇧🇷' },
];

export function LanguageSwitcher() {
    const { locale, setLocale, t } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const currentLang = languages.find(l => l.id === locale) || languages[1];

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 rounded-xl hover:bg-stone-200/50 transition-colors flex items-center gap-1"
                title={t('nav.change_language')}
                aria-label={t('nav.change_language')}
                data-testid="language-switcher"
            >
                <span className="text-lg">{currentLang.flag}</span>
                <span className="text-xs font-semibold text-stone-500 uppercase">{currentLang.id}</span>
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-lg border border-stone-200 overflow-hidden z-50 min-w-[140px]">
                    {languages.map((lang) => (
                        <button
                            key={lang.id}
                            data-testid={`lang-option-${lang.id}`}
                            onClick={() => {
                                setLocale(lang.id);
                                setIsOpen(false);
                            }}
                            className={`w-full px-4 py-2.5 flex items-center gap-3 hover:bg-stone-100 transition-colors text-left ${locale === lang.id ? 'bg-stone-100' : ''}`}
                        >
                            <span className="text-lg">{lang.flag}</span>
                            <span className="text-sm font-medium text-stone-700">{lang.label}</span>
                            {locale === lang.id && (
                                <span className="ml-auto text-teal-700">✓</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
