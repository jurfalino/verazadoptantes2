/**
 * P2 (Jon, 2026-11-08): the interested-people panel looks up the person's
 * ALERTS — the profile's own: «N adopciones en N días» / «Pidió en N
 * rescates…» (periodAlerts, the Admin thresholds) and the housemate chips —
 * and says «Sin alertas en el perfil» only when that check really ran. A
 * failed lookup is logged (warn) and never reads as «no alerts».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state, warn } = vi.hoisted(() => ({ state: { db: null as unknown, failConfig: false, failHousemates: false }, warn: vi.fn() }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'owner@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('./config', async (orig) => {
    const real = await orig<typeof import('./config')>();
    return { ...real, getAdoptionConfig: vi.fn(async (o?: { strict?: boolean }) => { if (state.failConfig) throw new Error('D1 down'); return real.getAdoptionConfig(o); }) };
});
vi.mock('@/lib/households', async (orig) => {
    const real = await orig<typeof import('@/lib/households')>();
    return { ...real, housemateAlertsFor: vi.fn(async (...a: Parameters<typeof real.housemateAlertsFor>) => { if (state.failHousemates) throw new Error('budget spent'); return real.housemateAlertsFor(...a); }) };
});

import { loadApplicantsForAnimal } from './_applicants';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

// migratedDb is the SYNC better-sqlite3 driver; D1 returns promises and the reads chain .catch on them.
function asyncDb<T extends object>(target: T): T {
    return new Proxy(target, {
        get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (typeof v !== 'function') return v;
            return (...args: unknown[]) => {
                const out = (v as (...a: unknown[]) => unknown).apply(t, args);
                if (p === 'get' || p === 'all' || p === 'run' || p === 'values') return Promise.resolve(out);
                return out && typeof out === 'object' && p !== 'then' ? asyncDb(out as object) : out;
            };
        },
    });
}

const OWNER = 'owner@example.com';
const DAY = 86_400;

beforeEach(() => {
    state.failConfig = false;
    state.failHousemates = false;
    warn.mockClear();
    const m = migratedDb();
    state.db = asyncDb(m.db);
    sqlite = m.sqlite as unknown as typeof sqlite;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by) VALUES ('juan', 'Juan Pérez', '5', ?), ('ana', 'Ana', '5', ?)`).run(OWNER, OWNER);
    // Luna, the animal they ask for.
    sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('luna', 'Luna', 'cat', ?, 1000, 1000)`).run(OWNER);
    // Juan: 3 adoptions in 10 days (the threshold is set to 3 below).
    for (const [i, d] of [0, 5, 10].entries()) {
        sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES (?, 'x', 'cat', ?, 1000, 1000)`).run(`a${i}`, OWNER);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, status, recorded_by) VALUES (?, ?, 'juan', 'adoption', ?, 'completed', ?)`).run(`p${i}`, `a${i}`, 1_700_000_000 + d * DAY, OWNER);
    }
    sqlite.prepare(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('too_many_adoptions_threshold', '3')`).run();
    const sub = sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, created_at) VALUES (?, ?, ?, 'luna', ?, 1700000000)`);
    sub.run('s-juan', OWNER, 'Juan Pérez', 'juan');
    sub.run('s-ana', OWNER, 'Ana', 'ana');
});

const load = () => loadApplicantsForAnimal(state.db, { id: 'luna', adopterId: null }, [OWNER], OWNER);

describe('the applicants panel reads the person\'s alerts (P2)', () => {
    it('Juan, 3 adoptions in 10 days: the profile\'s «3 adopciones en 10 días» alert, checked', async () => {
        const juan = (await load()).find(a => a.adopterId === 'juan')!;
        expect(juan.alertsChecked).toBe(true);
        expect(juan.flags?.tooManyAdoptions).toMatchObject({ count: 3, threshold: 3 });
        expect(Math.round(juan.flags!.tooManyAdoptions!.actualSpanDays!)).toBe(10);
    });

    it('Ana, nothing on her record: checked, and no alerts — «Sin alertas en el perfil» is true', async () => {
        const ana = (await load()).find(a => a.adopterId === 'ana')!;
        expect(ana.alertsChecked).toBe(true);
        expect(ana.flags?.tooManyAdoptions).toBeNull();
        expect(ana.flags?.tooManyRequests).toBeNull();
        expect(ana.housemateAlert).toEqual({ lowRating: null, hasAlerts: false });
    });

    it('a failed lookup (the Admin thresholds unreadable): not checked, logged at warn, the list still loads', async () => {
        state.failConfig = true;
        const list = await load();
        expect(list).toHaveLength(2);
        for (const a of list) {
            expect(a.alertsChecked).toBe(false);
            expect(a.flags?.tooManyAdoptions).toBeNull();
        }
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('alerts'), expect.objectContaining({ animalId: 'luna' }));
    });

    it('one half failing (the housemate read) keeps the half that was read: Juan\'s alert still shows, nobody is «checked»', async () => {
        state.failHousemates = true;
        const list = await load();
        const juan = list.find(a => a.adopterId === 'juan')!;
        expect(juan.flags?.tooManyAdoptions).toMatchObject({ count: 3 });
        for (const a of list) expect(a.alertsChecked).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('housemate'), expect.objectContaining({ animalId: 'luna' }));
    });
});
