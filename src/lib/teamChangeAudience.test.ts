import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate: vi.fn() }));
import { keepChangeRecipients, type AudienceDeps } from './teamChangeAudience';

const deps = (mates: string[], team: string[], broken: string[] = []): AudienceDeps => ({
    isTeammate: async (r) => mates.includes(r),
    fromOf: async (r) => { if (broken.includes(r)) throw new Error('db down'); return team.includes(r) ? 'team' : 'outside'; },
});

describe('keepChangeRecipients', () => {
    it('an outsider\'s change reaches everyone but the actor', async () => {
        expect(await keepChangeRecipients(['owner@x', 'out@y', 'ed@z'], 'out@y', {}, deps([], []))).toEqual(['owner@x', 'ed@z']);
    });
    it('a teammate\'s change: only the teammates who chose «… y mi equipo», and everyone outside the team', async () => {
        const d = deps(['owner@x', 'mate2@x'], ['mate2@x']);
        expect(await keepChangeRecipients(['owner@x', 'mate2@x', 'admin@z', 'mate@x'], 'mate@x', {}, d)).toEqual(['mate2@x', 'admin@z']);
    });
    it('a choice that cannot be read tells the teammate (an extra notice, never a missed one)', async () => {
        expect(await keepChangeRecipients(['owner@x'], 'mate@x', {}, deps(['owner@x'], [], ['owner@x']))).toEqual(['owner@x']);
    });
    it('each recipient once, the actor never, case-insensitively', async () => {
        expect(await keepChangeRecipients(['Owner@x', 'owner@x ', 'MATE@x'], 'mate@x', {}, deps([], []))).toEqual(['Owner@x']);
    });
});
