/**
 * Final review I3: the notice for a saved API record is built inside the
 * background task, so a template that can't render (a null name) is logged
 * and never fails the call — the record is already saved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sent, errors } = vi.hoisted(() => ({
    sent: [] as Array<Record<string, unknown>>,
    errors: [] as Array<[string, unknown, Record<string, unknown>]>,
}));

vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { sent.push(d); return 'n'; }),
    notifyOrgMembers: vi.fn(async (d: Record<string, unknown>) => { sent.push(d); }),
}));
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
        error: vi.fn((m: string, e: unknown, ctx: Record<string, unknown>) => { errors.push([m, e, ctx]); return 'err12345'; }),
    },
    generateErrorId: () => 'gen12345',
}));

import { notifyApiRecord } from './records';

const KEY = { name: 'Catpuccino', ownerEmail: 'owner@example.com', importMode: null };
const REC = {
    requestId: 'req-1', profileId: 'p1', recordId: 'r1', activityType: 'adoption',
    personName: 'Ana Díaz', outcome: 'found' as const, rawOutcome: 'found', contactsAdded: ['phone'],
};

beforeEach(() => { sent.length = 0; errors.length = 0; });

describe('notifyApiRecord', () => {
    it('notifies the owner and their team', async () => {
        await notifyApiRecord(KEY, REC);
        expect(sent).toEqual([
            expect.objectContaining({ userId: KEY.ownerEmail, type: 'api_record', url: '/adopter/p1?record=r1' }),
            expect.objectContaining({ actorEmail: KEY.ownerEmail, type: 'api_record' }),
        ]);
        expect(errors).toEqual([]);
    });

    it('a null name: resolves (never throws), sends nothing, logs the failure with the record', async () => {
        await expect(notifyApiRecord(KEY, { ...REC, personName: null as unknown as string })).resolves.toBeUndefined();
        expect(sent).toEqual([]);
        expect(errors).toEqual([['background task failed: api.notifyRecord', expect.any(Error), expect.objectContaining({ requestId: 'req-1', recordId: 'r1' })]]);
    });

    it('a key in import mode notifies nobody', async () => {
        await notifyApiRecord({ ...KEY, importMode: Math.floor(Date.now() / 1000) + 3600 }, REC);
        expect(sent).toEqual([]);
    });
});
