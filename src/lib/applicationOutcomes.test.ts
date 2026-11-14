import { describe, it, expect, beforeEach, vi } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { asyncDb, type Sqlite, adopter, animal, form, application } from '@/test-utils/applicationFixtures';
import { OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';

const warn = vi.fn();
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') } }));

const { attachApplicationOutcomes } = await import('./applicationOutcomes');

let m: ReturnType<typeof migratedDb>;
const sqlite = () => m.sqlite as unknown as Sqlite;
const TEAM = [OWNER, MATE];
const rec = (id: string, sourceUrl: string | null, recordType = 'adoption_request', animal: { animalName: string; sex: string } | null = null) => ({ id, recordType, sourceUrl, animalName: animal?.animalName ?? null, sex: animal?.sex ?? null });
const teamFn = vi.fn(async () => TEAM as readonly string[]);
const outcomeOf = async (records: ReturnType<typeof rec>[], team: string[] = TEAM) =>
    (await attachApplicationOutcomes(asyncDb(m.db) as never, records, { teamEmails: async () => team, adopterId: 'ana' })).map((r) => (r as { applicationOutcome?: unknown }).applicationOutcome);

beforeEach(() => {
    warn.mockClear();
    teamFn.mockClear();
    m = migratedDb();
    adopter(sqlite(), 'ana', 'Ana Pérez', OWNER);
    animal(sqlite(), 'luna', 'Luna', OWNER, { sex: 'hembra' });
    animal(sqlite(), 'sol', 'Sol', STRANGER, { sex: 'macho' });
    form(sqlite(), 's1', { adopter: 'ana', animal: 'luna' });
});

describe('attachApplicationOutcomes', () => {
    it('a closed application carries its status and the team animal it was for', async () => {
        application(sqlite(), 'app-s1', 's1', 'luna', { state: 'closed', closeReason: 'adopted_other' });
        const [o] = await outcomeOf([rec('r1', 'form:s1')]);
        expect(o).toEqual({ status: { kind: 'closed', reason: 'adopted_other' }, animal: { name: 'Luna', sex: 'hembra' }, outcomeAnimal: null });
    });

    it('the record\'s own animal is named from the record, whoever views it (an outsider sees «Sol» on the record already)', async () => {
        form(sqlite(), 's2', { adopter: 'ana', animal: 'sol' });
        application(sqlite(), 'app-s2', 's2', 'sol', { state: 'closed', closeReason: 'adopted_other' });
        const [o] = await outcomeOf([rec('r2', 'form:s2', 'adoption_request', { animalName: 'Sol', sex: 'macho' })], [STRANGER]);
        expect(o).toEqual({ status: { kind: 'closed', reason: 'adopted_other' }, animal: { name: 'Sol', sex: 'macho' }, outcomeAnimal: null });
        expect(teamFn).not.toHaveBeenCalled();
    });

    it('a record that shows no animal does not reveal another team\'s one', async () => {
        form(sqlite(), 's2', { adopter: 'ana', animal: 'sol' });
        application(sqlite(), 'app-s2', 's2', 'sol', { state: 'closed', closeReason: 'adopted_other' });
        const [o] = await outcomeOf([rec('r2', 'form:s2')]);
        expect(o).toEqual({ status: { kind: 'closed', reason: 'adopted_other' }, animal: null, outcomeAnimal: null });
    });

    it('a proposal to another team\'s animal is not named', async () => {
        form(sqlite(), 's3', { adopter: 'ana' });
        application(sqlite(), 'app-prop', 's3', 'sol', { origin: 'proposed' });
        application(sqlite(), 'app-s3', 's3', null, { state: 'proposed' });
        sqlite().prepare("UPDATE applications SET proposed_application_id = 'app-prop' WHERE id = 'app-s3'").run();
        const [o] = await outcomeOf([rec('r3', 'form:s3')]);
        expect(o).toEqual({ status: { kind: 'proposed' }, animal: null, outcomeAnimal: null });
    });

    it('one animal lookup per distinct animal, and the team only when a gated animal is needed', async () => {
        for (const n of [1, 2, 3]) {
            form(sqlite(), `x${n}`, { adopter: 'ana', animal: 'luna' });
            application(sqlite(), `app-x${n}`, `x${n}`, 'luna', { state: 'closed', closeReason: 'adopted_other' });
        }
        const selects: string[] = [];
        const db = asyncDb(m.db) as unknown as { select: (...a: unknown[]) => unknown };
        const spy = new Proxy(db, { get: (t, p, r) => p === 'select' ? (...a: unknown[]) => { selects.push(String(Object.keys((a[0] ?? {}) as object).join(','))); return (t.select as (...x: unknown[]) => unknown)(...a); } : Reflect.get(t, p, r) });
        const out = await attachApplicationOutcomes(spy as never, [rec('a', 'form:x1'), rec('b', 'form:x2'), rec('c', 'form:x3')], { teamEmails: teamFn, adopterId: 'ana' });
        expect(out.every((r) => (r as { applicationOutcome?: { animal: unknown } }).applicationOutcome?.animal !== null)).toBe(true);
        expect(selects.filter((k) => k.includes('owner'))).toHaveLength(1);
        expect(teamFn).toHaveBeenCalledTimes(1);
    });

    it('an open application, a record without a form source, a non-request and a missing application carry nothing', async () => {
        application(sqlite(), 'app-s1', 's1', 'luna');
        const out = await outcomeOf([rec('r1', 'form:s1'), rec('r2', null), rec('r3', 'https://x.example'), rec('r4', 'form:s1', 'observation'), rec('r5', 'form:nope')]);
        expect(out.map((o) => o ?? null)).toEqual([null, null, null, null, null]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('a proposed / also-applied general application names the animal it led to, when the team\'s own', async () => {
        form(sqlite(), 's3', { adopter: 'ana' });
        application(sqlite(), 'app-prop', 's3', 'luna', { origin: 'proposed', state: 'open' });
        application(sqlite(), 'app-s3', 's3', null, { state: 'proposed' });
        sqlite().prepare("UPDATE applications SET proposed_application_id = 'app-prop' WHERE id = 'app-s3'").run();
        form(sqlite(), 's4', { adopter: 'ana' });
        application(sqlite(), 'app-s4', 's4', null, { state: 'also_applied' });
        sqlite().prepare("UPDATE applications SET replaced_by_application_id = 'app-s1' WHERE id = 'app-s4'").run();
        application(sqlite(), 'app-s1', 's1', 'sol'); // her real application is for another team's animal
        const [proposed, also] = await outcomeOf([rec('r3', 'form:s3'), rec('r4', 'form:s4')]);
        expect(proposed).toEqual({ status: { kind: 'proposed' }, animal: null, outcomeAnimal: { name: 'Luna', sex: 'hembra' } });
        expect(also).toEqual({ status: { kind: 'also_applied' }, animal: null, outcomeAnimal: null });
    });

    it('a proposal whose animal is now adopted says so on the profile too', async () => {
        form(sqlite(), 's3', { adopter: 'ana' });
        application(sqlite(), 'app-prop', 's3', 'luna', { origin: 'proposed', state: 'open' });
        application(sqlite(), 'app-s3', 's3', null, { state: 'proposed' });
        sqlite().prepare("UPDATE applications SET proposed_application_id = 'app-prop' WHERE id = 'app-s3'").run();
        sqlite().prepare("INSERT INTO adopters (id, name, status, added_by) VALUES ('otra', 'Otra', '5', ?)").run(OWNER);
        sqlite().prepare("INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, ended_at) VALUES ('pl-luna', 'luna', 'otra', 'adoption', 1000, NULL)").run();
        const [proposed] = await outcomeOf([rec('r3', 'form:s3')]);
        expect(proposed).toEqual({ status: { kind: 'proposed' }, animal: null, outcomeAnimal: { name: 'Luna', sex: 'hembra', adopted: true } });
    });

    it('a failed lookup logs a warning with the adopter and the record gets no outcome', async () => {
        const db = { select: () => { throw new Error('D1 down'); } };
        const out = await attachApplicationOutcomes(db as never, [rec('r1', 'form:s1')], { teamEmails: teamFn, adopterId: 'ana' });
        expect((out[0] as { applicationOutcome?: unknown }).applicationOutcome).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('applicationOutcomes'), expect.objectContaining({ adopterId: 'ana' }));
    });
});
