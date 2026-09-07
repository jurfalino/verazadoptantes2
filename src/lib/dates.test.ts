import { describe, it, expect } from 'vitest';
import {
    DEFAULT_TIMEZONE,
    formatShortDate,
    formatDateTime,
    formatDateTimeFull,
    formatRelativeTime,
} from './dates';

/**
 * Guardrail for the React #418 hydration class of bug (errorId 43d67f9e,
 * 2026-09-07): the formatters used to build their output from `getDate()` /
 * `getFullYear()` / bare `toLocaleDateString`, all of which read the *runtime's*
 * timezone. The Cloudflare Worker runs in UTC and the browser runs in the
 * viewer's zone, so the SSR HTML and the hydration pass disagreed and React
 * threw away the server tree.
 *
 * The whole suite runs under `TZ=Pacific/Kiritimati` (UTC+14 — see
 * vitest.config.ts). That zone is deliberately different from BOTH `UTC` and
 * `DEFAULT_TIMEZONE`: if it matched either, a formatter that forgot to pass an
 * explicit `timeZone` would still produce the expected string and the guardrail
 * would pass while the bug shipped.
 */

const AR = 'America/Argentina/Buenos_Aires'; // UTC-3
const UTC = 'UTC';

// The exact value from the production row that produced errorId 43d67f9e.
// 1788739200 = 2026-09-07T00:00:00Z — a *civil date* (a picked `<input
// type="date">` normalised to UTC midnight), not a moment in time.
const CIVIL_DATE_SECONDS = 1788739200;

// 2026-09-07T01:00:00Z — a genuine instant. It is Sep 7 in UTC but still
// Sep 6 (22:00) in Buenos Aires, so it separates the two zones.
const INSTANT = new Date(Date.UTC(2026, 8, 7, 1, 0, 0));

describe('the test environment itself', () => {
    it('runs in a zone that is neither UTC nor the default display zone', () => {
        // If this ever fails, every other assertion below silently stops
        // guarding anything.
        const testZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
        expect(testZone).not.toBe(UTC);
        expect(testZone).not.toBe(DEFAULT_TIMEZONE);
    });
});

describe('formatShortDate', () => {
    it('renders a civil date as the day that was picked, in every zone', () => {
        // This is the regression: the picker stored "2026-09-07", so every
        // viewer must read "Sep 7" — never "Sep 6" because they are west of UTC.
        expect(formatShortDate(CIVIL_DATE_SECONDS, UTC)).toBe("Sep 7 '26");
        expect(formatShortDate(CIVIL_DATE_SECONDS, AR)).toBe("Sep 7 '26");
        expect(formatShortDate(CIVIL_DATE_SECONDS, 'Asia/Tokyo')).toBe("Sep 7 '26");
    });

    it('renders a genuine instant in the requested zone', () => {
        expect(formatShortDate(INSTANT, UTC)).toBe("Sep 7 '26");
        expect(formatShortDate(INSTANT, AR)).toBe("Sep 6 '26");
    });

    it('is a pure function of (value, zone) — the host zone never leaks in', () => {
        // Same inputs, same output, regardless of where this runs. This is the
        // property that makes SSR and hydration agree.
        expect(formatShortDate(INSTANT, AR)).toBe(formatShortDate(INSTANT, AR));
        expect(formatShortDate(INSTANT, AR)).not.toBe(formatShortDate(INSTANT, UTC));
    });

    it('accepts Date, epoch-seconds and ISO strings alike', () => {
        expect(formatShortDate(new Date(CIVIL_DATE_SECONDS * 1000), UTC)).toBe("Sep 7 '26");
        expect(formatShortDate(CIVIL_DATE_SECONDS, UTC)).toBe("Sep 7 '26");
        expect(formatShortDate('2026-09-07T00:00:00.000Z', UTC)).toBe("Sep 7 '26");
    });

    it('returns an em dash for unparseable input', () => {
        expect(formatShortDate('not a date', AR)).toBe('—');
        expect(formatShortDate(NaN, AR)).toBe('—');
    });

    it('defaults to the app timezone when none is supplied', () => {
        expect(formatShortDate(INSTANT)).toBe(formatShortDate(INSTANT, DEFAULT_TIMEZONE));
    });
});

describe('formatDateTime', () => {
    it('honours the requested zone rather than the host zone', () => {
        // Exact ICU output drifts between Node/browser versions, so assert the
        // part that matters: which calendar day and hour the viewer is shown.
        expect(formatDateTime(INSTANT, UTC)).toContain('7');
        expect(formatDateTime(INSTANT, UTC)).toContain('01:00');
        expect(formatDateTime(INSTANT, AR)).toContain('6');
        expect(formatDateTime(INSTANT, AR)).toContain('10:00');
    });

    it('is stable for a given (value, zone) pair', () => {
        expect(formatDateTime(INSTANT, AR)).toBe(formatDateTime(INSTANT, AR));
        expect(formatDateTime(INSTANT, AR)).not.toBe(formatDateTime(INSTANT, UTC));
    });

    it('returns an em dash for unparseable input', () => {
        expect(formatDateTime('nope', AR)).toBe('—');
    });
});

describe('formatDateTimeFull', () => {
    it('honours the requested zone and includes seconds', () => {
        const withSeconds = new Date(Date.UTC(2026, 8, 7, 1, 0, 5));
        expect(formatDateTimeFull(withSeconds, UTC)).toContain('05');
        expect(formatDateTimeFull(withSeconds, AR)).not.toBe(formatDateTimeFull(withSeconds, UTC));
    });
});

describe('formatRelativeTime', () => {
    // It reads the wall clock, so it can never be hydration-safe on its own —
    // SSR and hydration happen at different instants. `now` is injectable so
    // callers (and these tests) can pin it.
    const now = new Date(Date.UTC(2026, 8, 7, 12, 0, 0));

    it('is a pure function of (value, lang, now)', () => {
        const twoHoursEarlier = new Date(Date.UTC(2026, 8, 7, 10, 0, 0));
        expect(formatRelativeTime(twoHoursEarlier, 'es', now)).toBe('hace 2 horas');
        expect(formatRelativeTime(twoHoursEarlier, 'en', now)).toBe('2 hours ago');
    });

    it('still covers the existing buckets', () => {
        expect(formatRelativeTime(new Date(now.getTime() - 30_000), 'es', now)).toBe('justo ahora');
        expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000), 'es', now)).toBe('hace 5 min');
        expect(formatRelativeTime(new Date(now.getTime() - 3600_000), 'es', now)).toBe('hace 1 hora');
        expect(formatRelativeTime(new Date(now.getTime() - 3 * 86400_000), 'es', now)).toBe('hace 3 días');
    });

    it('returns null outside the 30-day window and for future dates', () => {
        expect(formatRelativeTime(new Date(now.getTime() - 31 * 86400_000), 'es', now)).toBeNull();
        expect(formatRelativeTime(new Date(now.getTime() + 60_000), 'es', now)).toBeNull();
    });
});
