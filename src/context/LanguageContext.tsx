'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { en } from '@/i18n/locales/en';
import { es } from '@/i18n/locales/es';

type Locale = 'en' | 'es';
type Dictionary = typeof en;

const dictionaries = { en, es };

interface LanguageContextType {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (path: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>('en');

    useEffect(() => {
        const saved = localStorage.getItem('app-locale') as Locale;
        if (saved && (saved === 'en' || saved === 'es')) {
            setLocaleState(saved);
        } else if (typeof navigator !== 'undefined') {
            // Auto-detect from browser
            const browserLang = navigator.language.split('-')[0];
            if (browserLang === 'es') {
                setLocaleState('es');
            }
        }
    }, []);

    const setLocale = (newLocale: Locale) => {
        setLocaleState(newLocale);
        localStorage.setItem('app-locale', newLocale);
    };

    // Helper to access nested keys like 'adopter.title'
    const t = (path: string): string => {
        const keys = path.split('.');
        let current: any = dictionaries[locale];

        for (const key of keys) {
            if (current[key] === undefined) {
                console.warn(`Missing translation for key: ${path} in locale: ${locale}`);
                return path;
            }
            current = current[key];
        }

        return current as string;
    };

    return (
        <LanguageContext.Provider value={{ locale, setLocale, t }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
