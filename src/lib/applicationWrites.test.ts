import { describe, it, expect, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { createApplicationForSubmission, healMissingApplications } from './applicationWrites';

let m: ReturnType<typeof migratedDb>;
beforeEach(() => { m = migratedDb(); });
const rows = () => m.sqlite.prepare('SELECT id, submission_id, animal_id, origin, asked_animal_id, state, created_at FROM applications').all();

describe('createApplicationForSubmission', () => {
    it('submit for an adopted animal stores a general «adopted_animal» application remembering the animal', async () => {
        const id = await createApplicationForSubmission(m.db as never, {
            submissionId: 's1', selectedAnimalId: 'luna',
            animal: { recordType: 'adoption', adopterId: 'juan' }, createdAt: new Date(1_700_000_000_000),
        });
        expect(id).toBe('app-s1');
        expect(rows()).toEqual([{
            id: 'app-s1', submission_id: 's1', animal_id: null, origin: 'adopted_animal',
            asked_animal_id: 'luna', state: 'open', created_at: 1_700_000_000,
        }]);
    });

    it('an available animal keeps the animal; no animal is a general application', async () => {
        await createApplicationForSubmission(m.db as never, {
            submissionId: 's2', selectedAnimalId: 'sol', animal: { recordType: 'available', adopterId: null }, createdAt: new Date(),
        });
        await createApplicationForSubmission(m.db as never, {
            submissionId: 's3', selectedAnimalId: null, animal: null, createdAt: new Date(),
        });
        expect(rows().map((r: any) => [r.id, r.animal_id, r.origin])).toEqual([['app-s2', 'sol', 'form'], ['app-s3', null, 'form']]);
    });

    it('called twice for one submission → one row', async () => {
        const input = { submissionId: 's1', selectedAnimalId: 'luna', animal: undefined, createdAt: new Date() };
        await createApplicationForSubmission(m.db as never, input);
        await createApplicationForSubmission(m.db as never, input);
        expect(rows()).toHaveLength(1);
    });
});

describe('healMissingApplications', () => {
    const OWNER = 'owner@example.com';
    const form = (id: string, userId: string, animal: string | null) =>
        m.sqlite.prepare('INSERT INTO form_submissions (id, user_id, name, selected_animal_id, created_at) VALUES (?, ?, ?, ?, 1700000000)').run(id, userId, id, animal);
    const heal = (team: string[] = [OWNER]) => healMissingApplications(m.db as never, team);

    it('a form with no application row gets one: animal kept, origin form, id app-<id>, created_at of the form', async () => {
        form('s1', OWNER, 'luna');
        expect(await heal()).toBe(1);
        expect(rows()).toEqual([{ id: 'app-s1', submission_id: 's1', animal_id: 'luna', origin: 'form', asked_animal_id: null, state: 'open', created_at: 1_700_000_000 }]);
    });

    it('a form for an adopted animal heals as a general «adopted_animal» application', async () => {
        m.sqlite.prepare("INSERT INTO animals (id, name) VALUES ('mora', 'Mora')").run();
        m.sqlite.prepare("INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at) VALUES ('p1', 'mora', 'x', 'adoption', 1)").run();
        form('s2', OWNER, 'mora');
        expect(await heal()).toBe(1);
        expect(rows()).toEqual([expect.objectContaining({ id: 'app-s2', animal_id: null, origin: 'adopted_animal', asked_animal_id: 'mora' })]);
    });

    it('a second run inserts nothing; a form that already has an application is untouched', async () => {
        form('s1', OWNER, 'luna'); form('s3', OWNER, null);
        await createApplicationForSubmission(m.db as never, { submissionId: 's3', selectedAnimalId: null, animal: null, createdAt: new Date() });
        expect(await heal()).toBe(1);
        expect(await heal()).toBe(0);
        expect(rows()).toHaveLength(2);
    });

    it('another team\'s form is not healed, and an empty team is a no-op', async () => {
        form('s4', 'stranger@example.com', 'luna');
        expect(await heal()).toBe(0);
        expect(await heal([])).toBe(0);
        expect(rows()).toHaveLength(0);
    });
});
