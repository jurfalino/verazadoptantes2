import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * resolveUserNames on D1. D1 binds an array as ONE parameter, so the old
 * `inArray(users.email, batch)` matched at most one email: every other
 * caller's name silently fell back to the email handle (adopter profile
 * editors, animal timeline recorders, /my-animals "de {name}").
 *
 * It is also a `'use server'` export, i.e. a public POST endpoint, so the
 * work per call must stay bounded: at most 200 unique emails, looked up in
 * chunks of ≤90 explicit binds (D1 caps a statement at 100 parameters).
 *
 * The fake db compiles the REAL drizzle condition and behaves like D1: an
 * array bound as one parameter only sees its first value; more than 100
 * parameters in one statement is an error.
 */

const USERS: Record<string, string | null> = {
    'ana@example.com': 'Ana Rescatista',
    'beto@example.com': 'Beto',
    'caro@example.com': 'Caro',
    'noname@example.com': null,
};
const many = (n: number) => Array.from({ length: n }, (_, i) => `user${i}@example.com`);
for (const e of many(250)) USERS[e] = `Name ${e}`;

const dialect = new SQLiteSyncDialect();
const statements: Array<{ sql: string; params: unknown[] }> = [];
const failWhen = { email: '' };

function runD1(cond: SQL) {
    const q = dialect.sqlToQuery(cond);
    statements.push(q);
    if (q.params.length > 100) return Promise.reject(new Error('D1_ERROR: too many SQL variables'));
    // D1 quirk: an array bound as a single parameter is one value — only the first survives.
    const emails = q.params.flatMap(p => (Array.isArray(p) ? p.slice(0, 1) : [p])) as string[];
    if (failWhen.email && emails.includes(failWhen.email)) return Promise.reject(new Error('D1_ERROR: boom'));
    return Promise.resolve(emails.filter(e => e in USERS).map(email => ({ email, name: USERS[email] })));
}
const fakeDb = {
    select: () => ({ from: () => ({ where: (cond: SQL) => runD1(cond) }) }),
};
vi.mock('./_db', () => ({ getDb: async () => fakeDb }));

const warn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { resolveUserNames } from './userNames';

beforeEach(() => { statements.length = 0; warn.mockClear(); failWhen.email = ''; });

describe('resolveUserNames (D1)', () => {
    it('resolves every email, not just the first', async () => {
        const names = await resolveUserNames(['ana@example.com', 'beto@example.com', 'caro@example.com']);
        expect(names).toEqual({
            'ana@example.com': 'Ana Rescatista',
            'beto@example.com': 'Beto',
            'caro@example.com': 'Caro',
        });
    });

    it('binds every email as its own parameter, in one statement per chunk', async () => {
        await resolveUserNames(['ana@example.com', '', 'ana@example.com', 'beto@example.com']);
        expect(statements).toHaveLength(1);
        expect(statements[0].params).toEqual(['ana@example.com', 'beto@example.com']);
        expect(statements[0].sql).toMatch(/in \(\?, \?\)/i);
    });

    it('omits users without a name and unknown emails', async () => {
        expect(await resolveUserNames(['noname@example.com', 'ghost@example.com'])).toEqual({});
    });

    it('returns {} for no emails without touching the db', async () => {
        expect(await resolveUserNames([])).toEqual({});
        expect(statements).toHaveLength(0);
    });

    it('splits more than 90 emails into chunks of at most 90 binds', async () => {
        const emails = many(150);
        const names = await resolveUserNames(emails);
        expect(Object.keys(names)).toHaveLength(150);
        expect(statements.map(s => s.params.length)).toEqual([90, 60]);
    });

    it('caps the work at 200 unique emails and says so', async () => {
        const names = await resolveUserNames(many(250));
        expect(Object.keys(names)).toHaveLength(200);
        expect(statements.reduce((n, s) => n + s.params.length, 0)).toBe(200);
        expect(statements.every(s => s.params.length <= 90)).toBe(true);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('resolveUserNames'), expect.objectContaining({ requested: 250, kept: 200 }));
    });

    it('a failing chunk is logged and does not lose the other chunks', async () => {
        failWhen.email = 'user100@example.com'; // lands in the second chunk
        const names = await resolveUserNames(many(150));
        expect(Object.keys(names)).toHaveLength(90);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls[0])).not.toContain('@example.com');
    });
});
