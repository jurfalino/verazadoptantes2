import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * ENABLE_INTERVIEW_GUIDE is off in the seed; this file turns it on for itself
 * and is the ONLY spec that touches it (serial, so toggles never race).
 * Fixtures: test-interview-fixture-* rows and a uniquely named created person.
 */
function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const flagOn = () => execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_INTERVIEW_GUIDE', 'true', strftime('%s','now'), 'e2e')`);
const flagOff = () => execD1(`DELETE FROM app_config WHERE key = 'ENABLE_INTERVIEW_GUIDE'`);

const FIXTURE = 'test-interview-fixture-1';
const FIXTURE_NAME = 'Rodolfo Entrevistafixture';
const FOREIGN = 'test-interview-fixture-2';
const FOREIGN_EVENT = 'test-interview-fixture-ev-2';
const FOREIGN_INTERVIEW = 'test-interview-fixture-iv-2';
const NEW_NAME = `Persona Entrevista ${Date.now()}`;
const NEW_PHONE = '11 7777 2233';

async function pastTechnique(page: Page) {
    const go = page.getByTestId('interview-technique-continue');
    if (await go.isVisible({ timeout: 15000 }).catch(() => false)) await go.click();
}

test.describe.configure({ mode: 'serial' });

test.describe('interview guide', () => {
    test.beforeAll(() => {
        flagOn();
        execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, contact_entries, country, status, added_by, deleted_at, created_at, updated_at) VALUES ('${FIXTURE}', '${FIXTURE_NAME}', 'Tel: 11 4444 9911', '[{"type":"phone","value":"1144449911"}]', 'AR', '4', 'gatitosolivos@gmail.com', NULL, strftime('%s','now'), strftime('%s','now'))`);
        // A completed interview by the ADMIN on a profile the regular user doesn't own.
        execD1(`INSERT OR REPLACE INTO adopters (id, name, country, status, added_by, deleted_at, created_at, updated_at) VALUES ('${FOREIGN}', 'Marta Entrevistada', 'AR', '4', 'gatitosolivos@gmail.com', NULL, strftime('%s','now'), strftime('%s','now'))`);
        execD1(`INSERT OR REPLACE INTO adopter_events (id, adopter_id, event_type, rating, details, date, recorded_by) VALUES ('${FOREIGN_EVENT}', '${FOREIGN}', 'observation', 4, 'Resumen visible', strftime('%s','now'), 'gatitosolivos@gmail.com')`);
        execD1(`INSERT OR REPLACE INTO interviews (id, conducted_by, status, source_kind, prep_json, answers_json, candidate_ids_json, adopter_id, event_id, completed_at) VALUES ('${FOREIGN_INTERVIEW}', 'gatitosolivos@gmail.com', 'completed', 'standalone', '{}', '{}', '[]', '${FOREIGN}', '${FOREIGN_EVENT}', strftime('%s','now'))`);
    });

    test.afterAll(() => {
        execD1(`DELETE FROM adopter_events WHERE id = '${FOREIGN_EVENT}' OR adopter_id IN (SELECT id FROM adopters WHERE name = '${NEW_NAME}' OR id = '${FIXTURE}')`);
        execD1(`DELETE FROM interviews WHERE id = '${FOREIGN_INTERVIEW}' OR conducted_by = 'gatitosolivos@gmail.com'`);
        execD1(`DELETE FROM duplicate_tokens WHERE adopter_id IN (SELECT id FROM adopters WHERE name = '${NEW_NAME}')`);
        execD1(`DELETE FROM adopters WHERE name = '${NEW_NAME}' OR id IN ('${FIXTURE}', '${FOREIGN}')`);
        flagOff();
    });

    test('standalone: prep → technique → answers survive reload → save as new person → badge on profile', async ({ page }) => {
        await page.goto('/interview');
        await dismissCountryBanner(page);
        await page.getByTestId('interview-prep-name').fill(NEW_NAME);
        await page.getByTestId('interview-prep-phone-0').fill(NEW_PHONE);
        await page.getByTestId('interview-start').click();

        await expect(page.getByTestId('interview-technique')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('interview-technique-continue').click();

        await expect(page.getByTestId('interview-question')).toBeVisible();
        await page.getByTestId('interview-choice-yes').click();
        await page.getByTestId('interview-next').click();
        await page.getByTestId('interview-answer').fill('Por Instagram');
        await expect(page.getByTestId('interview-save-status')).toHaveText(/Guardado|Saved|Salvo/, { timeout: 15000 });

        await page.goto('/interview');
        await expect(page.getByTestId('interview-drafts')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('interview-drafts').getByRole('button', { name: /^(Continuar|Continue)$/ }).first().click();
        // The question answered before the reload shows its saved answer as the rail preview (the current item hides its preview).
        await expect(page.getByTestId('interview-rail').locator('[data-testid^="interview-rail-item-"]').filter({ hasText: /Por Instagram/ })).toHaveCount(1, { timeout: 30000 });

        await page.getByTestId('interview-finish').click();
        await page.getByTestId('interview-review-new').click();
        await page.getByTestId('interview-review-save').click();

        await expect(page).toHaveURL(/\/adopter\//, { timeout: 30000 });
        await expect(page.getByTestId('interview-badge').first()).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('interview-view-answers').first()).toBeVisible();
    });

    test('the same phone now surfaces that profile as a candidate', async ({ page }) => {
        await page.goto('/interview');
        await dismissCountryBanner(page);
        await page.getByTestId('interview-prep-name').fill(NEW_NAME);
        await page.getByTestId('interview-prep-phone-0').fill(NEW_PHONE);
        await expect(page.getByTestId('interview-candidate').filter({ hasText: NEW_NAME })).toBeVisible({ timeout: 30000 });
    });

    test('the profile ⋯ menu offers «Entrevistar» and it opens the interview on that profile', async ({ page }) => {
        await page.goto(`/adopter/${FIXTURE}`);
        await dismissCountryBanner(page);
        await page.getByTestId('profile-overflow').click();
        await page.getByTestId('profile-interview').click();
        await expect(page).toHaveURL(new RegExp(`/interview\\?adopterId=${FIXTURE}`), { timeout: 30000 });
    });

    test('from a profile: starts confirmed and skips preparation', async ({ page }) => {
        await page.goto(`/interview?adopterId=${FIXTURE}`);
        await dismissCountryBanner(page);
        await pastTechnique(page);
        await expect(page.getByTestId('interview-candidate-status')).toContainText(FIXTURE_NAME, { timeout: 30000 });
        await expect(page.getByTestId('interview-prep-name')).toHaveCount(0);
    });

    test('desktop width: no horizontal scroll, rail visible beside the question', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`/interview?adopterId=${FIXTURE}`);
        await dismissCountryBanner(page);
        await pastTechnique(page);
        await expect(page.getByTestId('interview-focus')).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('interview-rail')).toBeVisible();
        await expect(page.getByTestId('interview-rail-toggle')).toBeHidden();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });

    test.describe('phone width', () => {
        test.use({ viewport: { width: 390, height: 844 } });
        test('no horizontal scroll; the rail opens as a drawer', async ({ page }) => {
            await page.goto(`/interview?adopterId=${FIXTURE}`);
            await dismissCountryBanner(page);
            await pastTechnique(page);
            await expect(page.getByTestId('interview-focus')).toBeVisible({ timeout: 30000 });
            await expect(page.getByTestId('interview-rail')).toBeHidden();
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow).toBeLessThanOrEqual(0);
            await page.getByTestId('interview-rail-toggle').click();
            await expect(page.getByTestId('interview-rail')).toBeVisible();
        });
    });

    test.describe('another rescuer', () => {
        test.use({ storageState: '.auth/user.json' });
        test('sees that an interview happened (summary + rating) but cannot open the answers', async ({ page }) => {
            await page.goto(`/adopter/${FOREIGN}`);
            await dismissCountryBanner(page);
            await expect(page.getByTestId('interview-badge').first()).toBeVisible({ timeout: 30000 });
            await expect(page.getByText('Resumen visible')).toBeVisible();
            await expect(page.getByTestId('interview-view-answers')).toHaveCount(0);
            const res = await page.goto(`/interview/${FOREIGN_INTERVIEW}`);
            expect(res?.status()).toBe(404);
        });
    });

    test('flag off: /interview does not exist, the menu has no «Entrevistar», the badge is gone', async ({ page }) => {
        flagOff();
        const res = await page.goto('/interview');
        expect(res?.status()).toBe(404);
        await page.goto(`/adopter/${FOREIGN}`); // this profile HAS a completed interview
        await dismissCountryBanner(page);
        await expect(page.getByText('Resumen visible')).toBeVisible({ timeout: 30000 }); // the observation itself stays
        await expect(page.getByTestId('interview-badge')).toHaveCount(0);
        await page.getByTestId('profile-overflow').click();
        await expect(page.getByTestId('profile-interview')).toHaveCount(0);
    });
});
