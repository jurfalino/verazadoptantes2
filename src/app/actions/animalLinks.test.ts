/**
 * Jon 2026-11-11: deleting an animal that has candidates is allowed, with a warning that they are lost (the
 * people's profiles stay). The record delete («Es el único registro de Luna…») keeps its two choices — open
 * applications never force the animal to stay; the dialog says how many candidates «mover a la papelera» loses.
 */
import { describe, it, expect } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { asyncDb, seedEvaluation, form, application, type Sqlite } from '@/test-utils/applicationFixtures';
import { decideAnimalFate } from '@/domain/animalDeletion';
import { countAnimalLinks } from './_recordWrite';
import { countOpenApplicationsForAnimal } from '@/lib/applicationWrites';

function world() {
    const m = migratedDb();
    const sqlite = m.sqlite as unknown as Sqlite;
    seedEvaluation(sqlite);
    return { db: asyncDb(m.db), sqlite };
}

describe('record delete of an animal with candidates', () => {
    it('open applications do not keep the animal: «mover a la papelera» stays a choice', async () => {
        const { db } = world();
        const links = await countAnimalLinks(db as never, 'luna', null);
        expect(links.formsAndContracts).toBe(0);
        expect(decideAnimalFate({ links })).toBe('soft-delete');
    });

    it('counts the candidates the trash would lose: open ones of any origin, proposals included', async () => {
        const { db, sqlite } = world();
        expect(await countOpenApplicationsForAnimal(db as never, 'luna')).toBe(1);
        application(sqlite, 'app-prop', 's-gen', 'luna', { origin: 'proposed' });
        expect(await countOpenApplicationsForAnimal(db as never, 'luna')).toBe(2);
    });

    it('decided or closed applications are not counted', async () => {
        const { db, sqlite } = world();
        sqlite.prepare("UPDATE applications SET state = 'declined' WHERE id = 'app-s-luna'").run();
        form(sqlite, 's2', { adopter: 'ana', animal: 'luna' });
        application(sqlite, 'app-2', 's2', 'luna', { state: 'closed', closeReason: 'adopted_other' });
        expect(await countOpenApplicationsForAnimal(db as never, 'luna')).toBe(0);
    });
});
