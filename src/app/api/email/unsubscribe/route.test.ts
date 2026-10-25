/**
 * POST /api/email/unsubscribe — the one-click "Dejar de recibir" form. Real
 * SQL (migratedDb), real signatures; only the logger is observed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { migratedDb } from '@/test-utils/migratedDb';

const { state, logs } = vi.hoisted(() => ({
    state: { db: null as unknown },
    logs: { error: [] as Array<[string, Record<string, unknown>]>, warn: [] as string[] },
}));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', () => ({
    logger: {
        error: vi.fn((m: string, _e: unknown, ctx: Record<string, unknown>) => { logs.error.push([m, ctx]); return 'err12345'; }),
        warn: vi.fn((m: string) => { logs.warn.push(m); }),
        info: vi.fn(), debug: vi.fn(),
    },
}));

import { POST } from './route';
import { signUnsubscribe } from '@/lib/emailUnsubscribe';
import { hashOtpCode } from '@/lib/otp';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;
const SECRET = 'test-secret';
const EMAIL = 'rescuer@example.com';

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    logs.error.length = 0;
    logs.warn.length = 0;
    vi.stubEnv('AUTH_SECRET', SECRET);
    sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u1', ?)`).run(EMAIL);
});
afterEach(() => vi.unstubAllEnvs());

function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return POST(new NextRequest('http://localhost/api/email/unsubscribe', { method: 'POST', body: form }));
}
const location = (res: Response) => new URL(res.headers.get('location')!);
const prefs = () => sqlite.prepare(`SELECT email_prefs AS p FROM user_profiles WHERE user_id = 'u1'`).get()?.p ?? null;

describe('POST /api/email/unsubscribe', () => {
    it('a valid signature turns the category off and redirects 303 to ?done=1', async () => {
        const res = await post({ e: EMAIL, c: 'forms', s: await signUnsubscribe(EMAIL, 'forms', SECRET) });
        expect(res.status).toBe(303);
        expect(location(res).pathname).toBe('/email/unsubscribe');
        expect(location(res).searchParams.get('done')).toBe('1');
        expect(location(res).searchParams.get('c')).toBe('forms');
        expect(JSON.parse(String(prefs()))).toEqual({ forms: false });
    });

    it('works when the user row keeps capitals (link carries the lowercased email)', async () => {
        sqlite.prepare(`UPDATE user SET email = 'Rescuer@Example.com' WHERE id = 'u1'`).run();
        const res = await post({ e: EMAIL, c: 'merges', s: await signUnsubscribe(EMAIL, 'merges', SECRET) });
        expect(location(res).searchParams.get('done')).toBe('1');
        expect(JSON.parse(String(prefs()))).toEqual({ merges: false });
    });

    it('a bad signature redirects to ?invalid=1 and writes nothing', async () => {
        const sig = await signUnsubscribe(EMAIL, 'forms', SECRET);
        const res = await post({ e: EMAIL, c: 'forms', s: (sig[0] === '0' ? '1' : '0') + sig.slice(1) });
        expect(res.status).toBe(303);
        expect(location(res).searchParams.get('invalid')).toBe('1');
        expect(prefs()).toBeNull();
    });

    it('an always-on category is invalid even with a matching HMAC, and writes nothing', async () => {
        const sig = await hashOtpCode(`unsub:v1:${EMAIL}:requests`, SECRET);
        const res = await post({ e: EMAIL, c: 'requests', s: sig });
        expect(location(res).searchParams.get('invalid')).toBe('1');
        expect(prefs()).toBeNull();
    });

    it('a DB failure redirects to ?error=<errorId>, logged without the full email', async () => {
        sqlite.prepare('DROP TABLE user_profiles').run();
        const res = await post({ e: EMAIL, c: 'forms', s: await signUnsubscribe(EMAIL, 'forms', SECRET) });
        expect(res.status).toBe(303);
        expect(location(res).searchParams.get('error')).toBe('err12345');
        expect(logs.error).toHaveLength(1);
        expect(logs.error[0][0]).toBe('email.unsubscribe: failed');
        expect(JSON.stringify(logs.error[0][1])).not.toContain(EMAIL);
        expect(logs.error[0][1]).toMatchObject({ category: 'forms' });
    });
});
