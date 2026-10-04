/**
 * A failed ENABLE_PII_ACCESS_GATING read must fail CLOSED (gating ON), so a
 * D1 blip masks contact data on the profile and the animal page instead of
 * unmasking it for everyone. Other flags keep falling back to their default.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getDbMock, warnMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), warnMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/logger', () => ({ logger: { warn: warnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// Server-only neighbours piiAccessServer imports; not exercised here.
vi.mock('@/config/admins', () => ({ isAdminAsync: vi.fn(), isModeratorOrAdminAsync: vi.fn() }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: vi.fn() }));
vi.mock('@/app/actions/organizations', () => ({ getOrgMemberEmailsFor: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { isPiiGatingEnabled } from './piiAccessServer';
import { getFeatureFlag } from '@/config/features';

/** A db whose app_config read resolves to `row`. */
function dbReturning(row: { value: string } | undefined) {
    return { select: () => ({ from: () => ({ where: () => ({ get: async () => row }) }) }) };
}

describe('PII gating flag read', () => {
    beforeEach(() => {
        delete process.env.ENABLE_PII_ACCESS_GATING;
        delete process.env.ENABLE_CHAT_WIDGET;
        getDbMock.mockReset();
        warnMock.mockReset();
    });

    it('D1 read error → gating treated as ON, and the failure is logged', async () => {
        getDbMock.mockRejectedValue(new Error('D1_ERROR: network'));
        await expect(isPiiGatingEnabled()).resolves.toBe(true);
        expect(warnMock).toHaveBeenCalledWith(
            'getFeatureFlag: DB read failed, using fallback',
            expect.objectContaining({ flag: 'ENABLE_PII_ACCESS_GATING', fallback: true }),
        );
    });

    it('query error (not just getDb) → also ON', async () => {
        getDbMock.mockResolvedValue({ select: () => { throw new Error('D1_ERROR: query'); } });
        await expect(isPiiGatingEnabled()).resolves.toBe(true);
    });

    it('a readable OFF row is honoured (no forced ON when the read works)', async () => {
        getDbMock.mockResolvedValue(dbReturning({ value: 'false' }));
        await expect(isPiiGatingEnabled()).resolves.toBe(false);
        expect(warnMock).not.toHaveBeenCalled();
    });

    it('no row → code default (OFF), not an error', async () => {
        getDbMock.mockResolvedValue(dbReturning(undefined));
        await expect(isPiiGatingEnabled()).resolves.toBe(false);
    });

    it('other flags still fall back to their default on a read error, logged', async () => {
        getDbMock.mockRejectedValue(new Error('D1_ERROR: network'));
        await expect(getFeatureFlag('ENABLE_CHAT_WIDGET')).resolves.toBe(false);
        expect(warnMock).toHaveBeenCalledWith(
            'getFeatureFlag: DB read failed, using fallback',
            expect.objectContaining({ flag: 'ENABLE_CHAT_WIDGET', fallback: false }),
        );
    });
});
