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
    const detected: Locale = browserLang === 'en' ? 'en' : DEFAULT_LOCALE;
    // Persist so it survives refreshes and re-renders
    localStorage.setItem('app-locale', detected);
    return detected;
}

interface LanguageContextType {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (path: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
    const [_isHydrated, setIsHydrated] = useState(false);

    // Hydrate from localStorage on mount (client-side only)
    useEffect(() => {
        setLocaleState(getInitialLocale());
        setIsHydrated(true);
    }, []);

    const setLocale = useCallback((newLocale: Locale) => {
        setLocaleState(newLocale);
        localStorage.setItem('app-locale', newLocale);
    }, []);

    // Memoize the t function. Always returns a non-empty string so labels never render blank (production-safe).
    const t = useMemo(() => {
        return (path: string): string => {
            const keys = path.split('.');
            const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
            let current: unknown = dict;

            for (const key of keys) {
                if (current === undefined || current === null || typeof current !== 'object' || !(key in (current as object))) {
                    let fallback: unknown = dictionaries[DEFAULT_LOCALE];
                    for (const k of keys) {
                        if (fallback === undefined || fallback === null || typeof fallback !== 'object' || !(k in (fallback as object))) {
                            return path || ' ';
                        }
                        fallback = (fallback as Record<string, unknown>)[k];
                    }
                    const s = typeof fallback === 'string' ? fallback : path;
                    return s || path || ' ';
                }
                current = (current as Record<string, unknown>)[key];
            }

            const result = typeof current === 'string' ? current : path;
            return (result && result.trim().length > 0) ? result : path || ' ';
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
