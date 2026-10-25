'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { saveMyLocale } from '@/app/actions/settings';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { forgetPushedLocale, rememberPushedLocale, shouldPushLocale } from '@/lib/localePushMarker';
import { en } from '@/i18n/locales/en';
import { es } from '@/i18n/locales/es';
import { pt } from '@/i18n/locales/pt';

type Locale = 'en' | 'es' | 'pt';
type Dictionary = typeof en;

const dictionaries: Record<Locale, Dictionary> = { en, es, pt };
const DEFAULT_LOCALE: Locale = 'es'; // Spanish as default

// Helper to get initial locale synchronously (avoids flash)
function getInitialLocale(): Locale {
    if (typeof window === 'undefined') return DEFAULT_LOCALE;

    const saved = localStorage.getItem('app-locale') as Locale;
    if (saved && (saved === 'en' || saved === 'es' || saved === 'pt')) {
        return saved;
    }

    // Auto-detect from browser, default to Spanish
    const browserLang = navigator.language.split('-')[0];
    const detected: Locale = browserLang === 'en' ? 'en' : browserLang === 'pt' ? 'pt' : DEFAULT_LOCALE;
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

    const { data: sessionData, status } = useSession();
    const signedIn = status === 'authenticated';
    const email = signedIn ? sessionData?.user?.email ?? null : null;
    const lastPushed = useRef<{ email: string; locale: Locale } | null>(null);
    const prevEmail = useRef<string | null>(null);

    // Sign-out or another person signing in: forget what was pushed for the
    // previous one, so their next session pushes once.
    useEffect(() => {
        if (status === 'loading') return;
        const prev = prevEmail.current;
        if (prev && prev !== email) {
            forgetPushedLocale(prev);
            lastPushed.current = null;
        }
        prevEmail.current = email;
    }, [email, status]);

    // Emails to this person go out in the language they chose, so the server
    // must know it. Only when it changed (this tab, or this browser's marker
    // — not on every page load). Fire-and-forget: a failed save is reported,
    // never shown.
    const pushLocale = useCallback((l: Locale) => {
        if (!email) return;
        if (lastPushed.current?.email === email && lastPushed.current.locale === l) return;
        lastPushed.current = { email, locale: l };
        if (!shouldPushLocale(email, l)) return;
        saveMyLocale(l)
            .then(r => {
                if (r.success) rememberPushedLocale(email, l);
                else lastPushed.current = null;
            })
            .catch((e) => { lastPushed.current = null; resolveErrorId(e, 'LanguageContext.saveMyLocale'); });
    }, [email]);

    const setLocale = useCallback((newLocale: Locale) => {
        setLocaleState(newLocale);
        localStorage.setItem('app-locale', newLocale);
        if (signedIn) pushLocale(newLocale);
    }, [signedIn, pushLocale]);

    // On sign-in push the stored locale (when it differs from what this
    // browser last pushed), so people who chose a language before this
    // existed are covered too.
    useEffect(() => {
        if (signedIn && _isHydrated) pushLocale(locale);
    }, [signedIn, _isHydrated, locale, pushLocale]);

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

/**
 * The current app language, or the default outside a provider. Unlike
 * `useLanguage` it never throws, so shared hooks (e.g. `useDateFormat`) stay
 * usable in isolated renders and tests.
 */
export function useLocale(): Locale {
    return useContext(LanguageContext)?.locale ?? DEFAULT_LOCALE;
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
