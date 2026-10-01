import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { resolveViewAs, type ViewAsDeps, type ViewAsTarget } from './viewAsSession';
import { VIEW_AS_MAX_MS } from '@/domain/viewAs';

const NOW = 1_800_000_000_000;
const ADMIN = 'admin@example.org';
const OTHER_ADMIN = 'other-admin@example.org';
const MARIA: ViewAsTarget = { id: 'u-maria', email: 'maria@example.org', name: 'María', image: null };
const BOSS: ViewAsTarget = { id: 'u-boss', email: OTHER_ADMIN, name: 'Boss', image: null };

function deps(overrides: Partial<ViewAsDeps> = {}) {
    const recorded: string[] = [];
    const d: ViewAsDeps = {
        now: () => NOW,
        isAdmin: async (email) => email === ADMIN || email === OTHER_ADMIN,
        findUser: async (id) => [MARIA, BOSS].find(u => u.id === id) ?? null,
        record: async (e) => { recorded.push(`${e.action}:${e.actorEmail}`); return true; },
        ...overrides,
    };
    return { d, recorded };
}

const viewingMaria = (startedAt = NOW - 1000) => ({ userId: MARIA.id, email: MARIA.email, name: MARIA.name, image: null, startedAt });

describe('resolveViewAs — start', () => {
    it('an admin starts viewing a regular user; the claim is recorded first', async () => {
        const { d, recorded } = deps();
        const token: Record<string, unknown> = { email: ADMIN, sub: 'u-admin' };
        const claim = await resolveViewAs(token, 'update', { viewAs: { userId: MARIA.id } }, d);
        expect(claim).toMatchObject({ userId: MARIA.id, email: MARIA.email, startedAt: NOW });
        expect(token.viewAs).toEqual(claim);
        expect(token.email).toBe(ADMIN); // the admin's own identity is never overwritten
        expect(recorded).toEqual([`view_as_start:${ADMIN}`]);
    });

    it('a non-admin sending the same update from the browser gets nothing', async () => {
        const { d, recorded } = deps();
        const token: Record<string, unknown> = { email: 'rescuer@example.org' };
        expect(await resolveViewAs(token, 'update', { viewAs: { userId: MARIA.id } }, d)).toBeNull();
        expect(token).toEqual({ email: 'rescuer@example.org' });
        expect(recorded).toEqual([]);
    });

    it('an admin cannot view as another admin', async () => {
        const { d } = deps();
        const token: Record<string, unknown> = { email: ADMIN };
        expect(await resolveViewAs(token, 'update', { viewAs: { userId: BOSS.id } }, d)).toBeNull();
        expect(token.viewAs).toBeUndefined();
    });

    it('a start request outside an update is ignored', async () => {
        const { d } = deps();
        const token: Record<string, unknown> = { email: ADMIN };
        expect(await resolveViewAs(token, undefined, { viewAs: { userId: MARIA.id } }, d)).toBeNull();
        expect(token.viewAs).toBeUndefined();
    });

    it('no audit row, no viewing', async () => {
        const { d } = deps({ record: async () => false });
        const token: Record<string, unknown> = { email: ADMIN };
        expect(await resolveViewAs(token, 'update', { viewAs: { userId: MARIA.id } }, d)).toBeNull();
        expect(token.viewAs).toBeUndefined();
    });
});

describe('resolveViewAs — while viewing', () => {
    it('keeps a valid claim while the actor is still an admin', async () => {
        const { d, recorded } = deps();
        const token: Record<string, unknown> = { email: ADMIN, viewAs: viewingMaria() };
        expect(await resolveViewAs(token, undefined, undefined, d)).toEqual(viewingMaria());
        expect(recorded).toEqual([]);
    });

    it('drops the claim the moment the actor stops being an admin', async () => {
        const { d } = deps({ isAdmin: async () => false });
        const token: Record<string, unknown> = { email: ADMIN, viewAs: viewingMaria() };
        expect(await resolveViewAs(token, undefined, undefined, d)).toBeNull();
        expect(token.viewAs).toBeUndefined();
    });

    it('drops an expired claim', async () => {
        const { d } = deps();
        const token: Record<string, unknown> = { email: ADMIN, viewAs: viewingMaria(NOW - VIEW_AS_MAX_MS) };
        expect(await resolveViewAs(token, undefined, undefined, d)).toBeNull();
        expect(token.viewAs).toBeUndefined();
    });

    it('other session updates leave the claim alone', async () => {
        const { d } = deps();
        const token: Record<string, unknown> = { email: ADMIN, viewAs: viewingMaria() };
        expect(await resolveViewAs(token, 'update', { name: 'x' }, d)).toEqual(viewingMaria());
    });

    it('stop clears the claim and records it', async () => {
        const { d, recorded } = deps();
        const token: Record<string, unknown> = { email: ADMIN, viewAs: viewingMaria() };
        expect(await resolveViewAs(token, 'update', { viewAs: null }, d)).toBeNull();
        expect(token.viewAs).toBeUndefined();
        expect(recorded).toEqual([`view_as_stop:${ADMIN}`]);
    });
});
