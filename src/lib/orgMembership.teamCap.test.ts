import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * getTeamEmails caps a team at 30 emails (self + 29 mates). That cap silently
 * drops applicants and animals of members #31+, so a truncation must at least
 * leave a trace in the logs. The cap itself is unchanged.
 *
 * The fake db answers the three shapes getOrgMatesOf/getOrgsForEmail use:
 *   org_members by email   → awaited builder  → one membership row
 *   organizations by id    → .get()           → the org
 *   org_members by org id  → .all()           → MEMBERS
 */
let MEMBERS: Array<{ userEmail: string }> = [];
const query = {
    from: () => query,
    where: () => query,
    then: (resolve: (rows: unknown) => unknown) => resolve([{ orgId: 'org-1', joinedAt: null }]),
    get: async () => ({ id: 'org-1', name: 'Refugio', slug: null }),
    all: async () => MEMBERS,
};
const fakeDb = { select: () => query };
vi.mock('@/lib/db', () => ({ getDb: async () => fakeDb }));

const warn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { getTeamEmails } from './orgMembership';

const members = (n: number) => Array.from({ length: n }, (_, i) => ({ userEmail: `mate${i}@example.com` }));

beforeEach(() => { warn.mockClear(); });

describe('getTeamEmails cap', () => {
    it('returns self + mates without a warning when under the cap', async () => {
        MEMBERS = [{ userEmail: 'owner@example.com' }, ...members(5)];
        const team = await getTeamEmails('Owner@Example.com');
        expect(team).toHaveLength(6);
        expect(team[0]).toBe('owner@example.com');
        expect(warn).not.toHaveBeenCalled();
    });

    it('keeps the 30-email cap but logs the truncation with the email and team size', async () => {
        MEMBERS = [{ userEmail: 'owner@example.com' }, ...members(40)];
        const team = await getTeamEmails('owner@example.com');
        expect(team).toHaveLength(30);
        expect(warn).toHaveBeenCalledTimes(1);
        const [message, ctx] = warn.mock.calls[0] as [string, Record<string, unknown>];
        expect(message).toMatch(/truncat/i);
        expect(ctx).toMatchObject({ email: 'owner@example.com', teamSize: 41, cap: 30 });
    });

    it('exactly at the cap is not a truncation', async () => {
        MEMBERS = [{ userEmail: 'owner@example.com' }, ...members(29)];
        expect(await getTeamEmails('owner@example.com')).toHaveLength(30);
        expect(warn).not.toHaveBeenCalled();
    });
});
