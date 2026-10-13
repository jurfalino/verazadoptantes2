import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * ENABLE_ORIGIN_LABELS: where a profile and its activities came from, as a
 * small tag on the profile and its activities (Mis Adoptantes already shows
 * the profile's origin). Off → no tags on the profile.
 * Dedicated fixtures, removed afterwards; the flag is restored to off.
 */
function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const ID = 'test-origin-fixture-1';
const EVENT = 'test-origin-fixture-event-1';
const NAME = 'Origenfixture Importada';
const setFlag = (on: boolean) => on
    ? execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_ORIGIN_LABELS', 'true', strftime('%s','now'), 'e2e')`)
    : execD1(`DELETE FROM app_config WHERE key = 'ENABLE_ORIGIN_LABELS'`);

test.describe.configure({ mode: 'serial' });

test.describe('origin labels', () => {
    test.beforeAll(() => {
        execD1(`INSERT OR REPLACE INTO adopters (id, name, source, added_by, created_at, updated_at) VALUES ('${ID}', '${NAME}', 'imported', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now'))`);
        execD1(`INSERT OR REPLACE INTO adopter_events (id, adopter_id, event_type, details, date, recorded_by, source_url) VALUES ('${EVENT}', '${ID}', 'adoption_request', 'Pedido por formulario', strftime('%s','now'), 'gatitosolivos@gmail.com', 'form:test-origin-form')`);
    });
    test.afterAll(() => {
        setFlag(false);
        execD1(`DELETE FROM adopter_events WHERE id = '${EVENT}'`);
        execD1(`DELETE FROM adopters WHERE id = '${ID}'`);
    });

    test('off: no origin tags', async ({ page }) => {
        setFlag(false);
        await page.goto(`/adopter/${ID}`);
        await dismissCountryBanner(page);
        await expect(page.locator(`[id="adoption-${EVENT}"]`)).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('origin-tag')).toHaveCount(0);
    });

    test('on: the profile says it was imported, and the activity that it came from a form', async ({ page }) => {
        setFlag(true);
        await page.goto(`/adopter/${ID}`);
        await dismissCountryBanner(page);
        await expect(page.locator(`[id="adoption-${EVENT}"]`)).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('origin-tag').filter({ hasText: /Importado|Imported/ }).first()).toBeVisible();
        await expect(page.locator(`[id="adoption-${EVENT}"]`).getByTestId('origin-tag')).toHaveText(/Formulario|Form/);

    });
});
