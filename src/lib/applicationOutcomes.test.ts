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
const rec = (id: string, sourceUrl: string | null, recordType = 'adoption_request') => ({ id, recordType, sourceUrl });
const outcomeOf = async (records: ReturnType<typeof rec>[], team: string[] = TEAM) =>
    (await attachApplicationOutcomes(asyncDb(m.db) as never, records, { teamEmails: team, adopterId: 'ana' })).map((r) => (r as { applicationOutcome?: unknown }).applicationOutcome);

beforeEach(() => {
    warn.mockClear();
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

    it('another team\'s animal is never named', async () => {
        form(sqlite(), 's2', { adopter: 'ana', animal: 'sol' });
        application(sqlite(), 'app-s2', 's2', 'sol', { state: 'closed', closeReason: 'adopted_other' });
        const [o] = await outcomeOf([rec('r2', 'form:s2')]);
        expect(o).toEqual({ status: { kind: 'closed', reason: 'adopted_other' }, animal: null, outcomeAnimal: null });
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

    it('a failed lookup logs a warning with the adopter and the record gets no outcome', async () => {
        const db = { select: () => { throw new Error('D1 down'); } };
        const out = await attachApplicationOutcomes(db as never, [rec('r1', 'form:s1')], { teamEmails: TEAM, adopterId: 'ana' });
        expect((out[0] as { applicationOutcome?: unknown }).applicationOutcome).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('applicationOutcomes'), expect.objectContaining({ adopterId: 'ana' }));
    });
});
