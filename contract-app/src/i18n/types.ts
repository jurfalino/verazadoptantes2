// Locale primitives for the contract-app. The app is single-language per
// page-load: the language is a property of the shared artifact (set by the
// rescuer who shares it), NOT a user-facing toggle.

export type Locale = 'es' | 'en' | 'pt';

export const LOCALES: Locale[] = ['es', 'en', 'pt'];

// Spanish is authoritative (the app's origin language) and the fallback for
// any missing key — a missing translation renders Spanish, never a raw key.
export const DEFAULT_LOCALE: Locale = 'es';

export function isLocale(v: string | null | undefined): v is Locale {
    return v === 'es' || v === 'en' || v === 'pt';
}

// A catalog slice: the same key set translated into each locale.
export type CatalogSlice = Record<Locale, Record<string, string>>;
