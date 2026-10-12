import { describe, it, expect } from 'vitest';
import { lockWaitMs, scanRetryDelayMs, SCAN_LOCK_STALE_MS, SCAN_LOCK_SAME_USER_STALE_MS, SCAN_MAX_CONSECUTIVE_FAILURES } from './scanResilience';

describe('lockWaitMs', () => {
    it('lets the same admin take over their own interrupted batch after a minute', () => {
        expect(lockWaitMs(SCAN_LOCK_SAME_USER_STALE_MS + 1, 'a@x.org', 'a@x.org')).toBe(0);
        expect(lockWaitMs(30_000, 'a@x.org', 'a@x.org')).toBe(30_000);
    });
    it("keeps someone else's live scan protected for five minutes", () => {
        expect(lockWaitMs(2 * 60_000, 'a@x.org', 'b@x.org')).toBe(SCAN_LOCK_STALE_MS - 2 * 60_000);
        expect(lockWaitMs(SCAN_LOCK_STALE_MS + 1, 'a@x.org', 'b@x.org')).toBe(0);
    });
    it('an unknown holder gets the full window', () => {
        expect(lockWaitMs(90_000, null, 'a@x.org')).toBe(SCAN_LOCK_STALE_MS - 90_000);
    });
});

describe('scanRetryDelayMs', () => {
    it('backs off on dropped connections, then gives up', () => {
        expect(scanRetryDelayMs(1)).toBe(2000);
        expect(scanRetryDelayMs(3)).toBe(10000);
        expect(scanRetryDelayMs(SCAN_MAX_CONSECUTIVE_FAILURES)).toBe(30000);
        expect(scanRetryDelayMs(SCAN_MAX_CONSECUTIVE_FAILURES + 1)).toBeNull();
    });
    it('waits as long as a busy lock asks, within a cap', () => {
        expect(scanRetryDelayMs(1, 40_000)).toBe(41_000);
        expect(scanRetryDelayMs(1, 4 * 60_000)).toBe(65_000);
    });
});
