/**
 * saveAdoption — field-level collision protection for animal and record edits
 * (src/domain/fieldCollab.ts). Real SQL on the real schema: animals,
 * placements, adopter_events and the `adoptions` view they back. A teammate's
 * save is simulated before the editor's, or injected between saveAdoption's
 * read and its write (the `interleave` hook runs inside the authorization
 * check, which sits exactly there).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';
import * as mocks from '@/test-utils/actionMocks';
import { isSaveBusyError, isAnimalAlreadyPlacedError } from '@/domain/fieldCollab';
import { isActivePlacementConflict } from './_recordWrite';

const { state, audit } = vi.hoisted(() => ({
    state: { db: null as unknown, interleave: null as null | (() => unknown), sqlite: null as unknown },
    audit: { calls: [] as Array<{ userEmail: string; action: string; target: string; details: unknown }> },
}));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({
    isOrgMate: mocks.isOrgMate,
    isOwnerOrOrgMate: async (a: string, b: string) => {
        const hook = state.interleave;
        state.interleave = null;
        await hook?.();
        return mocks.isOwnerOrOrgMate(a, b);
    },
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/pendingSearchLog', () => ({ closePendingSearchesForAdopter: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// The real logAudit writes through the D1 binding after the response; here it
// lands synchronously in the same database so attribution can read it.
vi.mock('@/lib/audit', () => ({
    logAudit: vi.fn((e: { userEmail: string; action: string; target: string; details: unknown }) => {
        audit.calls.push(e);
        (state.sqlite as { prepare: (s: string) => { run: (...a: unknown[]) => unknown } })
            .prepare('INSERT INTO audit_log (id, user_email, action, target, details) VALUES (?, ?, ?, ?, ?)')
            .run(crypto.randomUUID(), e.userEmail, e.action, e.target, JSON.stringify(e.details ?? null));
    }),
}));

import { saveAdoption } from './adoptions';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const animal = () => sqlite.prepare("SELECT * FROM animals WHERE id = 'an1'").get()!;
const activePlacement = () => sqlite.prepare("SELECT * FROM placements WHERE animal_id = 'an1' AND ended_at IS NULL").get()!;
const historyCount = () => sqlite.prepare("SELECT COUNT(*) AS n FROM adopter_history").get()!.n as number;

/** What the animal form loaded. */
const LOADED_ANIMAL = { animalName: 'Nina', species: 'cat', color: 'gris', age: null, microchip: null, sex: 'hembra', details: 'Tímida', neutered: null };

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
}

describe('saveAdoption — per-field collisions', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        state.sqlite = m.sqlite;
        state.interleave = null;
        audit.calls = [];
        sqlite = m.sqlite as unknown as typeof sqlite;
        session.user = OWNER;
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Carla', '5', ?, 1000, 1000)`).run(OWNER);
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad2', 'Bruno', '5', ?, 1000, 1000)`).run(OWNER);
        sqlite.prepare(`INSERT INTO animals (id, name, species, color, sex, details, added_by, created_at, updated_at)
            VALUES ('an1', 'Nina', 'cat', 'gris', 'hembra', 'Tímida', ?, 1000, 1000)`).run(OWNER);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, status, rating, comments, recorded_by)
            VALUES ('an1-plc', 'an1', 'ad1', 'adoption', 1000, 'completed', 4, 'Todo bien', ?)`).run(OWNER);
        sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, details, rating, date, recorded_by)
            VALUES ('ev1', 'ad1', 'observation', 'La vi en la plaza', 3, 1000, ?)`).run(OWNER);
        sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u-mate', 'Marta Ruiz', ?)`).run(MATE);
    });

    it('two teammates editing different fields of the same animal: both land', async () => {
        await as(MATE, () => saveAdoption({ id: 'an1', color: 'atigrada' } as never, { loaded: LOADED_ANIMAL }));
        const res = await saveAdoption({ id: 'an1', animalName: 'Nina Bella' } as never, { loaded: LOADED_ANIMAL });
        expect(res.conflicts).toEqual([]);
        expect(animal().name).toBe('Nina Bella');
        expect(animal().color).toBe('atigrada');
        expect(res.updatedByOthers).toEqual([{ field: 'color', by: 'Marta Ruiz', value: 'atigrada' }]);
    });

    it('a stale form that sends every field never reverts the teammate\'s change', async () => {
        await as(MATE, () => saveAdoption({ id: 'an1', color: 'atigrada' } as never, { loaded: LOADED_ANIMAL }));
        await saveAdoption({ id: 'an1', ...LOADED_ANIMAL, animalName: 'Nina Bella' } as never, { loaded: LOADED_ANIMAL });
        expect(animal().color).toBe('atigrada');
        expect(animal().name).toBe('Nina Bella');
    });

    it('the same field: refused, names who changed it, theirs stays, no history row', async () => {
        await as(MATE, () => saveAdoption({ id: 'an1', animalName: 'Nini' } as never, { loaded: LOADED_ANIMAL }));
        const before = historyCount();
        const auditBefore = audit.calls.length;
        const res = await saveAdoption({ id: 'an1', animalName: 'Nina Bella', color: 'blanca' } as never, { loaded: LOADED_ANIMAL });
        expect(res.conflicts).toEqual([{ field: 'animalName', by: 'Marta Ruiz', value: 'Nini' }]);
        expect(animal().name).toBe('Nini');
        // The other changed field still lands — one history + one audit row for it.
        expect(animal().color).toBe('blanca');
        expect(historyCount()).toBe(before + 1);
        expect(audit.calls.length).toBe(auditBefore + 1);
        expect((audit.calls.at(-1)!.details as { fields: string[] }).fields).toEqual(['color']);
    });

    it('a refused save writes nothing at all', async () => {
        await as(MATE, () => saveAdoption({ id: 'an1', animalName: 'Nini' } as never, { loaded: LOADED_ANIMAL }));
        const before = historyCount();
        const auditBefore = audit.calls.length;
        const updatedBy = animal().updated_by;
        const res = await saveAdoption({ id: 'an1', animalName: 'Nina Bella' } as never, { loaded: LOADED_ANIMAL });
        expect(res.saved).toEqual([]);
        expect(historyCount()).toBe(before);
        expect(audit.calls.length).toBe(auditBefore);
        expect(animal().updated_by).toBe(updatedBy);
    });

    it('«Guardar la mía igual» (compared against their value) writes', async () => {
        await as(MATE, () => saveAdoption({ id: 'an1', animalName: 'Nini' } as never, { loaded: LOADED_ANIMAL }));
        const res = await saveAdoption({ id: 'an1', animalName: 'Nina Bella' } as never, { loaded: { ...LOADED_ANIMAL, animalName: 'Nini' } });
        expect(res.conflicts).toEqual([]);
        expect(animal().name).toBe('Nina Bella');
    });

    it('a teammate saving the same field between the read and the write: refused on the retry', async () => {
        state.interleave = () => sqlite.prepare(`UPDATE animals SET name = 'Nini' WHERE id = 'an1'`).run();
        const res = await saveAdoption({ id: 'an1', animalName: 'Nina Bella' } as never, { loaded: LOADED_ANIMAL });
        expect(animal().name).toBe('Nini');
        expect(res.conflicts).toEqual([{ field: 'animalName', by: '', value: 'Nini' }]);
    });

    it('a teammate saving a DIFFERENT field between the read and the write: both land', async () => {
        state.interleave = () => sqlite.prepare(`UPDATE animals SET color = 'negra' WHERE id = 'an1'`).run();
        const res = await saveAdoption({ id: 'an1', animalName: 'Nina Bella' } as never, { loaded: LOADED_ANIMAL });
        expect(res.conflicts).toEqual([]);
        expect(animal().name).toBe('Nina Bella');
        expect(animal().color).toBe('negra');
    });

    it('placement fields: same-field race refused, different-field race both land', async () => {
        const loaded = { rating: 4, comments: 'Todo bien', status: 'completed' };
        state.interleave = () => sqlite.prepare(`UPDATE placements SET comments = 'Se mudaron' WHERE id = 'an1-plc'`).run();
        let res = await saveAdoption({ id: 'an1', comments: 'Visita ok' } as never, { loaded });
        expect(res.conflicts?.map(c => c.field)).toEqual(['comments']);
        expect(activePlacement().comments).toBe('Se mudaron');

        state.interleave = () => sqlite.prepare(`UPDATE placements SET comments = 'Otra nota' WHERE id = 'an1-plc'`).run();
        res = await saveAdoption({ id: 'an1', rating: 5 } as never, { loaded: { ...loaded, comments: 'Se mudaron' } });
        expect(res.conflicts).toEqual([]);
        expect(activePlacement().rating).toBe(5);
        expect(activePlacement().comments).toBe('Otra nota');
    });

    it('event records: a same-field race is refused; a stale form does not revert', async () => {
        const loaded = { details: 'La vi en la plaza', rating: 3 };
        state.interleave = () => sqlite.prepare(`UPDATE adopter_events SET details = 'Otra cosa' WHERE id = 'ev1'`).run();
        const res = await saveAdoption({ id: 'ev1', details: 'Mía' } as never, { loaded });
        expect(res.conflicts?.map(c => c.field)).toEqual(['details']);
        await saveAdoption({ id: 'ev1', details: 'Otra cosa', rating: 5 } as never, { loaded: { ...loaded, details: 'Otra cosa' } });
        const ev = sqlite.prepare("SELECT * FROM adopter_events WHERE id = 'ev1'").get()!;
        expect(ev.details).toBe('Otra cosa');
        expect(ev.rating).toBe(5);
    });

    it('moving an animal to another adopter while a teammate already moved it: refused, no second active placement', async () => {
        await as(MATE, () => saveAdoption({ id: 'an1', adopterId: 'ad2' } as never, { loaded: { adopterId: 'ad1' } }));
        const res = await saveAdoption({ id: 'an1', recordType: 'available', adopterId: null } as never, { loaded: { adopterId: 'ad1', recordType: 'adoption' } });
        expect(res.conflicts?.map(c => c.field)).toEqual(['adopterId', 'recordType']);
        const active = sqlite.prepare("SELECT * FROM placements WHERE animal_id = 'an1' AND ended_at IS NULL").all();
        expect(active.length).toBe(1);
        expect(active[0].adopter_id).toBe('ad2');
    });

    it('a teammate moving the animal between the read and the write: the move-back is refused', async () => {
        state.interleave = () => {
            sqlite.prepare(`UPDATE placements SET ended_at = 2000 WHERE id = 'an1-plc'`).run();
            sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('an1-plc2', 'an1', 'ad2', 'adoption', 2000, ?)`).run(MATE);
        };
        const res = await saveAdoption({ id: 'an1', recordType: 'available', adopterId: null } as never, { loaded: { adopterId: 'ad1', recordType: 'adoption' } });
        expect(res.conflicts?.map(c => c.field).sort()).toEqual(['adopterId', 'recordType']);
        expect(activePlacement().id).toBe('an1-plc2');
    });

    it('a placement change that lands carries the fields it did not change', async () => {
        await saveAdoption({ id: 'an1', adopterId: 'ad2' } as never, { loaded: { adopterId: 'ad1' } });
        const p = activePlacement();
        expect(p.adopter_id).toBe('ad2');
        expect(p.rating).toBe(4);
        expect(p.comments).toBe('Todo bien');
    });

    it('dates compare by meaning (Date vs epoch vs ISO) — no false conflict', async () => {
        const iso = new Date(1000 * 1000).toISOString();
        const res = await saveAdoption({ id: 'ev1', rating: 4 } as never, { loaded: { date: iso, rating: 3 } });
        expect(res.conflicts).toEqual([]);
        expect(res.updatedByOthers).toEqual([]);
    });

    it('date writes land through the compare-and-swap (placement start, event date, birth date)', async () => {
        // Placed animal: the view's date IS the placement's start.
        let res = await saveAdoption({ id: 'an1', date: new Date(2_000_000 * 1000) } as never, { loaded: { date: new Date(1000 * 1000) } });
        expect(res.conflicts).toEqual([]);
        expect(activePlacement().started_at).toBe(2_000_000);
        // Event.
        res = await saveAdoption({ id: 'ev1', date: new Date(3_000_000 * 1000) } as never, { loaded: { date: 1000 } });
        expect(res.conflicts).toEqual([]);
        expect(sqlite.prepare("SELECT date FROM adopter_events WHERE id = 'ev1'").get()!.date).toBe(3_000_000);
        // Birth date (a real one: epoch numbers are read as ms above 1e11), baseline
        // in milliseconds as the animal form sends it.
        sqlite.prepare("UPDATE animals SET estimated_birth_date = 1600000000 WHERE id = 'an1'").run();
        res = await saveAdoption({ id: 'an1', estimatedBirthDate: new Date(1_650_000_000 * 1000) } as never, { loaded: { estimatedBirthDate: 1_600_000_000 * 1000 } });
        expect(res.conflicts).toEqual([]);
        expect(animal().estimated_birth_date).toBe(1_650_000_000);
    });

    it('a placement with no start date: the view shows the animal\'s creation date, and a new date still lands', async () => {
        sqlite.prepare("UPDATE placements SET started_at = NULL WHERE id = 'an1-plc'").run();
        const res = await saveAdoption({ id: 'an1', date: new Date(2_000_000 * 1000), comments: 'Nueva nota' } as never, { loaded: { date: new Date(1000 * 1000), comments: 'Todo bien' } });
        expect(res.conflicts).toEqual([]);
        expect(activePlacement().started_at).toBe(2_000_000);
        expect(activePlacement().comments).toBe('Nueva nota');
    });

    it('the animal\'s link while the placement has its own: no false lost race', async () => {
        sqlite.prepare("UPDATE placements SET source_url = 'https://ejemplo.org/placement' WHERE id = 'an1-plc'").run();
        sqlite.prepare("UPDATE animals SET source_url = 'https://ejemplo.org/animal' WHERE id = 'an1'").run();
        const res = await saveAdoption({ id: 'an1', sourceUrl: 'https://ejemplo.org/nuevo' } as never, { loaded: { sourceUrl: 'https://ejemplo.org/placement' } });
        expect(res.conflicts).toEqual([]);
        expect(animal().source_url).toBe('https://ejemplo.org/nuevo');
    });

    it('losing the race twice throws the busy marker with an errorId; nothing written', async () => {
        let n = 0;
        const real = state.db as { update: (...a: unknown[]) => unknown };
        state.db = new Proxy(real, {
            get(target, prop, recv) {
                if (prop === 'update') return (...a: unknown[]) => {
                    sqlite.prepare(`UPDATE animals SET name = ? WHERE id = 'an1'`).run(`Nina ${++n}`);
                    return (target.update as (...x: unknown[]) => unknown).apply(target, a);
                };
                return Reflect.get(target, prop, recv);
            },
        });
        const err = await saveAdoption({ id: 'an1', animalName: 'Nina Bella' } as never).catch(e => e);
        expect(isSaveBusyError(err)).toBe(true);
        expect(String(err.message)).toMatch(/Error ID: \w+/);
        expect(historyCount()).toBe(0);
    });

    it('callers without a baseline keep the old behaviour', async () => {
        await saveAdoption({ id: 'an1', animalName: 'Nina Bella', color: 'gris' } as never);
        expect(animal().name).toBe('Nina Bella');
    });

    it('authorization is unchanged', async () => {
        session.user = STRANGER;
        await expect(saveAdoption({ id: 'an1', animalName: 'X' } as never, { loaded: LOADED_ANIMAL })).rejects.toThrow(/Error ID/);
        expect(animal().name).toBe('Nina');
    });

    it('a malformed baseline is rejected', async () => {
        await expect(saveAdoption({ id: 'an1', animalName: 'X' } as never, { loaded: { addedBy: 'x' } } as never)).rejects.toThrow(/Invalid adoption data/);
    });
});

describe('one active placement per animal', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        state.sqlite = m.sqlite;
        state.interleave = null;
        audit.calls = [];
        sqlite = m.sqlite as unknown as typeof sqlite;
        session.user = OWNER;
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Carla', '5', ?, 1000, 1000), ('ad2', 'Bruno', '5', ?, 1000, 1000)`).run(OWNER, OWNER);
        sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('an3', 'Luna', 'dog', ?, 1000, 1000)`).run(OWNER);
        sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u-mate', 'Marta Ruiz', ?)`).run(MATE);
    });
    const active = () => sqlite.prepare("SELECT adopter_id FROM placements WHERE animal_id = 'an3' AND ended_at IS NULL").all();
    const FROM_AVAILABLE = { adopterId: null, recordType: 'available' };

    it('two people placing the same available animal at once: one lands, the other gets the conflict', async () => {
        // Marta's whole save runs between Carla's read and her write.
        state.interleave = () => as(MATE, () => saveAdoption({ id: 'an3', adopterId: 'ad2', recordType: 'adoption' } as never, { loaded: FROM_AVAILABLE }));
        const res = await saveAdoption({ id: 'an3', adopterId: 'ad1', recordType: 'adoption' } as never, { loaded: FROM_AVAILABLE });
        expect(res.conflicts?.map(c => c.field)).toEqual(['adopterId']);
        expect(res.saved).toEqual([]);
        expect(res.conflicts?.find(c => c.field === 'adopterId')?.by).toBe('Marta Ruiz');
        expect(active()).toEqual([{ adopter_id: 'ad2' }]);
    });

    it('the database itself refuses the second active placement: a lost race, re-planned into a conflict', async () => {
        // A placement opened by someone else right before our insert (past every app check).
        let armed = true;
        const real = state.db as { insert: (...a: unknown[]) => unknown };
        state.db = new Proxy(real, {
            get(target, prop, recv) {
                if (prop === 'insert') return (...a: unknown[]) => {
                    if (armed) {
                        armed = false;
                        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('race-plc', 'an3', 'ad2', 'adoption', 2000, ?)`).run(MATE);
                    }
                    return (target.insert as (...x: unknown[]) => unknown).apply(target, a);
                };
                return Reflect.get(target, prop, recv);
            },
        });
        const res = await saveAdoption({ id: 'an3', adopterId: 'ad1', recordType: 'adoption' } as never, { loaded: FROM_AVAILABLE });
        expect(res.conflicts?.map(c => c.field)).toEqual(['adopterId']);
        expect(res.saved).toEqual([]);
        expect(active()).toEqual([{ adopter_id: 'ad2' }]);
    });

    it('a create that collides with an existing active placement: a localized-error marker with an errorId', async () => {
        // An active placement whose animal the view does not show yet — the
        // create path inserts the animal and then its placement.
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('orphan-plc', 'an-new', 'ad2', 'adoption', 2000, ?)`).run(MATE);
        const err = await saveAdoption({ id: 'an-new', adopterId: 'ad1', recordType: 'adoption', animalName: 'Toto', species: 'dog' } as never).catch(e => e);
        expect(isAnimalAlreadyPlacedError(err)).toBe(true);
        expect(String(err.message)).toMatch(/Error ID: \w+/);
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM placements WHERE animal_id = 'an-new' AND ended_at IS NULL").get()!.n).toBe(1);
    });

    it('a delivery address verified on a new adoption joins the contacts as an entry, blob in sync, concurrent edit kept', async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ?, contact_info = '1155551111' WHERE id = 'ad1'`)
            .run(JSON.stringify([{ id: 'e1', type: 'phone', value: '1155551111' }]));
        // A teammate edits the phone while the record is being created.
        let armed = true;
        const real = state.db as { update: (...a: unknown[]) => unknown };
        state.db = new Proxy(real, {
            get(target, prop, recv) {
                if (prop === 'update') return (...a: unknown[]) => {
                    if (armed) {
                        armed = false;
                        sqlite.prepare(`UPDATE adopters SET contact_entries = ?, contact_info = '1155552222' WHERE id = 'ad1'`)
                            .run(JSON.stringify([{ id: 'e1', type: 'phone', value: '1155552222' }]));
                    }
                    return (target.update as (...x: unknown[]) => unknown).apply(target, a);
                };
                return Reflect.get(target, prop, recv);
            },
        });
        await saveAdoption({ adopterId: 'ad1', recordType: 'adoption', animalName: 'Toto', species: 'dog', deliveredToHome: 1, verifiedAddress: 'Calle Falsa 123, Rosario' } as never);
        const row = sqlite.prepare("SELECT contact_entries, contact_info FROM adopters WHERE id = 'ad1'").get()!;
        const list = JSON.parse(row.contact_entries as string) as Array<{ type: string; value: string }>;
        expect(list.map(e => e.value)).toEqual(['1155552222', 'Calle Falsa 123, Rosario']);
        expect(list[1].type).toBe('address');
        expect(row.contact_info).toContain('1155552222');
        expect(row.contact_info).toContain('Calle Falsa 123');
    });

    it('recognizes the unique-index failure, raw and wrapped', () => {
        let raw: unknown;
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type) VALUES ('p1', 'an3', 'ad1', 'adoption')`).run();
        try { sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type) VALUES ('p2', 'an3', 'ad2', 'adoption')`).run(); } catch (e) { raw = e; }
        expect(isActivePlacementConflict(raw)).toBe(true);
        expect(isActivePlacementConflict(new Error('Failed query', { cause: raw }))).toBe(true);
        expect(isActivePlacementConflict(new Error('UNIQUE constraint failed: user.email'))).toBe(false);
    });
});

describe('half-landed saves keep their history', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        state.sqlite = m.sqlite;
        state.interleave = null;
        audit.calls = [];
        sqlite = m.sqlite as unknown as typeof sqlite;
        session.user = OWNER;
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ad1', 'Carla', '5', ?, 1000, 1000)`).run(OWNER);
        sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('an1', 'Nina', 'cat', ?, 1000, 1000)`).run(OWNER);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, comments, recorded_by) VALUES ('an1-plc', 'an1', 'ad1', 'adoption', 1000, 'Todo bien', ?)`).run(OWNER);
    });

    it('the animal part lands, the placement part loses: the landed field gets its history; the other is a conflict', async () => {
        // Second UPDATE = the placement patch; a teammate's note lands right before it.
        let n = 0;
        const real = state.db as { update: (...a: unknown[]) => unknown };
        state.db = new Proxy(real, {
            get(target, prop, recv) {
                if (prop === 'update') return (...a: unknown[]) => {
                    if (++n === 2) sqlite.prepare(`UPDATE placements SET comments = 'Se mudaron' WHERE id = 'an1-plc'`).run();
                    return (target.update as (...x: unknown[]) => unknown).apply(target, a);
                };
                return Reflect.get(target, prop, recv);
            },
        });
        const res = await saveAdoption({ id: 'an1', animalName: 'Nina Bella', comments: 'Mía' } as never, { loaded: { animalName: 'Nina', comments: 'Todo bien' } });
        expect(res.saved).toContain('animalName');
        expect(res.conflicts?.map(c => c.field)).toEqual(['comments']);
        expect(animal().name).toBe('Nina Bella');
        expect(activePlacement().comments).toBe('Se mudaron');
        const history = sqlite.prepare("SELECT changes FROM adopter_history").all().map(r => JSON.parse(r.changes as string).adoption_updated);
        expect(history).toEqual([{ animalName: { from: 'Nina', to: 'Nina Bella' } }]);
        expect(audit.calls.map(c => (c.details as { fields: string[] }).fields)).toEqual([['animalName']]);
    });
});
