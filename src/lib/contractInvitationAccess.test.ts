/**
 * The invitation gate with its real inputs: the applicants-panel predicate
 * (form_submissions rows) and resolveAdopterVisibility. Fake D1 below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getDbMock, orgMateMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), orgMateMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/config/admins', () => ({ isAdminAsync: vi.fn(async () => false), isModeratorOrAdminAsync: vi.fn(async () => false) }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: orgMateMock }));
vi.mock('@/app/actions/organizations', () => ({ getOrgMemberEmailsFor: vi.fn(async () => []) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { resolveInvitationAccess } from './contractInvitationAccess';
import { appConfig, formSubmissions } from '@/db/schema';

/** Every flag reads `flag`; form_submissions returns `submissions`; everything else is empty. */
function fakeDb(flag: string, submissions: Array<{ email: string | null; phone: string | null }>) {
    return {
        select: () => ({
            from: (table: unknown) => ({
                where: () => ({
                    get: async () => (table === appConfig ? { value: flag } : undefined),
                    all: async () => (table === formSubmissions ? submissions : []),
                    limit: async () => [],
                    then: (res: (v: unknown[]) => unknown) => Promise.resolve([]).then(res),
                }),
            }),
        }),
    };
}

const B = 'rescuer-b@example.com';
const foreign = { id: 'adopter-a', addedBy: 'rescuer-a@example.com', isPublic: 0 };

describe('resolveInvitationAccess', () => {
    beforeEach(() => {
        delete process.env.ENABLE_PII_ACCESS_GATING;
        delete process.env.ENABLE_PUBLIC_PROFILES;
        orgMateMock.mockReset();
        orgMateMock.mockResolvedValue(false);
    });

    it('foreign adopter who never applied for this animal: refused', async () => {
        const db = fakeDb('true', []);
        getDbMock.mockResolvedValue(db);
        const a = await resolveInvitationAccess(db as never, B, 'animal-1', foreign);
        expect(a.allowed).toBe(false);
        expect(a.via).toBeNull();
    });

    it('foreign adopter linked to B\'s form for this animal: allowed, not full access, with what she typed', async () => {
        const db = fakeDb('true', [{ email: 'nueva@example.com', phone: '11 5555-0109' }]);
        getDbMock.mockResolvedValue(db);
        const a = await resolveInvitationAccess(db as never, B, 'animal-1', foreign);
        expect(a).toMatchObject({ allowed: true, fullAccess: false, via: 'applicant' });
        expect(a.submitted).toEqual(['nueva@example.com', '11 5555-0109']);
    });

    it('B\'s own adopter: allowed with full access', async () => {
        const db = fakeDb('true', []);
        getDbMock.mockResolvedValue(db);
        const a = await resolveInvitationAccess(db as never, B, 'animal-1', { ...foreign, addedBy: B });
        expect(a).toMatchObject({ allowed: true, fullAccess: true, via: 'full_access' });
    });

    it('teammate\'s adopter: allowed with full access', async () => {
        orgMateMock.mockResolvedValue(true);
        const db = fakeDb('true', []);
        getDbMock.mockResolvedValue(db);
        const a = await resolveInvitationAccess(db as never, B, 'animal-1', foreign);
        expect(a).toMatchObject({ allowed: true, fullAccess: true });
    });

    it('gating off: a non-applicant foreign adopter is still refused', async () => {
        const db = fakeDb('false', []);
        getDbMock.mockResolvedValue(db);
        const a = await resolveInvitationAccess(db as never, B, 'animal-1', foreign);
        expect(a.allowed).toBe(false);
    });
});
