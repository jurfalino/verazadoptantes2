import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * resolveUserNames on D1. D1 binds an array as ONE parameter, so the old
 * `inArray(users.email, batch)` became `IN (?)` and matched at most one
 * email: every other caller's name silently fell back to the email handle
 * (adopter profile editors, animal timeline recorders, /my-animals "de {name}").
 *
 * The fake db below behaves like D1: an `IN` list only sees its first value.
 * `eq` works as normal.
 */

const USERS: Record<string, string | null> = {
    'ana@example.com': 'Ana Rescatista',
    'beto@example.com': 'Beto',
    'caro@example.com': 'Caro',
    'noname@example.com': null,
};

type Cond = { op: 'eq'; value: string } | { op: 'in'; values: string[] };

vi.mock('drizzle-orm', async (importOriginal) => ({
    ...(await importOriginal<typeof import('drizzle-orm')>()),
    eq: (_col: unknown, value: string): Cond => ({ op: 'eq', value }),
    inArray: (_col: unknown, values: string[]): Cond => ({ op: 'in', values }),
}));

const where = vi.fn();
const failFor = new Set<string>();
function rowsFor(cond: Cond) {
    // D1 quirk: an array bound to IN (?) is one value — only the first survives.
    const emails = cond.op === 'eq' ? [cond.value] : cond.values.slice(0, 1);
    if (emails.some(e => failFor.has(e))) return Promise.reject(new Error('D1_ERROR: boom'));
    return Promise.resolve(emails.filter(e => e in USERS).map(email => ({ email, name: USERS[email] })));
}
const fakeDb = {
    select: () => ({ from: () => ({ where: (cond: Cond) => { where(cond); return rowsFor(cond); } }) }),
};
vi.mock('@/app/actions', () => ({ getDb: async () => fakeDb }));
vi.mock('./_db', () => ({ getDb: async () => fakeDb }));

const warn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { resolveUserNames } from './userNames';

beforeEach(() => { where.mockClear(); warn.mockClear(); failFor.clear(); });

describe('resolveUserNames (D1)', () => {
    it('resolves every email, not just the first', async () => {
        const names = await resolveUserNames(['ana@example.com', 'beto@example.com', 'caro@example.com']);
        expect(names).toEqual({
            'ana@example.com': 'Ana Rescatista',
            'beto@example.com': 'Beto',
            'caro@example.com': 'Caro',
        });
    });

    it('looks each distinct email up once and skips blanks', async () => {
        await resolveUserNames(['ana@example.com', '', 'ana@example.com', 'beto@example.com']);
        expect(where).toHaveBeenCalledTimes(2);
    });

    it('omits users without a name and unknown emails', async () => {
        expect(await resolveUserNames(['noname@example.com', 'ghost@example.com'])).toEqual({});
    });

    it('returns {} for no emails without touching the db', async () => {
        expect(await resolveUserNames([])).toEqual({});
        expect(where).not.toHaveBeenCalled();
    });

    it('one failing lookup is logged and does not lose the others', async () => {
        failFor.add('beto@example.com');
        const names = await resolveUserNames(['ana@example.com', 'beto@example.com', 'caro@example.com']);
        expect(names).toEqual({ 'ana@example.com': 'Ana Rescatista', 'caro@example.com': 'Caro' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls[0])).not.toContain('beto@example.com');
    });
});
