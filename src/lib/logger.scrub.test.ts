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
    it('a bound value that spans lines is cut whole (a pretty-printed request body)', () => {
        const msg = 'Failed query: update "api_requests" set "request_body" = ?\nparams: {\n  "fullName": "Ana Gómez",\n  "phone": "11 4455-6677"\n}';
        expect(scrubDbParams(msg)).toBe('Failed query: update "api_requests" set "request_body" = ?\nparams: [redacted]');
        const stack = `Error: ${msg}\n    at a (x.js:1)\n    at b (y.js:2)`;
        expect(scrubDbParams(stack)).toBe('Error: Failed query: update "api_requests" set "request_body" = ?\nparams: [redacted]\n    at a (x.js:1)\n    at b (y.js:2)');
    });
    it('an Error in log data is reduced to its scrubbed message; a Date keeps its value', () => {
        const err = new Error('Failed query: select 1\nparams: ana@x.com');
        const out = scrubLogValues({ error: err, at: new Date('2026-11-04T00:00:00Z') }) as Record<string, unknown>;
        expect(JSON.stringify(out)).not.toContain('ana@x.com');
        expect(out.at).toBe('2026-11-04T00:00:00.000Z');
    });
    it('a value line that merely starts with "at" is not kept as a stack frame', () => {
        expect(scrubDbParams('Failed query: x\nparams: a,\n   at casa de Ana Gómez 11 4455-6677')).toBe('Failed query: x\nparams: [redacted]');
    });
    it('never throws: circular data, BigInt, self-returning toJSON, class instances', () => {
        const circ: Record<string, unknown> = {}; circ.self = circ;
        const deep = { a: { b: { c: { d: { e: { f: circ, n: BigInt(1) } } } } } };
        const selfJson = { toJSON() { return selfJson; } };
        expect(() => scrubLogValues({ deep, selfJson, q: new URLSearchParams('q=Ana+Gomez') })).not.toThrow();
        const out = scrubLogValues({ q: new URLSearchParams('q=Ana+Gomez'), m: new Map([['k', 'Ana']]) }) as Record<string, unknown>;
        expect(out).toEqual({ q: '[URLSearchParams]', m: '[Map]' });
    });
    it('walks nested log data (a warn that passes error.message)', () => {
        const out = scrubLogValues({ requestId: 'r1', error: 'Failed query: update x set y = ?\nparams: 11 4455-6677', nested: { list: ['params: Ana'] } });
        expect(out).toEqual({ requestId: 'r1', error: 'Failed query: update x set y = ?\nparams: [redacted]', nested: { list: ['params: [redacted]'] } });
    });
});
