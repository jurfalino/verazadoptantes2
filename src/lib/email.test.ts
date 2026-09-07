/**
 * The OTP email's stated expiry has to match the enforced one (OTP_TTL_MS).
 * It used to be hardcoded as "10 minutes" in three locale strings, so raising
 * the TTL would have left the email lying to the reader. These tests pin the
 * duration to what's passed in, and pin the wording that renders it.
 */

import { describe, it, expect } from 'vitest';
import { buildOtpEmail, formatDuration } from './email';
import { OTP_TTL_MS } from './otp';

const TTL_MINUTES = Math.round(OTP_TTL_MS / 60_000);

describe('formatDuration', () => {
    it('renders whole hours as hours, not minutes', () => {
        expect(formatDuration(60, 'es')).toBe('1 hora');
        expect(formatDuration(60, 'en')).toBe('1 hour');
        expect(formatDuration(60, 'pt')).toBe('1 hora');
        expect(formatDuration(120, 'en')).toBe('2 hours');
        expect(formatDuration(120, 'es')).toBe('2 horas');
    });

    it('renders sub-hour and non-round values in minutes', () => {
        expect(formatDuration(10, 'es')).toBe('10 minutos');
        expect(formatDuration(10, 'en')).toBe('10 minutes');
        expect(formatDuration(1, 'en')).toBe('1 minute');
        expect(formatDuration(90, 'en')).toBe('90 minutes'); // never "1.5 hours"
    });
});

describe('buildOtpEmail', () => {
    it('states the duration it is given, in every locale', () => {
        expect(buildOtpEmail('123456', 'es', 60).text).toContain('vence en 1 hora');
        expect(buildOtpEmail('123456', 'en', 60).text).toContain('expires in 1 hour');
        expect(buildOtpEmail('123456', 'pt', 60).text).toContain('expira em 1 hora');
        expect(buildOtpEmail('123456', 'en', 10).text).toContain('expires in 10 minutes');
    });

    it('matches the enforced TTL when handed the real constant', () => {
        const { html, text } = buildOtpEmail('123456', 'es', TTL_MINUTES);
        const expected = formatDuration(TTL_MINUTES, 'es');
        expect(text).toContain(expected);
        expect(html).toContain(expected);
    });

    it('carries the code in both the HTML and plain-text bodies', () => {
        const { html, text, subject } = buildOtpEmail('428317', 'es', TTL_MINUTES);
        expect(html).toContain('428317');
        expect(text).toContain('428317');
        expect(subject).not.toContain('428317'); // never put the code in the subject line
    });

    it('falls back to Spanish for an unknown locale', () => {
        const unknown = buildOtpEmail('123456', 'de' as 'es', 60);
        expect(unknown.subject).toBe(buildOtpEmail('123456', 'es', 60).subject);
        expect(unknown.text).toContain('1 hora');
    });
});
