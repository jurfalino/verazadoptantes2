import { describe, it, expect, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { createApplicationForSubmission } from './applicationWrites';

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
