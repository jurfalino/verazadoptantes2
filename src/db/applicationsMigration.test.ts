import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migratedDb } from '@/test-utils/migratedDb';
import {
    APPLICATION_AUTO_ACTOR, APPLICATION_CLOSE_REASONS, APPLICATION_ORIGINS, APPLICATION_STATES,
} from '@/domain/constants';

const sqlText = readFileSync(resolve(process.cwd(), 'drizzle/0106_applications.sql'), 'utf8');
const statements = sqlText.replace(/--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);

type Sqlite = ReturnType<typeof migratedDb>['sqlite'];
let sqlite: Sqlite;

const rerun0106 = () => { for (const s of statements) sqlite.exec(s + ';'); };
const rows = () => sqlite.prepare(
    'SELECT id, animal_id, origin, state, close_reason, offer_done_at FROM applications ORDER BY id',
).all();
const insertApp = (a: { id: string; submission_id: string; animal_id?: string; origin: string }) =>
    sqlite.prepare('INSERT INTO applications (id, submission_id, animal_id, origin) VALUES (?, ?, ?, ?)')
        .run(a.id, a.submission_id, a.animal_id ?? null, a.origin);

beforeEach(() => {
    ({ sqlite } = migratedDb());
    for (const id of ['luna', 'sol', 'mia']) sqlite.prepare('INSERT INTO animals (id, name) VALUES (?, ?)').run(id, id);
    const place = sqlite.prepare(
        'INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at) VALUES (?, ?, ?, ?, ?)');
    place.run('pl-sol', 'sol', 'juan', 'adoption', 1700000000);
    place.run('pl-mia', 'mia', 'x', 'foster', 1700000000);
    const form = sqlite.prepare(
        'INSERT INTO form_submissions (id, user_id, name, linked_adopter_id, selected_animal_id) VALUES (?, ?, ?, ?, ?)');
    form.run('s1', 'r@x.org', 'Ana', 'ana', 'luna');
    form.run('s2', 'r@x.org', 'Juan', 'juan', 'sol');
    form.run('s3', 'r@x.org', 'Ana', 'ana', 'sol');
    form.run('s4', 'r@x.org', 'General', 'ana', null);
    form.run('s5', 'r@x.org', 'Ana', 'ana', 'mia');
});

describe('0106_applications', () => {
    it('backfills one application per form: available → open, general → open, adopted by the applicant → adopted, adopted by someone else → closed with no offer', () => {
        rerun0106();
        expect(rows()).toEqual([
            { id: 'app-s1', animal_id: 'luna', origin: 'form', state: 'open', close_reason: null, offer_done_at: null },
            { id: 'app-s2', animal_id: 'sol', origin: 'form', state: 'adopted', close_reason: null, offer_done_at: expect.any(Number) },
            { id: 'app-s3', animal_id: 'sol', origin: 'form', state: 'closed', close_reason: 'adopted_other', offer_done_at: expect.any(Number) },
            { id: 'app-s4', animal_id: null, origin: 'form', state: 'open', close_reason: null, offer_done_at: null },
            { id: 'app-s5', animal_id: 'mia', origin: 'form', state: 'open', close_reason: null, offer_done_at: null },
        ]);
        const closed = sqlite.prepare("SELECT closed_by FROM applications WHERE id = 'app-s3'").get();
        expect(closed).toEqual({ closed_by: APPLICATION_AUTO_ACTOR });
    });

    it('re-running the migration adds nothing and changes nothing', () => {
        rerun0106();
        const a = rows();
        rerun0106();
        expect(rows()).toEqual(a);
    });

    it('one form application per submission; one proposal per (submission, animal)', () => {
        rerun0106();
        expect(() => insertApp({ id: 'dup', submission_id: 's1', origin: 'form' })).toThrow(/UNIQUE/);
        insertApp({ id: 'p1', submission_id: 's4', animal_id: 'luna', origin: 'proposed' });
        expect(() => insertApp({ id: 'p2', submission_id: 's4', animal_id: 'luna', origin: 'proposed' })).toThrow(/UNIQUE/);
        insertApp({ id: 'p3', submission_id: 's4', animal_id: 'mia', origin: 'proposed' });
    });

    it('the SQL literals equal the domain constants', () => {
        expect(APPLICATION_STATES.OPEN).toBe('open');
        expect(APPLICATION_STATES.ADOPTED).toBe('adopted');
        expect(APPLICATION_STATES.CLOSED).toBe('closed');
        expect(APPLICATION_ORIGINS.FORM).toBe('form');
        expect(APPLICATION_ORIGINS.PROPOSED).toBe('proposed');
        expect(APPLICATION_CLOSE_REASONS.ADOPTED_OTHER).toBe('adopted_other');
        for (const lit of [
            APPLICATION_STATES.OPEN, APPLICATION_STATES.ADOPTED, APPLICATION_STATES.CLOSED,
            APPLICATION_ORIGINS.FORM, APPLICATION_ORIGINS.PROPOSED,
            APPLICATION_CLOSE_REASONS.ADOPTED_OTHER, APPLICATION_AUTO_ACTOR,
        ]) expect(sqlText).toContain(`'${lit}'`);
    });
});
