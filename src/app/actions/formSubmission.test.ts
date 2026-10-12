import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * linkFormSubmissionToAdopter («Vincular» on /form-results, and the
 * create-from-form flow).
 * - WHO: the shared form-submission access rule (form-link owner's team, an
 *   admin, or the animal owner's team) — so a teammate's «Vincular» works.
 * - WHAT: staging's rule (canLinkSubmissionDirectly) — a live target that is a
 *   match recorded at submit time, or one the caller fully sees. The recorded
 *   matches come from the FORM-LINK OWNER's notification (a teammate's copy
 *   carries none).
 * - The UPDATE is keyed by id (never `user_id = viewer`, which would no-op for
 *   a teammate) and only takes an unlinked form.
 */

const dialect = new SQLiteSyncDialect();
const OWNER = 'owner@example.com';
const VIEWER = 'vero@example.com';
const state = {
    allowed: true,
    fullySees: false,
    recordedMatches: ['ad-1'] as string[],
    adopter: { id: 'ad-1', addedBy: 'other@example.com', deletedAt: null as Date | null } as { id: string; addedBy: string; deletedAt: Date | null } | undefined,
    notifWhere: [] as Array<{ sql: string; params: unknown[] }>,
    updates: [] as Array<{ set: Record<string, unknown>; where: { sql: string; params: unknown[] } }>,
};

const fakeDb = {
    select: () => {
        let table = '';
        let where: SQL | undefined;
        const q = {
            from: (t: { [k: symbol]: unknown }) => {
                table = String((t as unknown as Record<symbol, string>)[Symbol.for('drizzle:Name')]);
                return q;
            },
            where: (cond: SQL) => { where = cond; return q; },
            get: async () => {
                if (table === 'form_submissions') return { userId: OWNER, selectedAnimalId: null };
                if (table === 'adopters') return state.adopter;
                if (table === 'notifications') {
                    if (where) state.notifWhere.push(dialect.sqlToQuery(where));
                    return { metadata: JSON.stringify({ matchedAdopters: state.recordedMatches.map(id => ({ id })) }) };
                }
                return undefined;
            },
        };
        return q;
    },
    update: () => ({
        set: (set: Record<string, unknown>) => ({
            where: (cond: SQL) => ({
                returning: async () => {
                    state.updates.push({ set, where: dialect.sqlToQuery(cond) });
                    return [{ id: 'sub-1' }];
                },
            }),
        }),
    }),
};

vi.mock('./_db', () => ({ getDb: async () => fakeDb, getUser: async () => VIEWER }));
vi.mock('./_applicants', () => ({ canAccessFormSubmission: vi.fn(async () => state.allowed) }));
vi.mock('@/lib/piiAccessServer', () => ({ resolveAdopterVisibility: vi.fn(async () => ({ nothingMasked: state.fullySees })) }));
vi.mock('@/lib/formRequest', () => ({ addFormRequestRecord: vi.fn(async () => undefined), SPECIES_LABELS: {}, LIFE_STAGE_LABELS: {}, INTENT_LABELS: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/adopterMerge', () => ({ mergeAdopters: vi.fn() }));
vi.mock('./notifications', () => ({ createNotification: vi.fn(), resolveDisplayName: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(() => 'errid123'), debug: vi.fn() }, generateErrorId: () => 'errid456' }));

import { linkFormSubmissionToAdopter } from './formSubmission';

beforeEach(() => {
    state.allowed = true;
    state.fullySees = false;
    state.recordedMatches = ['ad-1'];
    state.adopter = { id: 'ad-1', addedBy: 'other@example.com', deletedAt: null };
    state.notifWhere.length = 0;
    state.updates.length = 0;
});

describe('linkFormSubmissionToAdopter', () => {
    it('a teammate links to a recorded match — matches read from the OWNER\'s notification, UPDATE keyed by id', async () => {
        const res = await linkFormSubmissionToAdopter('sub-1', 'ad-1');
        expect(res.success).toBe(true);
        expect(state.notifWhere[0].params).toContain(OWNER);
        expect(state.notifWhere[0].params).not.toContain(VIEWER);
        expect(state.updates).toHaveLength(1);
        expect(state.updates[0].set).toMatchObject({ linkedAdopterId: 'ad-1', status: 'linked' });
        expect(state.updates[0].where.sql).not.toMatch(/user_id/);
        expect(state.updates[0].where.params).toContain('sub-1');
    });

    it('refuses (no write) when the viewer may not access the submission', async () => {
        state.allowed = false;
        const res = await linkFormSubmissionToAdopter('sub-1', 'ad-1');
        expect(res.success).toBe(false);
        expect(state.updates).toHaveLength(0);
    });

    it('refuses (no write) when the target adopter does not exist or is soft-deleted', async () => {
        state.adopter = undefined;
        expect(await linkFormSubmissionToAdopter('sub-1', 'ghost')).toMatchObject({ success: false, error: 'target_unavailable' });
        state.adopter = { id: 'ad-1', addedBy: 'other@example.com', deletedAt: new Date() };
        expect(await linkFormSubmissionToAdopter('sub-1', 'ad-1')).toMatchObject({ success: false, error: 'target_unavailable' });
        expect(state.updates).toHaveLength(0);
    });

    it('refuses (no write) a profile that is neither a recorded match nor fully visible', async () => {
        state.recordedMatches = [];
        expect(await linkFormSubmissionToAdopter('sub-1', 'ad-1')).toMatchObject({ success: false, error: 'not_allowed' });
        expect(state.updates).toHaveLength(0);
        state.fullySees = true;
        expect((await linkFormSubmissionToAdopter('sub-1', 'ad-1')).success).toBe(true);
    });
});
