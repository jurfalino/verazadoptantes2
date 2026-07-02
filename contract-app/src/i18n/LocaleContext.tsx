import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, isLocale, type Locale } from './types';
import { translate } from './index';

/**
 * Resolve the page's language from the `?lang=` URL param (stamped onto the
 * shared link at share time by the rescuer). Defaults to Spanish. For contract
 * pages, if no `?lang=` was present, the fetched invitation's `locale` can
 * override this later via `setLocale` (the record is the authoritative source).
 */
export function resolveInitialLocale(): Locale {
    if (typeof window === 'undefined') return DEFAULT_LOCALE;
    const p = new URLSearchParams(window.location.search).get('lang');
    return isLocale(p) ? p : DEFAULT_LOCALE;
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

interface LocaleContextValue {
    locale: Locale;
    setLocale: (l: Locale) => void;
    t: Translate;
}

const LocaleContext = createContext<LocaleContextValue>({
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key) => key,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
    const [locale, setLocale] = useState<Locale>(resolveInitialLocale);
    const t = useMemo<Translate>(() => (key, vars) => translate(locale, key, vars), [locale]);
    const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT() {
    return useContext(LocaleContext);
}

/**
 * Append the current language to an internal link so it survives the
 * contract-app's full-page navigations (showcase → animal → form). Default
 * locale (es) is omitted to keep URLs clean; external links pass through.
 */
export function localizedHref(path: string, locale: Locale): string {
    if (locale === DEFAULT_LOCALE || !path.startsWith('/')) return path;
    return `${path}${path.includes('?') ? '&' : '?'}lang=${locale}`;
}
