/**
 * The per-type kill switch (`app_config` row `NOTIF_ENABLED_<type>`), read the
 * same way by createNotification, the admin notifications page and the
 * follow-up cron Worker: no row means on, only an explicit 'false' turns it off.
 */
import { describe, it, expect } from 'vitest';
import { notificationTypeEnabled, notificationKillSwitchKey } from './notificationKillSwitch';

describe('notificationTypeEnabled', () => {
    it('no row is on', () => {
        expect(notificationTypeEnabled(undefined)).toBe(true);
        expect(notificationTypeEnabled(null)).toBe(true);
    });
    it("only an explicit 'false' turns it off", () => {
        expect(notificationTypeEnabled('false')).toBe(false);
        expect(notificationTypeEnabled('true')).toBe(true);
        expect(notificationTypeEnabled('')).toBe(true);
        expect(notificationTypeEnabled('anything')).toBe(true);
    });
    it('the key the admin page writes', () => {
        expect(notificationKillSwitchKey('follow_up_due')).toBe('NOTIF_ENABLED_follow_up_due');
    });
});
