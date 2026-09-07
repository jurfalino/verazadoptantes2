/**
 * Shared date formatting utilities.
 * All user-facing dates use 3-letter month abbreviations.
 *
 * ## Every formatter here takes an explicit `timeZone`
 *
 * These functions run twice for the same value: once on the Cloudflare Worker
 * (which runs in UTC) to build the SSR HTML, and once in the browser (which
 * runs in the viewer's zone) during hydration. Anything that reads the *host*
 * zone — `getDate()`, `getFullYear()`, a bare `toLocaleDateString` — therefore
 * produces two different strings for one value, React sees a mismatch and
 * throws the whole server-rendered tree away (error #418).
 *
 * That is not a theoretical risk: it shipped, and users saw an error toast for
 * it on 2026-09-07 (errorId 43d67f9e). Passing an explicit `timeZone` to
 * `Intl.DateTimeFormat` makes the output a pure function of (value, zone), so
 * both passes agree by construction.
 *
 * `src/lib/dates.test.ts` runs under `TZ=Pacific/Kiritimati` specifically to
 * fail if a host zone ever leaks back in.
 */

/** The zone dates are shown in when we have no better information about the
 *  viewer. Overridden per-viewer from `user_profiles.timezone` — see
 *  `src/context/TimezoneContext.tsx`. */
export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

const MS_PER_DAY = 86_400_000;

/** Normalise the three shapes callers pass. Returns null when unparseable. */
function toDate(input: Date | number | string): Date | null {
    const date = input instanceof Date
        ? input
        : new Date(typeof input === 'number' && input < 1e12 ? input * 1000 : input);
    return isNaN(date.getTime()) ? null : date;
}

/**
 * True when the value sits exactly on midnight UTC.
 *
 * `adoptions.date` conflates two different things (see
 * `_recordWrite.ts` — `data.date || new Date()`): a date the user *picked*
 * (`<input type="date">` → "2026-09-07" → parsed as UTC midnight), and an
 * instant auto-stamped at write time. A picked date is a wall-calendar day, not
 * a moment — rendering it in the viewer's zone shows Sep 6 to anyone west of
 * UTC, which is simply the wrong day. So we render those in UTC, the zone they
 * were normalised into.
 *
 * Landing exactly on midnight UTC is the only signal the column gives us. A
 * genuine instant has a 1-in-86,400 chance of tripping it, which costs at most
 * a day's display drift on one row. The real fix is to split the column — see
 * the follow-up in CHANGELOG — and this heuristic goes away with it.
 */
function isCivilDate(date: Date): boolean {
    return date.getTime() % MS_PER_DAY === 0;
}

// `Intl.DateTimeFormat` construction dominates the cost of these helpers and
// the profile page formats a date per activity row, so memoise by shape.
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function getFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale}|${JSON.stringify(options)}`;
    let formatter = formatterCache.get(key);
    if (!formatter) {
        try {
            formatter = new Intl.DateTimeFormat(locale, options);
        } catch {
            // An unrecognised `timeZone` throws a RangeError, and these run
            // during SSR — one bad value in `user_profiles.timezone` would
            // otherwise take out the whole page. `resolveViewerTimezone`
            // validates before it gets here; this is the backstop for the
            // formatters' other callers.
            formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: DEFAULT_TIMEZONE });
        }
        formatterCache.set(key, formatter);
    }
    return formatter;
}

/**
 * Format a date as "Feb 4 '26" — short month + day + 2-digit year.
 * Accepts Date objects, epoch-seconds (number), or ISO strings.
 *
 * Civil dates (see `isCivilDate`) always render in UTC so every viewer reads
 * back the day that was picked; genuine instants render in `timeZone`.
 */
export function formatShortDate(input: Date | number | string, timeZone: string = DEFAULT_TIMEZONE): string {
    const date = toDate(input);
    if (!date) return '—';
    const zone = isCivilDate(date) ? 'UTC' : timeZone;
    const parts = getFormatter('en-US', {
        timeZone: zone, month: 'short', day: 'numeric', year: 'numeric',
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
    return `${get('month')} ${get('day')} '${get('year').slice(-2)}`;
}

/**
 * Format a date-time as "6 de sept de 2026, 09:00 p. m." — day + short month +
 * year + time. Uses es-AR for consistency with the app's Spanish-first approach.
 *
 * Always renders in `timeZone`: callers pass audit timestamps here, which are
 * genuine instants and belong in the viewer's own wall clock.
 */
export function formatDateTime(input: Date | number | string, timeZone: string = DEFAULT_TIMEZONE): string {
    const date = toDate(input);
    if (!date) return '—';
    return getFormatter('es-AR', {
        timeZone,
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    }).format(date);
}

/**
 * Format a date-time with seconds: "6 de sept de 2026, 09:00:05 p. m."
 */
export function formatDateTimeFull(input: Date | number | string, timeZone: string = DEFAULT_TIMEZONE): string {
    const date = toDate(input);
    if (!date) return '—';
    return getFormatter('es-AR', {
        timeZone,
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(date);
}

/**
 * Return a human-readable relative time string for recent dates (within 30 days).
 * Returns null for dates older than 30 days so callers can conditionally display it.
 *
 * ⚠️ Unlike the formatters above, this one reads the wall clock, so it can never
 * be made hydration-safe by pinning a zone: SSR and hydration happen at
 * different instants, and a value sitting near a bucket edge ("hace 59 min" →
 * "hace 1 hora") renders differently in each pass. Render it client-side only,
 * after mount — never in the first paint. `now` is injectable so callers can
 * pin it and tests can stay deterministic.
 *
 * @param lang - 'es' or 'en'
 * @param now - reference instant; defaults to the current wall clock
 */
export function formatRelativeTime(
    input: Date | number | string,
    lang: 'es' | 'en' = 'es',
    now: Date | number = new Date(),
): string | null {
    const date = toDate(input);
    if (!date) return null;

    const nowMs = now instanceof Date ? now.getTime() : now;
    const diffMs = nowMs - date.getTime();
    if (diffMs < 0) return null; // future dates

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays > 30) return null;

    if (lang === 'es') {
        if (diffMins < 1) return 'justo ahora';
        if (diffMins < 60) return `hace ${diffMins} min`;
        if (diffHours < 24) return diffHours === 1 ? 'hace 1 hora' : `hace ${diffHours} horas`;
        if (diffDays === 0) return 'hoy';
        if (diffDays === 1) return 'ayer';
        return `hace ${diffDays} días`;
    }

    // English
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    return `${diffDays} days ago`;
}

/**
 * Mask an email address for privacy: "jurfalino@gmail.com" → "j***o@gmail.com"
 */
export function maskEmail(email: string): string {
    const atIndex = email.indexOf('@');
    if (atIndex <= 1) return email; // too short to mask
    const local = email.substring(0, atIndex);
    const domain = email.substring(atIndex);
    if (local.length <= 2) return local[0] + '*' + domain;
    return local[0] + '***' + local[local.length - 1] + domain;
}
