/**
 * Timezone options offered in Configuración.
 *
 * A curated list, not the full IANA database (~400 zones). The full set needs a
 * searchable combobox with human-readable labels to be usable; this covers the
 * regions the platform actually serves and stays a plain `<select>`.
 *
 * A user whose auto-detected zone is not on this list keeps it — see
 * `timezoneOptionsFor`. Never render a list that silently drops the value the
 * user already has, or opening the page and saving would overwrite a correct
 * zone with a list default.
 *
 * Labels are proper nouns and are intentionally not run through `t()`, matching
 * the ThemeSelector precedent.
 */
export interface TimezoneOption {
    /** IANA zone name, e.g. "America/Argentina/Buenos_Aires". */
    value: string;
    label: string;
}

export const TIMEZONE_OPTIONS: readonly TimezoneOption[] = [
    { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)' },
    { value: 'America/Montevideo', label: 'Uruguay (Montevideo)' },
    { value: 'America/Santiago', label: 'Chile (Santiago)' },
    { value: 'America/Asuncion', label: 'Paraguay (Asunción)' },
    { value: 'America/La_Paz', label: 'Bolivia (La Paz)' },
    { value: 'America/Sao_Paulo', label: 'Brasil (São Paulo)' },
    { value: 'America/Lima', label: 'Perú (Lima)' },
    { value: 'America/Bogota', label: 'Colombia (Bogotá)' },
    { value: 'America/Caracas', label: 'Venezuela (Caracas)' },
    { value: 'America/Guayaquil', label: 'Ecuador (Guayaquil)' },
    { value: 'America/Mexico_City', label: 'México (Ciudad de México)' },
    { value: 'Europe/Madrid', label: 'España (Madrid)' },
] as const;

/**
 * Whether a string is a zone `Intl.DateTimeFormat` will accept.
 *
 * This is the property that matters at render time: an unknown `timeZone`
 * throws a `RangeError`, and these formatters run during SSR, so one bad value
 * in the free-text `user_profiles.timezone` column would take a page down.
 */
export function isValidTimezone(timezone: string): boolean {
    if (!timezone || timezone.length > 64) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
}

/**
 * The options to render for a user whose stored zone is `current`.
 *
 * Appends `current` when it is a valid zone outside the curated list, so an
 * auto-detected zone we do not list is still selectable and survives a save.
 */
export function timezoneOptionsFor(current: string | null | undefined): TimezoneOption[] {
    const options = [...TIMEZONE_OPTIONS];
    if (current && isValidTimezone(current) && !options.some(o => o.value === current)) {
        options.push({ value: current, label: current });
    }
    return options;
}
