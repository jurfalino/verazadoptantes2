/**
 * createNotification with a template (D38): the row stores the Spanish render
 * as title/body and the template in metadata, next to the caller's metadata;
 * the email twin receives the same metadata.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state, emails, warns } = vi.hoisted(() => ({
    state: { db: null as unknown },
    emails: [] as Array<Record<string, unknown>>,
    warns: [] as Array<[string, Record<string, unknown>]>,
}));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => true }));
vi.mock('@/lib/background', () => ({ runAfterResponse: async (_l: string, fn: () => Promise<unknown>) => { await fn(); } }));
vi.mock('@/lib/notificationEmail', () => ({ sendNotificationEmail: vi.fn(async (n: Record<string, unknown>) => { emails.push(n); return 'sent'; }) }));
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn((m: string, ctx: Record<string, unknown>) => { warns.push([m, ctx]); }),
        info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345'),
    },
}));

import { createNotification } from './notifications';
import { notificationContent } from '@/domain/notificationTemplates';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined } };
let sqlite: Sqlite;
const row = (id: string) => sqlite.prepare('SELECT title, body, metadata FROM notifications WHERE id = ?').get(id)!;

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    emails.length = 0;
    warns.length = 0;
});

describe('createNotification with a template', () => {
    it('stores the Spanish render and the template beside the caller\'s metadata', async () => {
        const content = notificationContent({ key: 'pair_message', params: { fromName: 'Jon', profileName: 'Carla', message: 'Hola' } });
        const id = await createNotification({ userId: 'a@example.com', type: 'pair_message', ...content, metadata: { replyTo: 'jon@example.com' } });
        const r = row(id!);
        expect(r).toMatchObject({ title: 'Jon te escribió sobre «Carla»', body: 'Hola' });
        expect(JSON.parse(r.metadata as string)).toEqual({ replyTo: 'jon@example.com', template: content.template });
        expect(emails[0]).toMatchObject({ title: 'Jon te escribió sobre «Carla»', metadata: { replyTo: 'jon@example.com', template: content.template } });
    });

    it('a template that does not render keeps the passed text and warns', async () => {
        const id = await createNotification({
            userId: 'a@example.com', type: 'member_joined', title: 'T', body: 'B',
            // A call-site bug: a required param missing at runtime.
            template: { key: 'member_joined', params: {} as { memberName: string } },
        });
        expect(row(id!)).toMatchObject({ title: 'T', body: 'B' });
        expect(warns.some(([m, ctx]) => m.includes('template did not render') && ctx.key === 'member_joined')).toBe(true);
    });

    it('without a template nothing changes', async () => {
        const id = await createNotification({ userId: 'a@example.com', type: 'system', title: 'T', body: 'B', metadata: { a: 1 } });
        expect(row(id!)).toMatchObject({ title: 'T', body: 'B', metadata: JSON.stringify({ a: 1 }) });
    });
});
