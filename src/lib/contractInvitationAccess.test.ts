/**
 * The invitation decision with its real inputs: the applicants-panel predicate
 * (form_submissions rows), resolveAdopterVisibility and the team rule. Fake D1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getDbMock, orgMateMock, ownerOrMateMock, adminMock, flags } = vi.hoisted(() => ({
    getDbMock: vi.fn(), orgMateMock: vi.fn(), ownerOrMateMock: vi.fn(), adminMock: vi.fn(),
    flags: {} as Record<string, boolean>,
}));

// Flags are stubbed here: features.ts's own dynamic `import('@/lib/db')`, run
// twice concurrently under vitest, can resolve past the db mock to the real
// local sqlite. (Its read-error behaviour is covered in piiAccessServer.test.ts.)
vi.mock('@/config/features', () => ({ getFeatureFlag: vi.fn(async (flag: string) => !!flags[flag]) }));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/config/admins', () => ({ isAdminAsync: adminMock, isModeratorOrAdminAsync: adminMock }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: orgMateMock, isOwnerOrOrgMate: ownerOrMateMock, getOrgMemberEmailsFor: vi.fn(async () => []) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { resolveInvitationAccess } from './contractInvitationAccess';
import { appConfig, formSubmissions, piiAccessGrants } from '@/db/schema';

type Grant = { scope: string; entryRef: string | null; revokedAt: null };

/** Gating + public-profiles flags read `flag`; form_submissions → `submissions`; pii_access_grants → `grants`. */
function fakeDb(flag: string, submissions: Array<{ email: string | null; phone: string | null }>, grants: Grant[] = []) {
    return {
        flag,
        select: () => ({
            from: (table: unknown) => ({
                where: () => {
                    const rows = table === piiAccessGrants ? grants : [];
                    return {
                        get: async () => (table === appConfig ? { value: flag } : undefined),
                        all: async () => (table === formSubmissions ? submissions : []),
                        limit: async () => [],
                        then: (res: (v: unknown[]) => unknown) => Promise.resolve(rows).then(res),
                    };
                },
            }),
        }),
    };
}

const B = 'rescuer-b@example.com';
const foreign = { id: 'adopter-a', addedBy: 'rescuer-a@example.com', isPublic: 0 };
const applied = [{ email: 'nueva@example.com', phone: '11 5555-0109' }];

async function run(db: ReturnType<typeof fakeDb>, adopter = foreign) {
    getDbMock.mockResolvedValue(db);
    flags.ENABLE_PII_ACCESS_GATING = db.flag === 'true';
    flags.ENABLE_PUBLIC_PROFILES = true;
    return resolveInvitationAccess(db as never, B, 'animal-1', adopter);
}

describe('resolveInvitationAccess', () => {
    beforeEach(() => {
        delete process.env.ENABLE_PII_ACCESS_GATING;
        delete process.env.ENABLE_PUBLIC_PROFILES;
        orgMateMock.mockReset().mockResolvedValue(false);
        ownerOrMateMock.mockReset().mockResolvedValue(false);
        adminMock.mockReset().mockResolvedValue(false);
    });

    it('foreign adopter who never applied for this animal: refused', async () => {
        const a = await run(fakeDb('true', []));
        expect(a.allowed).toBe(false);
        expect(a.via).toBeNull();
    });

    it('gating off: a non-applicant foreign adopter is still refused', async () => {
        expect((await run(fakeDb('false', []))).allowed).toBe(false);
    });

    it('applicant merged into A\'s profile: allowed with what she typed; signing merges', async () => {
        const a = await run(fakeDb('true', applied));
        expect(a).toMatchObject({ allowed: true, fullAccess: false, overwriteOnSign: false, via: 'applicant' });
        expect(a.submitted).toEqual(['nueva@example.com', '11 5555-0109']);
    });

    it('B\'s own adopter: full access and overwrite', async () => {
        ownerOrMateMock.mockResolvedValue(true);
        const a = await run(fakeDb('true', []), { ...foreign, addedBy: B });
        expect(a).toMatchObject({ allowed: true, fullAccess: true, overwriteOnSign: true, via: 'full_access' });
    });

    it('teammate\'s adopter: full access and overwrite', async () => {
        orgMateMock.mockResolvedValue(true);
        ownerOrMateMock.mockResolvedValue(true);
        expect(await run(fakeDb('true', []))).toMatchObject({ allowed: true, fullAccess: true, overwriteOnSign: true });
    });

    it('admin / moderator on a foreign adopter: full access, but signing merges', async () => {
        adminMock.mockResolvedValue(true);
        expect(await run(fakeDb('true', []))).toMatchObject({ allowed: true, fullAccess: true, overwriteOnSign: false });
    });

    it('approved full-contact grant holder: full access, but signing merges', async () => {
        const grants: Grant[] = [{ scope: 'all_contact', entryRef: null, revokedAt: null }];
        expect(await run(fakeDb('true', [], grants))).toMatchObject({ allowed: true, fullAccess: true, overwriteOnSign: false });
    });

    it('public profile (applicant): full access for the pre-fill, signing merges', async () => {
        expect(await run(fakeDb('true', applied), { ...foreign, isPublic: 1 }))
            .toMatchObject({ allowed: true, fullAccess: true, overwriteOnSign: false });
    });

    it('gating off (applicant): full access for the pre-fill, signing merges', async () => {
        expect(await run(fakeDb('false', applied))).toMatchObject({ allowed: true, fullAccess: true, overwriteOnSign: false });
    });
});
