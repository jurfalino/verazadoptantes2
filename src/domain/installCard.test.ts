import { describe, it, expect } from 'vitest';
import { INSTALL_CARD_SNOOZE_MS, installCardEventPlatform, parseDismissedAt, shouldShowInstallCard } from './installCard';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('INSTALL_CARD_SNOOZE_MS — «Ahora no» / ✕ hide the card for 30 days', () => {
    it('is exactly 30 days', () => {
        expect(INSTALL_CARD_SNOOZE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });
});

describe('shouldShowInstallCard — the home «Instalá la app» card', () => {
    const base = { isStandalone: false, dismissedAt: null, now: NOW } as const;

    it('shows on iPhone/iPad and where the browser offers an install', () => {
        expect(shouldShowInstallCard({ ...base, platform: 'ios' })).toBe(true);
        expect(shouldShowInstallCard({ ...base, platform: 'installable' })).toBe(true);
    });

    it('never shows where nothing can be installed (desktop without an install prompt)', () => {
        expect(shouldShowInstallCard({ ...base, platform: 'none' })).toBe(false);
    });

    it('never shows inside the installed app', () => {
        expect(shouldShowInstallCard({ ...base, isStandalone: true, platform: 'ios' })).toBe(false);
        expect(shouldShowInstallCard({ ...base, isStandalone: true, platform: 'installable' })).toBe(false);
    });

    it('stays hidden for 30 days after «Ahora no» / ✕', () => {
        expect(shouldShowInstallCard({ ...base, platform: 'ios', dismissedAt: NOW })).toBe(false);
        expect(shouldShowInstallCard({ ...base, platform: 'installable', dismissedAt: NOW - 29 * DAY })).toBe(false);
        expect(shouldShowInstallCard({ ...base, platform: 'installable', dismissedAt: NOW - INSTALL_CARD_SNOOZE_MS + 1 })).toBe(false);
    });

    it('comes back once the 30 days are up', () => {
        expect(shouldShowInstallCard({ ...base, platform: 'installable', dismissedAt: NOW - INSTALL_CARD_SNOOZE_MS })).toBe(true);
        expect(shouldShowInstallCard({ ...base, platform: 'ios', dismissedAt: NOW - 90 * DAY })).toBe(true);
    });

    it('a dismissal stamped in the future (the clock moved back) does not hide it indefinitely', () => {
        expect(shouldShowInstallCard({ ...base, platform: 'ios', dismissedAt: NOW + 365 * DAY })).toBe(true);
    });

    it('a dismissal does not make it show where it otherwise would not', () => {
        expect(shouldShowInstallCard({ ...base, platform: 'none', dismissedAt: NOW - 90 * DAY })).toBe(false);
        expect(shouldShowInstallCard({ ...base, isStandalone: true, platform: 'ios', dismissedAt: NOW - 90 * DAY })).toBe(false);
    });
});

describe('parseDismissedAt — the stored «Ahora no» timestamp', () => {
    it('reads a stored millisecond timestamp', () => {
        expect(parseDismissedAt(String(NOW))).toBe(NOW);
    });

    it('nothing stored, or anything that is not a positive whole number, is «never dismissed»', () => {
        expect(parseDismissedAt(null)).toBeNull();
        expect(parseDismissedAt('')).toBeNull();
        expect(parseDismissedAt('abc')).toBeNull();
        expect(parseDismissedAt('12abc')).toBeNull();
        expect(parseDismissedAt('-5')).toBeNull();
        expect(parseDismissedAt('0')).toBeNull();
        expect(parseDismissedAt('1.5')).toBeNull();
        expect(parseDismissedAt('Infinity')).toBeNull();
    });
});

describe('installCardEventPlatform — the `platform` sent with install_card_action', () => {
    it('iOS is ios; an install prompt is android; nothing to install sends nothing', () => {
        expect(installCardEventPlatform('ios')).toBe('ios');
        expect(installCardEventPlatform('installable')).toBe('android');
        expect(installCardEventPlatform('none')).toBeNull();
    });
});
