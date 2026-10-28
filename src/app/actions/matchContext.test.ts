/**
 * getMatchContext's opt-in standing (audit B6): the post import's match cards
 * show the matched person's own rating / alerts or «Menor de edad», like every
 * other match card. Off by default (MatchCompare asks only for `has`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, user: 'rescuer@example.com' } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: async () => state.user }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') }, generateErrorId: () => 'gen12345' }));

import { getMatchContext } from './matchContext';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => Row | undefined } };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    state.user = 'rescuer@example.com';
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, is_minor) VALUES ('lucas', 'Lucas', '5', 'o@example.com', 1), ('pedro', 'Pedro', '5', 'o@example.com', 0)`).run();
    sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, rating) VALUES ('r1', 'pedro', 'observation', 2)`).run();
    sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, created_at) VALUES ('f1', 'pedro', 'o@example.com', 'inaccurate_information', 1)`).run();
});

describe('getMatchContext — standing', () => {
    it('only when asked', async () => {
        expect((await getMatchContext('pedro')).standing).toBeUndefined();
    });
    it('an adult: their rating and open alerts; a minor: «Menor de edad»', async () => {
        expect((await getMatchContext('pedro', { standing: true })).standing).toMatchObject({ rating: 2, openAlerts: ['inaccurate'], isMinor: false, households: [] });
        expect((await getMatchContext('lucas', { standing: true })).standing).toMatchObject({ isMinor: true });
    });
    it('signed out: nothing', async () => {
        state.user = '';
        expect(await getMatchContext('pedro', { standing: true })).toMatchObject({ ok: false });
        expect((await getMatchContext('pedro', { standing: true })).standing).toBeUndefined();
    });
});
