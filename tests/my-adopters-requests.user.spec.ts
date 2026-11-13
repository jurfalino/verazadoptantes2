import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1Batch } from './db';

/**
 * «Formularios generales» in «Mis adoptantes» (Jon 2026-11-13): a general form is a person to evaluate. The
 * «Pendientes de revisar» section opens by itself, lists the request first, and a row — or the request's own
 * link, as notices and emails carry it — opens that request alone (no «Anterior / Siguiente»).
 *
 * Runs as the `user` project (testuser@example.com). Fixtures carry `test-gr-fixture-*` ids.
 */

const USER = 'testuser@example.com';
const stamp = Date.now();
const ID = (k: string) => `test-gr-fixture-${k}-${stamp}`;
const P = { adopter: ID('ad'), form: ID('fs'), app: ID('app'), name: `Generalina${stamp} Paz` };

test.describe.serial('Formularios generales in Mis adoptantes', () => {
    test.beforeAll(() => {
        execD1Batch([
            `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${P.adopter}', '${P.name}', '', '5', '${USER}', 'form', strftime('%s','now'), strftime('%s','now'))`,
            `INSERT INTO form_submissions (id, user_id, name, email, phone, status, selected_animal_id, linked_adopter_id, auto_adopter_id, species, life_stage, created_at) VALUES ('${P.form}', '${USER}', '${P.name}', '${P.form}@example.com', '11 5555 08${String(stamp).slice(-2)}', 'pending', NULL, '${P.adopter}', '${P.adopter}', 'dog', 'puppy', strftime('%s','now'))`,
            `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${P.app}', '${P.form}', NULL, 'form', 'open', strftime('%s','now'))`,
        ]);
    });

    test.afterAll(() => {
        execD1Batch([
            `DELETE FROM applications WHERE submission_id = '${P.form}'`,
            `DELETE FROM form_submissions WHERE id = '${P.form}'`,
            `DELETE FROM adopters WHERE id = '${P.adopter}'`,
        ]);
    });

    test('the section opens by itself, the request is listed first, a row opens it alone', async ({ page }) => {
        test.setTimeout(120_000);
        await page.goto('/my-adopters');
        await dismissCountryBanner(page);
        await expect(page.getByTestId('general-requests-heading')).toBeVisible({ timeout: 60_000 });
        const row = page.getByTestId('general-request-row').filter({ hasText: P.name });
        await expect(row).toHaveCount(1);
        // Before any duplicate-pair group.
        const first = await page.evaluate(() => {
            const g = document.querySelector('[data-testid="general-requests-heading"]');
            const d = document.querySelector('[data-testid^="dedup-group-"]');
            return !!g && (!d || !!(g.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING));
        });
        expect(first).toBe(true);

        await row.click();
        await expect(page.getByTestId('applicant-panel-single-header')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('request-panel')).toContainText(P.name);
        await expect(page.getByTestId('request-panel').getByRole('button', { name: /Siguiente|Next/ })).toHaveCount(0);
    });

    test('the request\'s own link opens it alone', async ({ page }) => {
        await page.goto(`/my-adopters?solicitud=${P.app}#pendientes`);
        await dismissCountryBanner(page);
        await expect(page.getByTestId('applicant-panel-single-header')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('request-panel')).toContainText(P.name);
    });
});
