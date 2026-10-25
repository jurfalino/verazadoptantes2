/**
 * Final review I4: LanguageContext pushes the locale to the server only when
 * it differs from the last one pushed for this person from this browser.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { forgetPushedLocale, rememberPushedLocale, shouldPushLocale } from './localePushMarker';

class MemoryStorage {
    data = new Map<string, string>();
    getItem(k: string) { return this.data.get(k) ?? null; }
    setItem(k: string, v: string) { this.data.set(k, v); }
    removeItem(k: string) { this.data.delete(k); }
}
const broken = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('SecurityError'); },
};

let st: MemoryStorage;
beforeEach(() => { st = new MemoryStorage(); });

describe('locale push marker', () => {
    it('pushes until the value is remembered for that person, then not again — until it changes', () => {
        expect(shouldPushLocale('ana@example.com', 'pt', st)).toBe(true);
        rememberPushedLocale('ana@example.com', 'pt', st);
        expect(shouldPushLocale('ana@example.com', 'pt', st)).toBe(false);
        expect(shouldPushLocale('Ana@Example.com', 'pt', st)).toBe(false);
        expect(shouldPushLocale('ana@example.com', 'en', st)).toBe(true);
    });

    it('per person: another account in the same browser pushes its own', () => {
        rememberPushedLocale('ana@example.com', 'pt', st);
        expect(shouldPushLocale('bea@example.com', 'pt', st)).toBe(true);
    });

    it('forgotten on sign-out: the next session pushes once', () => {
        rememberPushedLocale('ana@example.com', 'pt', st);
        forgetPushedLocale('ana@example.com', st);
        expect(shouldPushLocale('ana@example.com', 'pt', st)).toBe(true);
    });

    it('blocked or missing storage never throws, and means "push"', () => {
        expect(() => rememberPushedLocale('ana@example.com', 'pt', broken)).not.toThrow();
        expect(() => forgetPushedLocale('ana@example.com', broken)).not.toThrow();
        expect(shouldPushLocale('ana@example.com', 'pt', broken)).toBe(true);
        expect(shouldPushLocale('ana@example.com', 'pt', null)).toBe(true);
        // No window (SSR / this test runner): same.
        expect(shouldPushLocale('ana@example.com', 'pt')).toBe(true);
    });
});
