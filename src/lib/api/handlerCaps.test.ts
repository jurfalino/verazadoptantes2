import { describe, expect, it } from 'vitest';
import { remainingFrom } from './handler';

describe('remainingFrom — RateLimit headers from the counts read before the call', () => {
    it('counts this call when it ran', () => {
        expect(remainingFrom({ mode: 'exact', byKey: 9, byPerson: 9, personCap: 100 }, 100, true)).toEqual({ limit: 100, remaining: 90 });
    });
    it('does not count a refused call or a replay', () => {
        expect(remainingFrom({ mode: 'exact', byKey: 9, byPerson: 9, personCap: 100 }, 100, false)).toEqual({ limit: 100, remaining: 91 });
    });
    it('reports the person\'s limit when their other keys used it up', () => {
        // Self-created key (cap 50, unused) + a partner key that used 1000 of the person's 1000.
        expect(remainingFrom({ mode: 'exact', byKey: 0, byPerson: 1000, personCap: 1000 }, 50, false)).toEqual({ limit: 1000, remaining: 0 });
    });
    it('never goes below zero', () => {
        expect(remainingFrom({ mode: 'fuzzy', byKey: 60, byPerson: 60, personCap: 50 }, 50, true).remaining).toBe(0);
    });
});

describe('importModeOn — import mode ends by itself', () => {
    it('is on until the stored second, off at 0 and after it', async () => {
        const { importModeOn } = await import('./keys');
        const now = Date.UTC(2026, 9, 19, 12);
        expect(importModeOn({ importMode: now / 1000 + 60 }, now)).toBe(true);
        expect(importModeOn({ importMode: now / 1000 - 1 }, now)).toBe(false);
        expect(importModeOn({ importMode: 0 }, now)).toBe(false);
        expect(importModeOn({ importMode: 1 }, now)).toBe(false); // the old boolean "on" is off
    });
});
