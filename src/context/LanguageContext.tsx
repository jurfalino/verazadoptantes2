'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { en } from '@/i18n/locales/en';
import { es } from '@/i18n/locales/es';

type Locale = 'en' | 'es';
type Dictionary = typeof en;

const dictionaries: Record<Locale, Dictionary> = { en, es };
const DEFAULT_LOCALE: Locale = 'es'; // Spanish as default

// Helper to get initial locale synchronously (avoids flash)
function getInitialLocale(): Locale {
    if (typeof window === 'undefined') return DEFAULT_LOCALE;

    const saved = localStorage.getItem('app-locale') as Locale;
    if (saved && (saved === 'en' || saved === 'es')) {
        return saved;
    }

    // Auto-detect from browser, default to Spanish
    const browserLang = navigator.language.split('-')[0];
    return browserLang === 'en' ? 'en' : DEFAULT_LOCALE;
}

interface LanguageContextType {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (path: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
    const [isHydrated, setIsHydrated] = useState(false);

    // Hydrate from localStorage on mount (client-side only)
    useEffect(() => {
        setLocaleState(getInitialLocale());
        setIsHydrated(true);
    }, []);

    const setLocale = useCallback((newLocale: Locale) => {
        setLocaleState(newLocale);
        localStorage.setItem('app-locale', newLocale);
    }, []);

    // Memoize the t function to avoid unnecessary re-renders
    const t = useMemo(() => {
        return (path: string): string => {
            const keys = path.split('.');
            let current: any = dictionaries[locale];

            for (const key of keys) {
                if (current[key] === undefined) {
                    // Fallback to Spanish if key missing
                    let fallback: any = dictionaries[DEFAULT_LOCALE];
                    for (const k of keys) {
                        if (fallback[k] === undefined) return path;
                        fallback = fallback[k];
                    }
                    return fallback as string;
                }
                current = current[key];
            }

            return current as string;
        };
    }, [locale]);

    // Prevent hydration mismatch by using default locale on server
    const contextValue = useMemo(() => ({
        locale,
        setLocale,
        t
    }), [locale, setLocale, t]);

    return (
        <LanguageContext.Provider value={contextValue}>
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
