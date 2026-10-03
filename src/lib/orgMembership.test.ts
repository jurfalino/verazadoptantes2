import { describe, it, expect, vi } from 'vitest';

const rejecting = {
    select: () => ({ from: () => ({ where: () => Promise.reject(new Error('D1 down')) }) }),
};
vi.mock('@/lib/db', () => ({ getDb: async () => rejecting }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { isOrgMate, isOrgMateStrict } from './orgMembership';
import { logger } from '@/lib/logger';

describe('isOrgMate vs isOrgMateStrict on a DB failure', () => {
    it('strict rejects', async () => {
        await expect(isOrgMateStrict('viewer@x.com', 'owner.person@x.com')).rejects.toThrow('D1 down');
    });
    it('wrapper fails closed and masks the owner email in the log', async () => {
        await expect(isOrgMate('viewer@x.com', 'owner.person@x.com')).resolves.toBe(false);
        const ctx = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0][1];
        expect(JSON.stringify(ctx)).not.toContain('owner.person@x.com');
    });
    it('strict short-circuits equal / empty emails without touching the DB', async () => {
        await expect(isOrgMateStrict('viewer@x.com', 'VIEWER@x.com')).resolves.toBe(false);
        await expect(isOrgMateStrict('', 'owner.person@x.com')).resolves.toBe(false);
    });
});
