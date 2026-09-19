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

/** Make this tab's server-action calls claim an old, unknown build. Returns the statuses seen. */
async function goStale(page: Page): Promise<number[]> {
    const statuses: number[] = [];
    await page.route('**/*', async (route) => {
        const req = route.request();
        if (req.method() === 'POST' && req.headers()['next-action']) {
            const res = await route.fetch({ headers: { ...req.headers(), 'x-deployment-id': 'stale-e2e-build' } });
            statuses.push(res.status());
            await route.fulfill({ response: res });
            return;
        }
        await route.continue();
    });
    return statuses;
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

        const statuses = await goStale(page);
        await page.locator('main button[aria-label="Editar"], main button[aria-label="Edit"]').first().click();
        await page.locator('main input:focus').fill(`${NAME} typed`);
        await page.getByRole('button', { name: /Guardar|Save/ }).first().click();

        await expect(page.getByText(/Hay una versión nueva|A new version is available|Há uma versão nova/)).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: /^(Recargar|Reload|Recarregar)$/ })).toBeVisible();
        expect(statuses).toContain(409);
        // No error toast beside the notice, and no late reload.
        await expect(page.getByText(/Error ID:/)).toHaveCount(0);
        await page.waitForTimeout(2500);
        expect(navigations).toBe(0);
        const typed = await page.evaluate(() => [...document.querySelectorAll('main input')].some(el => (el as HTMLInputElement).value.endsWith('typed')));
        expect(typed).toBe(true);
        await expect(page.getByText('DEPLOYMENT_SKEW')).toHaveCount(0);
        // The save never ran.
        const rows = JSON.parse(execD1(`SELECT name FROM adopters WHERE id='${ID}'`))[0].results;
        expect(rows[0].name).toBe(NAME);

        // Audit 2, F1: pressing Guardar again must NOT close the editor as if saved.
        await page.getByRole('button', { name: /Guardar|Save/ }).first().click();
        await page.waitForTimeout(1500);
        await expect(page.getByRole('button', { name: /Guardar|Save/ }).first()).toBeVisible();

        // Audit 2, F2: dismiss the notice, try again — it must come back.
        const notice = page.getByText(/Hay una versión nueva|A new version is available|Há uma versão nova/);
        await page.getByTestId('toast-dismiss').last().click();
        await expect(notice).toHaveCount(0);
        await page.getByRole('button', { name: /Guardar|Save/ }).first().click();
        await expect(notice).toBeVisible({ timeout: 15000 });
    });

    test('the watcher recognises a rejection on its own, whatever the caller does', async ({ page }) => {
        // Isolates the fetch wrapper (audit 2, F4): no catch block, no helper involved.
        await page.goto(`/adopter/${ID}`);
        await dismissCountryBanner(page);
        await expect(page.getByRole('heading', { name: NAME })).toBeVisible({ timeout: 30000 });
        const status = await page.evaluate(async () => (await fetch('/', { method: 'POST', headers: { 'x-deployment-id': 'stale-e2e-build', 'next-action': 'x' } })).status);
        expect(status).toBe(409);
        await expect(page.getByText(/Hay una versión nueva|A new version is available|Há uma versão nova/)).toBeVisible({ timeout: 15000 });
    });

    test('a search reloads onto the current build by itself', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        const statuses = await goStale(page);
        // A sentinel that only a real document reload clears — a successful search
        // also fires framenavigated (history.replaceState), so that proves nothing.
        await page.evaluate(() => { (window as unknown as { __skewSentinel?: boolean }).__skewSentinel = true; });
        await page.fill('input#search', 'SkewFixture');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();
        await expect.poll(() => statuses.includes(409), { timeout: 30000 }).toBe(true);
        await expect.poll(
            () => page.evaluate(() => (window as unknown as { __skewSentinel?: boolean }).__skewSentinel === true).catch(() => false),
            { timeout: 45000 },
        ).toBe(false);
        await expect(page.getByText(/Búsqueda fallida|Search failed/)).toHaveCount(0);
    });
});
