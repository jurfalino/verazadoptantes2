/**
 * A failed ENABLE_PII_ACCESS_GATING read must fail CLOSED (gating ON), so a
 * D1 blip masks contact data on the profile and the animal page instead of
 * unmasking it for everyone. Other flags keep falling back to their default.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getDbMock, warnMock, orgMatesMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), warnMock: vi.fn(), orgMatesMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/logger', () => ({ logger: { warn: warnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// Server-only neighbours piiAccessServer imports; not exercised here.
vi.mock('@/config/admins', () => ({ isAdminAsync: vi.fn(async () => false), isModeratorOrAdminAsync: vi.fn(async () => false) }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: vi.fn(), getOrgMemberEmailsFor: orgMatesMock }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { isPiiGatingEnabled, maskMatchCardsForViewer, type MatchCardProfileRow } from './piiAccessServer';
import { appConfig } from '@/db/schema';
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

/**
 * A fake D1 for the match-card path: every app_config flag reads `flagValue`
 * (or the read throws), and every other table (editor history, grants) is empty.
 */
function fakeDb(flagValue: string | Error) {
    return {
        select: () => ({
            from: (table: unknown) => ({
                where: () => {
                    const rows: unknown[] = [];
                    return {
                        get: async () => {
                            if (table === appConfig) {
                                if (flagValue instanceof Error) throw flagValue;
                                return { value: flagValue };
                            }
                            return undefined;
                        },
                        limit: async () => rows,
                        then: (res: (v: unknown[]) => unknown) => Promise.resolve(rows).then(res),
                    };
                },
            }),
        }),
        selectDistinct: () => ({ from: () => ({ where: async () => [] }) }),
    };
}

describe('maskMatchCardsForViewer — B\'s form matching A\'s protected profile', () => {
    const PHONE = '+54 9 11 5555-0109';
    const OTHER_EMAIL = 'carla.privada@example.com';
    const row: MatchCardProfileRow = {
        id: 'adopter-a', addedBy: 'rescuer-a@example.com', isPublic: 0,
        contactEntries: JSON.stringify([
            { type: 'phone', value: PHONE },
            { type: 'email', value: OTHER_EMAIL },
            { type: 'address', value: 'Calle Secreta 1234, Flores, CABA' },
        ]),
        contactInfo: `Tel: ${PHONE}\nEmail: ${OTHER_EMAIL}`,
        addressInfo: 'Calle Secreta 1234, Flores, CABA',
    };
    const submitted = ['11 5555-0109', 'nueva@example.com'];

    beforeEach(() => {
        delete process.env.ENABLE_PII_ACCESS_GATING;
        delete process.env.ENABLE_PUBLIC_PROFILES;
        getDbMock.mockReset();
        warnMock.mockReset();
        orgMatesMock.mockReset();
        orgMatesMock.mockResolvedValue([]);
    });

    it('gating ON, another rescuer: only the phone B\'s applicant typed is shown in full', async () => {
        getDbMock.mockResolvedValue(fakeDb('true'));
        const r = (await maskMatchCardsForViewer('rescuer-b@example.com', [row], submitted)).get('adopter-a')!;
        expect(Object.keys(r).sort()).toEqual(['addressInfo', 'contactInfo']);
        expect(r.contactInfo).toContain(PHONE);
        expect(r.contactInfo).not.toContain(OTHER_EMAIL);
        expect(r.addressInfo).not.toContain('Secreta');
    });

    it('gating ON, the owner: everything', async () => {
        getDbMock.mockResolvedValue(fakeDb('true'));
        const r = (await maskMatchCardsForViewer('rescuer-a@example.com', [row], submitted)).get('adopter-a')!;
        expect(r).toEqual({ contactInfo: row.contactInfo, addressInfo: row.addressInfo });
    });

    it('gating flag unreadable: treated as ON, still masked', async () => {
        getDbMock.mockResolvedValue(fakeDb(new Error('D1_ERROR: network')));
        const r = (await maskMatchCardsForViewer('rescuer-b@example.com', [row], submitted)).get('adopter-a')!;
        expect(r.contactInfo).not.toContain(OTHER_EMAIL);
        expect(r.addressInfo).not.toContain('Secreta');
    });

    it('visibility resolution throwing: masked, never raw', async () => {
        getDbMock.mockResolvedValue(fakeDb('true'));
        orgMatesMock.mockRejectedValue(new Error('D1_ERROR: org lookup'));
        const r = (await maskMatchCardsForViewer('rescuer-a@example.com', [row], submitted)).get('adopter-a')!;
        expect(r.contactInfo).not.toContain(OTHER_EMAIL);
        expect(r.addressInfo).not.toContain('Secreta');
    });

    it('gating OFF: raw, as on the profile page and in search', async () => {
        getDbMock.mockResolvedValue(fakeDb('false'));
        const r = (await maskMatchCardsForViewer('rescuer-b@example.com', [row], submitted)).get('adopter-a')!;
        expect(r).toEqual({ contactInfo: row.contactInfo, addressInfo: row.addressInfo });
    });
});
