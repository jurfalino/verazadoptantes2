/**
 * «Al cambiar de grupos» (Jon, 2026-11-14 — spec 2026-11-13-group-branding-design.md):
 * joining / creating a group that leaves her in ≥ 2 asks which form and contract her
 * links use, and a never-chosen sole-group default is stored explicitly BEFORE the new
 * membership so closing the dialog keeps it. Leaving the group her links used (with a
 * group left) asks again. R17: no membership change switches her links silently — leaving or
 * being removed from the unused group of two keeps «Los míos». Real SQL; the session is the only actor.
 *
 * org-1 «Michis» = { OWNER }    org-2 «Perris» = { MATE }    STRANGER: no group
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER } = mocks;

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('@/config/features', () => ({ getFeatureFlag: vi.fn(async () => true) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { joinOrganization, createOrganization, leaveOrganization, removeOrganizationMember } from './organizations';
import { getEffectiveDocsSource, setDocsSourceIfStill } from '@/lib/adoptionDocsRepo';
import { logAudit } from '@/lib/audit';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] }; exec: (s: string) => void };
const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};
const USER_ID: Record<string, string> = { [OWNER]: 'u-owner', [MATE]: 'u-mate', [STRANGER]: 'u-stranger' };
const source = (email: string) => sqlite.prepare('SELECT adoption_docs_source AS s FROM user_profiles WHERE user_id = ?').get(USER_ID[email])?.s ?? null;
const setSource = (email: string, value: string | null) =>
    sqlite.prepare('INSERT INTO user_profiles (user_id, adoption_docs_source) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET adoption_docs_source = excluded.adoption_docs_source').run(USER_ID[email], value);
const keptAudits = () => vi.mocked(logAudit).mock.calls.filter(([e]) => e.action === 'adoption_docs_source_changed');
const flags = (on: Partial<Record<string, boolean>>) =>
    vi.mocked(getFeatureFlag).mockImplementation(async (f: string) => on[f] ?? true);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    vi.mocked(logAudit).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(getFeatureFlag).mockImplementation(async () => true);
    sqlite.prepare(`INSERT INTO user (id, email, name) VALUES ('u-owner', ?, 'Olga'), ('u-mate', ?, 'Mara'), ('u-stranger', ?, 'Sol')`).run(OWNER, MATE, STRANGER);
    sqlite.prepare(`INSERT INTO organizations (id, name, created_by) VALUES ('org-1', 'Michis', ?), ('org-2', 'Perris', ?)`).run(OWNER, MATE);
    sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('m-owner', 'org-1', ?, 'owner'), ('m-mate', 'org-2', ?, 'owner')`).run(OWNER, MATE);
    sqlite.prepare(`INSERT INTO org_invites (id, org_id, created_by) VALUES ('link-1', 'org-1', ?), ('link-2', 'org-2', ?)`).run(OWNER, MATE);
});

describe('joinOrganization', () => {
    it('never chosen + sole group: the group is kept explicitly (audited) before joining, and she is asked', async () => {
        expect(source(MATE)).toBeNull(); // no profile row at all
        expect(await as(MATE, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: true });
        expect(source(MATE)).toBe('org:org-2');
        expect(keptAudits()).toEqual([[{ userEmail: MATE, action: 'adoption_docs_source_changed', details: { source: 'org:org-2', reason: 'kept_on_join' } }]]);
    });

    it('an existing NULL profile row is filled the same way', async () => {
        setSource(MATE, null);
        await as(MATE, () => joinOrganization('link-1'));
        expect(source(MATE)).toBe('org:org-2');
    });

    it('an explicit choice is never touched, and she is still asked', async () => {
        for (const chosen of ['self', 'org:org-2']) {
            sqlite.prepare("DELETE FROM org_members WHERE org_id = 'org-1' AND user_email = ?").run(MATE);
            setSource(MATE, chosen);
            vi.mocked(logAudit).mockClear();
            expect(await as(MATE, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: true });
            expect(source(MATE)).toBe(chosen);
            expect(keptAudits()).toEqual([]);
        }
    });

    it('her first group: nothing pinned, not asked', async () => {
        expect(await as(STRANGER, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: false });
        expect(source(STRANGER)).toBeNull();
        expect(keptAudits()).toEqual([]);
    });

    it('group branding off: no default to keep, not asked', async () => {
        flags({ ENABLE_GROUP_BRANDING: false });
        expect(await as(MATE, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: false });
        expect(source(MATE)).toBeNull();
    });

    it('custom docs off: the default is still kept, but not asked (the setter would refuse)', async () => {
        flags({ ENABLE_CUSTOM_ADOPTION_DOCS: false });
        expect(await as(MATE, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: false });
        expect(source(MATE)).toBe('org:org-2');
    });

    it('already a member: nothing changes, not asked', async () => {
        const res = await as(OWNER, () => joinOrganization('link-1'));
        expect(res).toMatchObject({ success: true });
        expect(res.askDocsSource).toBeFalsy();
        expect(source(OWNER)).toBeNull();
    });

    it('a failed pin never fails the join: logged with context, joined, still asked', async () => {
        sqlite.exec(`CREATE TRIGGER no_profile_writes_u BEFORE UPDATE ON user_profiles BEGIN SELECT RAISE(ABORT, 'boom'); END;
                     CREATE TRIGGER no_profile_writes_i BEFORE INSERT ON user_profiles BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
        expect(await as(MATE, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: true });
        expect(sqlite.prepare("SELECT 1 FROM org_members WHERE org_id = 'org-1' AND user_email = ?").get(MATE)).toBeTruthy();
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('joinOrganization'), expect.objectContaining({ user: MATE, orgId: 'org-1', source: 'org:org-2' }));
        expect(keptAudits()).toEqual([]);
    });

    it('an unreadable source never fails the join: logged, joined, not asked', async () => {
        sqlite.exec('DROP TABLE user_profiles');
        expect(await as(MATE, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: false });
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('joinOrganization'), expect.objectContaining({ user: MATE, orgId: 'org-1' }));
    });
});

describe('createOrganization', () => {
    it('a second group: the sole-group default is kept and she is asked', async () => {
        const res = await as(OWNER, () => createOrganization('Gatos'));
        expect(res).toMatchObject({ success: true, askDocsSource: true });
        expect(source(OWNER)).toBe('org:org-1');
        expect(keptAudits()).toHaveLength(1);
    });

    it('her first group: nothing pinned, not asked', async () => {
        expect(await as(STRANGER, () => createOrganization('Gatos'))).toMatchObject({ success: true, askDocsSource: false });
        expect(source(STRANGER)).toBeNull();
    });
});

describe('leaveOrganization', () => {
    beforeEach(() => {
        // MATE is in both groups and her links use Michis.
        sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('m-mate-1', 'org-1', ?, 'member')`).run(MATE);
        setSource(MATE, 'org:org-1');
    });

    it('leaving the group her links used, with one left: asked; the stored group becomes «Los míos» (R18, audited)', async () => {
        expect(await as(MATE, () => leaveOrganization('org-1'))).toMatchObject({ success: true, deleted: false, askDocsSource: true });
        expect(source(MATE)).toBe('self');
        expect(keptAudits()).toEqual([[{ userEmail: MATE, action: 'adoption_docs_source_changed', details: { source: 'self', reason: 'left_group' } }]]);
    });

    it('R18 runs AFTER the delete: a failed leave leaves her stored group as it was', async () => {
        sqlite.exec(`CREATE TRIGGER no_member_deletes BEFORE DELETE ON org_members BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
        expect(await as(MATE, () => leaveOrganization('org-1'))).toMatchObject({ success: false });
        expect(source(MATE)).toBe('org:org-1');
        expect(keptAudits()).toEqual([]);
    });

    it('leaving another group: not asked, her choice untouched', async () => {
        expect(await as(MATE, () => leaveOrganization('org-2'))).toMatchObject({ success: true, askDocsSource: false });
        expect(source(MATE)).toBe('org:org-1');
        expect(keptAudits()).toEqual([]);
    });

    it('R18: after leaving the stored group, rejoining it as her only group stays «Los míos», not asked', async () => {
        await as(MATE, () => leaveOrganization('org-1'));
        await as(MATE, () => leaveOrganization('org-2')); // last member: Perris is deleted, she has no group
        expect(source(MATE)).toBe('self');
        expect(await as(MATE, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: false });
        expect(source(MATE)).toBe('self');
        expect((await getEffectiveDocsSource(state.db as never, MATE)).source).toEqual({ type: 'self' });
    });

    it('R18: removed by another member from her stored group → «Los míos» for the REMOVED person', async () => {
        expect(await as(OWNER, () => removeOrganizationMember('org-1', 'm-mate-1'))).toEqual({ success: true });
        expect(source(MATE)).toBe('self');
        expect(keptAudits()).toEqual([[{ userEmail: MATE, action: 'adoption_docs_source_changed', details: { source: 'self', reason: 'left_group', actorEmail: OWNER } }]]);
    });

    it('a group she had ALREADY left (stale stored value): rejoining it as her only group stays «Los míos», not asked', async () => {
        setSource(STRANGER, 'org:org-1'); // e.g. left before R18, or staging data
        expect(await as(STRANGER, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: false });
        expect(source(STRANGER)).toBe('self');
        expect((await getEffectiveDocsSource(state.db as never, STRANGER)).source).toEqual({ type: 'self' });
        expect(keptAudits()).toEqual([[{ userEmail: STRANGER, action: 'adoption_docs_source_changed', details: { source: 'self', reason: 'left_group' } }]]);
    });

    it('a stale stored group, rejoined ending in ≥ 2 groups: asked, with «Los míos» in effect (pre-selected), not the old group', async () => {
        sqlite.prepare("DELETE FROM org_members WHERE id = 'm-mate-1'").run(); // MATE: Perris only, stored Michis (stale)
        expect(await as(MATE, () => joinOrganization('link-1'))).toMatchObject({ success: true, askDocsSource: true });
        expect(source(MATE)).toBe('self');
        // What the dialog pre-selects (getAdoptionDocsOverview's source) is this effective source.
        expect((await getEffectiveDocsSource(state.db as never, MATE)).source).toEqual({ type: 'self' });
    });

    it('R18: a choice made in between is never overwritten (compare-and-set write)', async () => {
        setSource(MATE, 'org:org-2'); // changed after the action read 'org:org-1'
        expect(await setDocsSourceIfStill(state.db as never, MATE, 'org:org-1', 'self')).toBe(false);
        expect(source(MATE)).toBe('org:org-2');
        expect(await setDocsSourceIfStill(state.db as never, MATE, 'org:org-2', 'self')).toBe(true);
        expect(source(MATE)).toBe('self');
        expect(await setDocsSourceIfStill(state.db as never, MATE, null, 'org:org-1')).toBe(false); // not NULL any more
        expect(source(MATE)).toBe('self');
    });

    it('leaving her last group (deleting it): not asked', async () => {
        sqlite.prepare("DELETE FROM org_members WHERE org_id = 'org-2'").run();
        expect(await as(MATE, () => leaveOrganization('org-1'))).toMatchObject({ success: true, askDocsSource: false });
    });

    it('the sole-group default can never be asked on leave: leaving it leaves no group', async () => {
        // OWNER: NULL, only Michis → Michis by default. Leaving it deletes it (last member) and leaves her none.
        sqlite.prepare("DELETE FROM org_members WHERE org_id = 'org-1' AND user_email = ?").run(MATE);
        expect(await as(OWNER, () => leaveOrganization('org-1'))).toMatchObject({ success: true, deleted: true, askDocsSource: false });
    });

    it('flags off: never asked', async () => {
        flags({ ENABLE_CUSTOM_ADOPTION_DOCS: false });
        expect(await as(MATE, () => leaveOrganization('org-1'))).toMatchObject({ success: true, askDocsSource: false });
    });
});

describe('never switch silently on leave / removal (R17)', () => {
    /** What her public form and links use right now (the public form's own lookup). */
    const inEffect = async (email: string) => (await getEffectiveDocsSource(state.db as never, email)).source;

    beforeEach(() => {
        // MATE never chose and is in both groups → «Los míos» in effect.
        sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('m-mate-1', 'org-1', ?, 'member')`).run(MATE);
    });

    it('leaving the unused group 2 → 1 keeps «Los míos» (stored, audited), not asked', async () => {
        expect(await inEffect(MATE)).toEqual({ type: 'self' });
        expect(await as(MATE, () => leaveOrganization('org-1'))).toMatchObject({ success: true, deleted: false, askDocsSource: false });
        expect(source(MATE)).toBe('self');
        expect(await inEffect(MATE)).toEqual({ type: 'self' });
        expect(keptAudits()).toEqual([[{ userEmail: MATE, action: 'adoption_docs_source_changed', details: { source: 'self', reason: 'kept_on_leave' } }]]);
    });

    it('the same when the group she leaves is deleted (she was its last member)', async () => {
        expect(await as(MATE, () => leaveOrganization('org-2'))).toMatchObject({ success: true, deleted: true, askDocsSource: false });
        expect(source(MATE)).toBe('self');
        expect(await inEffect(MATE)).toEqual({ type: 'self' });
    });

    it('removed by another member 2 → 1: «Los míos» is kept for the REMOVED person (audited on her)', async () => {
        expect(await as(OWNER, () => removeOrganizationMember('org-1', 'm-mate-1'))).toEqual({ success: true });
        expect(source(MATE)).toBe('self');
        expect(source(OWNER)).toBeNull();
        expect(await inEffect(MATE)).toEqual({ type: 'self' });
        expect(keptAudits()).toEqual([[{ userEmail: MATE, action: 'adoption_docs_source_changed', details: { source: 'self', reason: 'kept_on_removal', actorEmail: OWNER } }]]);
    });

    it('removed from the sole group her links used 1 → 0: nothing stored', async () => {
        sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('m-stranger', 'org-1', ?, 'member')`).run(STRANGER);
        expect(await inEffect(STRANGER)).toEqual({ type: 'org', orgId: 'org-1' });
        expect(await as(OWNER, () => removeOrganizationMember('org-1', 'm-stranger'))).toEqual({ success: true });
        expect(source(STRANGER)).toBeNull();
        expect(keptAudits()).toEqual([]);
    });

    it('a failed keep never fails the removal: logged with context', async () => {
        sqlite.exec(`CREATE TRIGGER no_profile_writes_u BEFORE UPDATE ON user_profiles BEGIN SELECT RAISE(ABORT, 'boom'); END;
                     CREATE TRIGGER no_profile_writes_i BEFORE INSERT ON user_profiles BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
        expect(await as(OWNER, () => removeOrganizationMember('org-1', 'm-mate-1'))).toEqual({ success: true });
        expect(sqlite.prepare("SELECT 1 FROM org_members WHERE id = 'm-mate-1'").get()).toBeUndefined();
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('removeOrganizationMember'), expect.objectContaining({ user: OWNER, memberId: 'm-mate-1', orgId: 'org-1', source: 'self' }));
    });

    it('branding off: nothing stored', async () => {
        flags({ ENABLE_GROUP_BRANDING: false });
        await as(MATE, () => leaveOrganization('org-1'));
        expect(source(MATE)).toBeNull();
    });
});
