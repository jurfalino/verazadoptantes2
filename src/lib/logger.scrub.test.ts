import { describe, expect, it } from 'vitest';
import { scrubDbParams, scrubLogValues } from './logger';

describe('scrubDbParams — a failed query keeps its SQL, never its values (2026-11-04 audit)', () => {
    it('redacts the params line Drizzle appends', () => {
        const msg = 'Failed query: insert into "adopters" ("id", "name") values (?, ?)\nparams: 1234,Ana Pérez';
        expect(scrubDbParams(msg)).toBe('Failed query: insert into "adopters" ("id", "name") values (?, ?)\nparams: [redacted]');
    });
    it('redacts inside a stack and leaves other text alone', () => {
        expect(scrubDbParams('Error: Failed query: select 1\nparams: ana@example.com\n    at foo (bar.js:1)')).toBe('Error: Failed query: select 1\nparams: [redacted]\n    at foo (bar.js:1)');
        expect(scrubDbParams('D1_ERROR: network connection lost')).toBe('D1_ERROR: network connection lost');
    });
    it('walks nested log data (a warn that passes error.message)', () => {
        const out = scrubLogValues({ requestId: 'r1', error: 'Failed query: update x set y = ?\nparams: 11 4455-6677', nested: { list: ['params: Ana'] } });
        expect(out).toEqual({ requestId: 'r1', error: 'Failed query: update x set y = ?\nparams: [redacted]', nested: { list: ['params: [redacted]'] } });
    });
});
