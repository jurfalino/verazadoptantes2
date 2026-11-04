import { describe, it, expect, vi } from 'vitest';

const { run } = vi.hoisted(() => ({ run: vi.fn(async (..._a: unknown[]) => ({ results: [] })) }));
vi.mock('./findAdopters', () => ({ findAdopters: run }));
vi.mock('./_db', () => ({ getUser: async () => 'rescuer@example.com' }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { findAdopters } from './findAdoptersAction';

describe('findAdoptersAction (the browser door)', () => {
    it('never forwards a browser-supplied identity', async () => {
        await findAdopters({ raw: 'x' }, { mode: 'discovery', limit: 5, identity: { name: 'a', documentIds: ['30123456'] } });
        const opts = run.mock.calls[0][1] as unknown as Record<string, unknown>;
        expect(opts).not.toHaveProperty('identity');
        expect(opts).toMatchObject({ mode: 'discovery', limit: 5 });
    });
});
