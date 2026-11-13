/**
 * The invitation decision with its real inputs: the applicants-panel predicate
 * (form_submissions rows), resolveAdopterVisibility and the team rule. Fake D1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getDbMock, orgMateMock, ownerOrMateMock, adminMock, teamMock, flags } = vi.hoisted(() => ({
    getDbMock: vi.fn(), orgMateMock: vi.fn(), ownerOrMateMock: vi.fn(), adminMock: vi.fn(), teamMock: vi.fn(),
    flags: {} as Record<string, boolean>,
}));

// Flags are stubbed here: features.ts's own dynamic `import('@/lib/db')`, run
// twice concurrently under vitest, can resolve past the db mock to the real
// local sqlite. (Its read-error behaviour is covered in piiAccessServer.test.ts.)
vi.mock('@/config/features', () => ({ getFeatureFlag: vi.fn(async (flag: string) => !!flags[flag]) }));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/config/admins', () => ({ isAdminAsync: adminMock, isModeratorOrAdminAsync: adminMock }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: orgMateMock, isOwnerOrOrgMate: ownerOrMateMock, getOrgMemberEmailsFor: vi.fn(async () => []), getTeamEmails: teamMock }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { resolveInvitationAccess } from './contractInvitationAccess';
import { animals, appConfig, applications, piiAccessGrants } from '@/db/schema';

type Grant = { scope: string; entryRef: string | null; revokedAt: null };

/** Gating + public-profiles flags read `flag`; applications ⨝ form_submissions → `submissions`; pii_access_grants → `grants`. */
function fakeDb(
    flag: string,
    submissions: Array<{ email: string | null; phone: string | null }>,
    grants: Grant[] = [],
    /** null = no such animal. */
    animal: { addedBy: string; deletedAt: Date | null } | null = { addedBy: 'rescuer-b@example.com', deletedAt: null },
) {
    return {
        flag,
        select: () => ({
            from: (table: unknown) => {
                const where = () => {
                    const rows = table === piiAccessGrants ? grants : [];
                    return {
                        get: async () => (table === appConfig ? { value: flag } : table === animals ? (animal ?? undefined) : undefined),
                        all: async () => (table === applications ? submissions : []),
                        limit: async () => [],
                        then: (res: (v: unknown[]) => unknown) => Promise.resolve(rows).then(res),
                    };
                };
                return { where, innerJoin: () => ({ where }) };
            },
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
        // The animal owner's team: the applicant scope (src/lib/applicantScope.ts).
        teamMock.mockReset().mockResolvedValue([B, 'teammate@example.com']);
    });

    it('applicant scope is the ANIMAL OWNER\'s team: an empty team or a deleted animal is no applicant (fail closed)', async () => {
        teamMock.mockResolvedValue([]);
        expect((await run(fakeDb('true', applied))).allowed).toBe(false);
        teamMock.mockResolvedValue([B]);
        expect((await run(fakeDb('true', applied, [], { addedBy: B, deletedAt: new Date() }))).allowed).toBe(false);
        expect((await run(fakeDb('true', applied, [], null))).allowed).toBe(false);
        // Sanity: the same applicant with a live animal in the team IS allowed.
        expect((await run(fakeDb('true', applied))).allowed).toBe(true);
    });

    it('a person proposed for the animal counts as an applicant', async () => {
        // A proposed application is an `applications` row like any other: the join returns it.
        const a = await run(fakeDb('true', [{ email: 'propuesta@example.com', phone: null }]));
        expect(a).toMatchObject({ allowed: true, via: 'applicant' });
        expect(a.submitted).toEqual(['propuesta@example.com']);
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

describe('resolveInvitationAccess on the real schema (proposed / forged / replaced)', () => {
    // migratedDb is the SYNC better-sqlite3 driver; D1 returns promises and callers chain .catch on them.
    function asyncDb<T extends object>(target: T): T {
        return new Proxy(target, {
            get(t, p, r) {
                const v = Reflect.get(t, p, r);
                if (typeof v !== 'function') return v;
                return (...args: unknown[]) => {
                    const out = (v as (...a: unknown[]) => unknown).apply(t, args);
                    if (p === 'get' || p === 'all' || p === 'run' || p === 'values') return Promise.resolve(out);
                    return out && typeof out === 'object' && p !== 'then' ? asyncDb(out as object) : out;
                };
            },
        });
    }

    beforeEach(() => {
        orgMateMock.mockReset().mockResolvedValue(false);
        ownerOrMateMock.mockReset().mockResolvedValue(false);
        adminMock.mockReset().mockResolvedValue(false);
        teamMock.mockReset().mockResolvedValue([B, 'teammate@example.com']);
    });

    async function access(rows: Array<{ id: string; userId: string; origin?: string; state?: string; animal?: string | null }>) {
        const { migratedDb } = await import('@/test-utils/migratedDb');
        const m = migratedDb();
        const db = asyncDb(m.db);
        m.sqlite.prepare("INSERT INTO animals (id, name, added_by, created_at, updated_at) VALUES ('animal-1', 'Luna', ?, 1, 1)").run(B);
        for (const r of rows) {
            m.sqlite.prepare('INSERT INTO form_submissions (id, user_id, name, email, linked_adopter_id, created_at) VALUES (?, ?, ?, ?, ?, 1700000000)')
                .run(r.id, r.userId, r.id, `${r.id}@example.com`, 'adopter-a');
            m.sqlite.prepare('INSERT INTO applications (id, submission_id, animal_id, origin, state) VALUES (?, ?, ?, ?, ?)')
                .run(`app-${r.id}`, r.id, r.animal === undefined ? 'animal-1' : r.animal, r.origin ?? 'form', r.state ?? 'open');
        }
        getDbMock.mockResolvedValue(db);
        flags.ENABLE_PII_ACCESS_GATING = true;
        flags.ENABLE_PUBLIC_PROFILES = true;
        return resolveInvitationAccess(db as never, B, 'animal-1', foreign);
    }

    it('a person proposed for the animal (team link, origin proposed) is an applicant', async () => {
        const a = await access([{ id: 's1', userId: B, origin: 'proposed' }]);
        expect(a).toMatchObject({ allowed: true, via: 'applicant' });
        expect(a.submitted).toEqual(['s1@example.com']);
    });

    it('a forged row through an outsider\'s link is refused', async () => {
        expect((await access([{ id: 's2', userId: 'stranger@example.com' }])).allowed).toBe(false);
    });

    it('a replaced application is refused', async () => {
        expect((await access([{ id: 's3', userId: B, state: 'replaced' }])).allowed).toBe(false);
    });

    it('an application for another animal is refused', async () => {
        expect((await access([{ id: 's4', userId: B, animal: 'animal-2' }])).allowed).toBe(false);
    });
});
