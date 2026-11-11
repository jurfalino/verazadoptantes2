/** Jon 2026-11-11: an animal whose only link is an open application is KEPT by the record delete (never silently loses candidates). */
import { describe, it, expect } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { asyncDb, seedEvaluation, form, application, type Sqlite } from '@/test-utils/applicationFixtures';
import { decideAnimalFate } from '@/domain/animalDeletion';
import { countAnimalLinks } from './_recordWrite';

function world() {
    const m = migratedDb();
    const sqlite = m.sqlite as unknown as Sqlite;
    seedEvaluation(sqlite);
    return { db: asyncDb(m.db), sqlite };
}

describe('countAnimalLinks — open applications', () => {
    it('keeps an animal whose only link is an open application', async () => {
        const { db } = world();
        const links = await countAnimalLinks(db as never, 'luna', null);
        expect(links.formsAndContracts).toBe(1);
        expect(decideAnimalFate({ links })).toBe('keep');
    });
    it('keeps an animal whose only link is a PROPOSED application (no form for this animal)', async () => {
        const { db, sqlite } = world();
        application(sqlite, 'app-prop', 's-gen', 'luna', { origin: 'proposed' });
        sqlite.prepare("UPDATE applications SET state = 'closed' WHERE id = 'app-s-luna'").run();
        const links = await countAnimalLinks(db as never, 'luna', null);
        expect(links.formsAndContracts).toBe(1);
        expect(decideAnimalFate({ links })).toBe('keep');
    });
    it('decided or closed applications do not keep it', async () => {
        const { db, sqlite } = world();
        sqlite.prepare("UPDATE applications SET state = 'declined' WHERE id = 'app-s-luna'").run();
        form(sqlite, 's2', { adopter: 'ana', animal: 'luna' });
        application(sqlite, 'app-2', 's2', 'luna', { state: 'closed', closeReason: 'adopted_other' });
        const links = await countAnimalLinks(db as never, 'luna', null);
        expect(links.formsAndContracts).toBe(0);
        expect(decideAnimalFate({ links })).toBe('soft-delete');
    });
});
