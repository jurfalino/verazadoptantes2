import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1Batch, rows } from './db';

/**
 * The two edges of «Formularios generales» the review found untested (review M8, Jon 2026-11-13):
 * - more pairs than one page of «Pendientes de revisar»: the general forms stay first and complete on every page;
 * - «Enviar contrato» from a candidacy a teammate's «Quitar» removed meanwhile: nothing is sent, and it says so.
 *
 * Runs as the `user` project (testuser@example.com). Fixtures carry `test-ge-fixture-*` ids and are removed after.
 */

const USER = 'testuser@example.com';
const stamp = Date.now();
const ID = (k: string) => `test-ge-fixture-${k}-${stamp}`;

test.describe.serial('«Formularios generales»: many pairs, and a contract after «Quitar»', () => {
    const PAIRS = 12; // PAGE_SIZE is 10: two pages of pairs
    const pairs = Array.from({ length: PAIRS }, (_, i) => ({ a: ID(`pa${i}`), b: ID(`pb${i}`), cand: ID(`pc${i}`), name: `Parecida${i} ${stamp}` }));
    const forms = Array.from({ length: 3 }, (_, i) => ({ adopter: ID(`ga${i}`), form: ID(`gf${i}`), app: ID(`gp${i}`), name: `Generala${i} ${stamp}` }));
    const ANIMAL = ID('animal');
    const ANIMAL_NAME = `Quitada ${stamp}`;
    const P = { adopter: ID('qa'), form: ID('qf'), app: ID('qg'), cand: ID('qc'), name: `Quitado${stamp} Ruiz` };
    const NOTICE = { id: ID('notice'), title: `Nuevo formulario ${stamp}` };

    test.beforeAll(() => {
        execD1Batch([
            ...pairs.flatMap(p => [
                `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ('${p.a}', '${p.name}', '', '5', '${USER}', strftime('%s','now','-2 days'), strftime('%s','now','-2 days'))`,
                `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ('${p.b}', '${p.name} G.', '', '5', '${USER}', strftime('%s','now'), strftime('%s','now'))`,
                `INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at) VALUES ('${p.cand}', '${p.b}', '${p.a}', '["name_word"]', '{}', 100, 'high', 'pending', strftime('%s','now'))`,
            ]),
            ...forms.flatMap((f, i) => [
                `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${f.adopter}', '${f.name}', '', '5', '${USER}', 'form', strftime('%s','now','-${i + 1} hours'), strftime('%s','now','-${i + 1} hours'))`,
                `INSERT INTO form_submissions (id, user_id, name, email, status, linked_adopter_id, created_at) VALUES ('${f.form}', '${USER}', '${f.name}', '${f.form}@example.com', 'linked', '${f.adopter}', strftime('%s','now','-${i + 1} hours'))`,
                `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${f.app}', '${f.form}', NULL, 'form', 'open', strftime('%s','now','-${i + 1} hours'))`,
            ]),
            // A general form already added to the team's animal: the candidacy (origin proposed) is open.
            `INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('${ANIMAL}', '${ANIMAL_NAME}', 'dog', 'macho', '${USER}', strftime('%s','now','-5 days'), strftime('%s','now','-5 days'))`,
            `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${P.adopter}', '${P.name}', '', '5', '${USER}', 'form', strftime('%s','now','-1 day'), strftime('%s','now','-1 day'))`,
            `INSERT INTO form_submissions (id, user_id, name, email, status, linked_adopter_id, created_at) VALUES ('${P.form}', '${USER}', '${P.name}', '${P.form}@example.com', 'linked', '${P.adopter}', strftime('%s','now','-1 day'))`,
            `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${P.cand}', '${P.form}', '${ANIMAL}', 'proposed', 'open', strftime('%s','now','-1 hours'))`,
            `INSERT INTO applications (id, submission_id, animal_id, origin, state, proposed_application_id, closed_at, closed_by, created_at) VALUES ('${P.app}', '${P.form}', NULL, 'form', 'proposed', '${P.cand}', strftime('%s','now','-1 hours'), '${USER}', strftime('%s','now','-1 day'))`,
            // A bell notice for the first general form, as the form route writes it (requestHref).
            `INSERT INTO notifications (id, user_id, type, title, body, url, icon, read, dismissed, created_at) VALUES ('${NOTICE.id}', '${USER}', 'form_submission', '${NOTICE.title}', 'Formulario general', '/my-adopters?solicitud=${forms[0].app}#pendientes', 'x', 0, 0, strftime('%s','now','+1 hour'))`,
        ]);
    });

    test.afterAll(() => {
        const adopters = [...pairs.flatMap(p => [p.a, p.b]), ...forms.map(f => f.adopter), P.adopter];
        execD1Batch([
            ...pairs.map(p => `DELETE FROM duplicate_candidates WHERE id = '${p.cand}'`),
            ...[...forms.map(f => f.form), P.form].flatMap(f => [`DELETE FROM applications WHERE submission_id = '${f}'`, `DELETE FROM form_submissions WHERE id = '${f}'`]),
            `DELETE FROM contract_invitations WHERE adopter_id = '${P.adopter}'`,
            ...adopters.flatMap(a => [`DELETE FROM adopter_history WHERE adopter_id = '${a}'`, `DELETE FROM adopters WHERE id = '${a}'`]),
            `DELETE FROM animals WHERE id = '${ANIMAL}'`,
            `DELETE FROM notifications WHERE id = '${NOTICE.id}'`,
        ]);
    });

    const requestsFirstAndComplete = async (page: import('@playwright/test').Page) => {
        await expect(page.getByTestId('general-request-row').filter({ hasText: String(stamp) })).toHaveCount(forms.length, { timeout: 30_000 });
        const first = await page.evaluate(() => {
            const g = document.querySelector('[data-testid="general-requests-heading"]');
            const d = document.querySelector('[data-testid^="dedup-group-"]');
            return !!g && (!d || !!(g.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING));
        });
        expect(first, 'the general forms come before the pairs').toBe(true);
    };

    test('more pairs than one page: the general forms are first and complete on page 1 and page 2', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto('/my-adopters#pendientes');
        await dismissCountryBanner(page);
        await expect(page.getByTestId('general-requests-heading')).toBeVisible({ timeout: 60_000 });
        await requestsFirstAndComplete(page);
        const next = page.getByRole('button', { name: /Siguiente|Next|Próximo/ }).last();
        await expect(next).toBeEnabled({ timeout: 30_000 });
        const counter = page.getByText(/^\s*1 \/ \d+\s*$/);
        await expect(counter).toBeVisible();
        await next.click();
        await expect(page.getByText(/^\s*2 \/ \d+\s*$/)).toBeVisible({ timeout: 30_000 });
        await requestsFirstAndComplete(page);
    });

    test('a bell notice for a general form opens it while already on «Mis adoptantes» (review I-2)', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto('/my-adopters');
        await dismissCountryBanner(page);
        await expect(page.getByTestId('general-requests-heading')).toBeVisible({ timeout: 60_000 });
        await page.getByRole('button', { name: /Notifications|Notificaciones|Notificações/i }).click();
        await page.getByText(NOTICE.title).click();
        await expect(page.getByTestId('request-panel')).toContainText(forms[0].name, { timeout: 30_000 });
    });

    test('«Enviar contrato» after a teammate\'s «Quitar»: nothing is sent, and it says why', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto(`/my-animals?view=solicitudes&animal=${ANIMAL}&solicitud=${P.cand}`);
        await dismissCountryBanner(page);
        const panel = page.getByTestId('my-animals-applicants-panel');
        await expect(panel.locator('#applicant-panel-title')).toContainText(P.name, { timeout: 60_000 });
        const send = panel.getByTestId('evaluate-send-contract');
        await expect(send).toBeEnabled({ timeout: 30_000 });

        // Meanwhile a teammate takes them out (what withdrawProposal writes).
        execD1Batch([
            `DELETE FROM applications WHERE id = '${P.cand}'`,
            `UPDATE applications SET state = 'open', proposed_application_id = NULL, closed_at = NULL, closed_by = NULL WHERE id = '${P.app}'`,
        ]);

        await send.click();
        await expect(page.getByText(/ya no está entre los candidatos|no longer among|já não está entre/)).toBeVisible({ timeout: 30_000 });
        expect(rows(`SELECT token FROM contract_invitations WHERE adopter_id = '${P.adopter}'`)).toHaveLength(0);
    });
});
