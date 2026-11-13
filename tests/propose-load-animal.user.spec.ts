import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1Batch, rows } from './db';

/**
 * «Sumar a un animal» → «Cargar un animal / Cargar otro animal» (Jon
 * 2026-11-13): the request opens «Agregar animal» in that mode (the person
 * named, «Agregar y sumar a …»); saving adds the animal, adds the person to its
 * candidates, and goes back to the request in «Mis adoptantes», now «En los
 * candidatos de …» with «Cambiar animal / Quitar».
 *
 * Runs as the `user` project (testuser@example.com). Fixtures carry
 * `test-pl-fixture-*` ids (and the new animal's unique name) and are removed
 * after. Selectors are data-testids: Chromium renders English.
 */

const USER = 'testuser@example.com';
const stamp = Date.now();
const ID = (k: string) => `test-pl-fixture-${k}-${stamp}`;
const PERSON = { adopter: ID('ad'), form: ID('fs'), app: ID('app'), first: `Proponida${stamp}`, name: `Proponida${stamp} Gómez` };
const NEW_ANIMAL = `Nuevito ${stamp}`;

test.describe.serial('«Cargar un animal» from «Sumar a un animal»', () => {
    test.beforeAll(() => {
        execD1Batch([
            `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${PERSON.adopter}', '${PERSON.name}', '', '5', '${USER}', 'form', strftime('%s','now'), strftime('%s','now'))`,
            `INSERT INTO form_submissions (id, user_id, name, email, phone, status, selected_animal_id, linked_adopter_id, created_at) VALUES ('${PERSON.form}', '${USER}', '${PERSON.name}', '${PERSON.form}@example.com', '11 5555 07${String(stamp).slice(-2)}', 'pending', NULL, '${PERSON.adopter}', strftime('%s','now'))`,
            `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${PERSON.app}', '${PERSON.form}', NULL, 'form', 'open', strftime('%s','now'))`,
        ]);
    });

    test.afterAll(() => {
        execD1Batch([
            `DELETE FROM applications WHERE submission_id = '${PERSON.form}'`,
            `DELETE FROM form_submissions WHERE id = '${PERSON.form}'`,
            `DELETE FROM adopter_events WHERE adopter_id = '${PERSON.adopter}'`,
            `DELETE FROM adopter_history WHERE adopter_id = '${PERSON.adopter}'`,
            `DELETE FROM adopters WHERE id = '${PERSON.adopter}'`,
            `DELETE FROM animals WHERE name = '${NEW_ANIMAL}' AND added_by = '${USER}'`,
        ]);
    });

    test('the request → «Cargar … animal» → «Agregar y sumar» → back on the request in «Mis adoptantes», added', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto(`/my-adopters?solicitud=${PERSON.app}#pendientes`);
        await dismissCountryBanner(page);

        await page.getByTestId('evaluate-propose').click({ timeout: 60_000 });
        const load = page.getByTestId('propose-load-animal');
        await expect(load).toBeVisible({ timeout: 30_000 });
        await load.click();

        // «Agregar animal» in propose mode: the person is named, read from the request.
        await expect(page).toHaveURL(new RegExp(`/my-animals/new\\?proponer=${PERSON.app}`));
        await expect(page.getByTestId('propose-new-note')).toContainText(PERSON.first, { timeout: 30_000 });
        await page.locator('form input').first().fill(NEW_ANIMAL);
        await page.locator('form button[type="submit"]').click();

        // Back on the request, alone, in «Mis adoptantes»: among the new animal's candidates, still reversible.
        await expect(page).toHaveURL(new RegExp(`/my-adopters\\?solicitud=${PERSON.app}#pendientes`), { timeout: 60_000 });
        const panel = page.getByTestId('request-panel');
        await expect(panel.getByTestId('applicant-status-line')).toHaveAttribute('data-status', 'proposed', { timeout: 60_000 });
        await expect(panel.getByTestId('applicant-status-line')).toContainText(NEW_ANIMAL);
        await expect(panel.getByTestId('applicant-undo-quit')).toBeVisible();

        // And in the data: one open candidacy for the new animal, the general one closed as proposed.
        const apps = rows(`SELECT a.state AS state, a.animal_id AS animal, an.name AS name FROM applications a LEFT JOIN animals an ON an.id = a.animal_id WHERE a.submission_id = '${PERSON.form}' ORDER BY a.created_at`) as Array<{ state: string; animal: string | null; name: string | null }>;
        expect(apps.find(a => a.animal === null)?.state).not.toBe('open');
        expect(apps.find(a => a.name === NEW_ANIMAL)?.state).toBe('open');
    });
});
