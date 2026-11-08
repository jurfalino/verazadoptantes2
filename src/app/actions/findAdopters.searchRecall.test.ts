/**
 * Search and same-person recall on a real (migrated) SQLite database:
 *   S1 — accent-free search finds streets and places («maipu» → «Av. Maipú»);
 *   S2 — phones from different area codes are not the same phone;
 *   S3 — a documento typed with its label and spaces («DNI 25 999 890») is found.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { contactEntriesToBlob, type ContactEntry } from '@/lib/contactEntries';
import { findAdopters, findAdoptersAsViewer } from './findAdopters';
import { judgeCandidates } from '@/lib/identityCandidates';
import type { DuplicateMatch } from './types';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;
const OWNER = 'rescuer@example.com';
const e = (type: ContactEntry['type'], value: string, extra: Partial<ContactEntry> = {}): ContactEntry =>
    ({ id: `${type}-${value}`, type, value, addedBy: OWNER, ...extra } as ContactEntry);

async function seed(id: string, name: string, entries: ContactEntry[], familyMembers: string | null = null) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, contact_info, family_members)
        VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?, ?, ?)`)
        .run(id, name, OWNER, JSON.stringify(entries), contactEntriesToBlob(entries), familyMembers);
    await tokenizeAdopter(id);
}

/** Every result, main list and «Otras posibles coincidencias» alike. */
const found = async (raw: string) => {
    const res = await findAdoptersAsViewer({ raw }, { enrich: true }, OWNER);
    return [...res.results, ...(res.lowRelevanceResults ?? [])].map(r => r.adopterId);
};
/** Which list each record lands in. */
const tiers = async (raw: string) => {
    const res = await findAdoptersAsViewer({ raw }, { enrich: true }, OWNER);
    return { main: res.results.map(r => r.adopterId), low: (res.lowRelevanceResults ?? []).map(r => r.adopterId) };
};

beforeEach(() => {
    vi.clearAllMocks();
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
});

describe('S2 — a phone from another area code is not the same phone', () => {
    const dup = async (phone: string, name = '') => {
        const res = await findAdopters({ name, phones: [phone], country: 'AR' }, { mode: 'duplicate', keepNameOnly: true, minRelevance: 5, limit: 20 });
        return (res.results as DuplicateMatch[]).map(r => r.adopterId);
    };

    it('Rosario 341 412-3456 does not find Córdoba 351 412-3456', async () => {
        await seed('cba', 'Juan Pérez', [e('phone', '+54 9 351 412-3456')]);
        await seed('cba2', 'Juana Pereyra', [e('phone', '3514123456')]);
        expect(await dup('+54 9 341 412-3456')).toEqual([]);
        const judged = await judgeCandidates(state.db as never, { name: 'Juan Peres', aliases: [], phones: ['+54 9 341 412-3456'], emails: [], socials: [], documentIds: [], country: 'AR' }, {});
        for (const j of judged) expect(j.candidate.shared).toEqual([]);
        expect(judged.find(j => j.candidate.adopterId === 'cba')?.verdict).not.toBe('same');
    });

    it('the same number written differently still matches', async () => {
        await seed('ba', 'Juan Pérez', [e('phone', '011 15 6585-1333')]);
        expect(await dup('+54 9 11 6585-1333')).toContain('ba');
        expect(await dup('1165851333')).toContain('ba');
    });

    it('still matches when one of the two was saved without an area code', async () => {
        await seed('local', 'Ana Ruiz', [e('phone', '15 6585-1333')]);
        await seed('full', 'Ana Ruiz', [e('phone', '+54 9 11 4790-2355')]);
        expect(await dup('+54 9 11 6585-1333')).toContain('local');
        expect(await dup('4790-2355')).toContain('full');
    });
});
