import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * A tab older than the running deployment (audit 2026-09-19).
 *
 * Simulated by rewriting the build id this tab sends on its server calls, so
 * the middleware (APP_BUILD_ID='e2e-build' via playwright.config) sees a stale
 * build. Proves the two behaviours that matter:
 *   - a SAVE does not reload (typed input survives) and shows the notice;
 *   - a SEARCH, a read, reloads onto the current build by itself.
 */

const ID = 'test-deploy-skew-fixture-1';
const NAME = 'SkewFixture Titular';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
}

/** Make this tab's server-action calls claim an old build, once. */
async function goStale(page: Page) {
    let used = false;
    await page.route('**/*', async (route) => {
        const req = route.request();
        if (!used && req.method() === 'POST' && req.headers()['next-action']) {
            used = true;
            await route.continue({ headers: { ...req.headers(), 'x-deployment-id': 'stale-e2e-build' } });
            return;
        }
        await route.continue();
    });
}

test.describe('deploy skew — a tab older than the running deployment', () => {
    test.beforeAll(() => {
        execD1(
            `INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, created_at, updated_at) ` +
            `VALUES ('${ID}', '${NAME}', 'skew-fixture-contact', 'AR', '5', 'gatitosolivos@gmail.com', NULL, strftime('%s','now'), strftime('%s','now'))`,
        );
    });
    test.afterAll(() => { execD1(`DELETE FROM adopters WHERE id = '${ID}'`); });

    test('a save keeps what was typed and offers a reload instead of reloading', async ({ page }) => {
        await page.goto(`/adopter/${ID}`);
        await dismissCountryBanner(page);
        await expect(page.getByRole('heading', { name: NAME })).toBeVisible({ timeout: 30000 });
        let navigations = 0;
        page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });

        await goStale(page);
        await page.locator('main button[aria-label="Editar"], main button[aria-label="Edit"]').first().click();
        await page.locator('main input:focus').fill(`${NAME} typed`);
        await page.getByRole('button', { name: /Guardar|Save/ }).first().click();

        await expect(page.getByText(/Hay una versión nueva|A new version is available|Há uma versão nova/)).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: /^(Recargar|Reload|Recarregar)$/ })).toBeVisible();
        expect(navigations).toBe(0);
        const typed = await page.evaluate(() => [...document.querySelectorAll('main input')].some(el => (el as HTMLInputElement).value.endsWith('typed')));
        expect(typed).toBe(true);
        await expect(page.getByText('DEPLOYMENT_SKEW')).toHaveCount(0);
        // The save never ran.
        const rows = JSON.parse(execD1(`SELECT name FROM adopters WHERE id='${ID}'`))[0].results;
        expect(rows[0].name).toBe(NAME);
    });

    test('a search reloads onto the current build by itself', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        await goStale(page);
        // Generous: in a full run the dev server may still be compiling the action route.
        const reloaded = page.waitForEvent('framenavigated', { timeout: 45000 });
        await page.fill('input#search', 'SkewFixture');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();
        await reloaded;
        await expect(page.getByText(/Búsqueda fallida|Search failed/)).toHaveCount(0);
    });
});
