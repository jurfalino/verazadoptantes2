import { describe, it, expect } from 'vitest';
import { TIMEZONE_OPTIONS, isValidTimezone, timezoneOptionsFor } from './timezones';
import { DEFAULT_TIMEZONE } from '@/lib/dates';

describe('TIMEZONE_OPTIONS', () => {
    it('only contains zones Intl will accept', () => {
        // A typo here reaches `Intl.DateTimeFormat` during SSR and throws a
        // RangeError, taking the page down rather than showing a wrong time.
        for (const option of TIMEZONE_OPTIONS) {
            expect(isValidTimezone(option.value), option.value).toBe(true);
        }
    });

    it('offers the app default', () => {
        expect(TIMEZONE_OPTIONS.some(o => o.value === DEFAULT_TIMEZONE)).toBe(true);
    });

    it('has no duplicate values', () => {
        const values = TIMEZONE_OPTIONS.map(o => o.value);
        expect(new Set(values).size).toBe(values.length);
    });
});

describe('isValidTimezone', () => {
    it('rejects junk, empty and over-long input', () => {
        expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
        expect(isValidTimezone('')).toBe(false);
        expect(isValidTimezone('A'.repeat(65))).toBe(false);
    });

    it('accepts zones outside the curated list', () => {
        expect(isValidTimezone('Asia/Tokyo')).toBe(true);
        expect(isValidTimezone('UTC')).toBe(true);
    });
});

describe('timezoneOptionsFor', () => {
    it('keeps a valid detected zone that is not on the curated list', () => {
        // Otherwise opening Configuración and saving would silently replace a
        // correctly detected zone with whichever option happened to be first.
        const options = timezoneOptionsFor('Asia/Tokyo');
        expect(options.some(o => o.value === 'Asia/Tokyo')).toBe(true);
        expect(options).toHaveLength(TIMEZONE_OPTIONS.length + 1);
    });

    it('does not duplicate a zone already on the list', () => {
        const options = timezoneOptionsFor(DEFAULT_TIMEZONE);
        expect(options).toHaveLength(TIMEZONE_OPTIONS.length);
    });

    it('ignores an absent or invalid stored zone', () => {
        expect(timezoneOptionsFor(null)).toHaveLength(TIMEZONE_OPTIONS.length);
        expect(timezoneOptionsFor('Mars/Olympus_Mons')).toHaveLength(TIMEZONE_OPTIONS.length);
    });
});
