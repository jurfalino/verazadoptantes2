import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * The duplicate Scan survives a dropped connection (2.56.159).
 *
 * Production 2026-10-11: the browser's connection dropped after 800 of 1,253
 * profiles (Cloudflare status `clientDisconnected`) and the page stopped with
 * "Scan failed". It now waits and carries on. Here the first two batch
 * requests are cut off and the third gets a busy lock, then the real scan runs.
 */
test('Scan carries on after dropped connections and a busy lock', async ({ page }) => {
    test.setTimeout(240_000);
    let intercepted = 0;
    await page.route('**/api/admin/duplicates', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        intercepted++;
        if (intercepted <= 2) return route.abort('connectionreset');
        if (intercepted === 3) {
            return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Scan already in progress', retryInMs: 500 }) });
        }
        return route.continue();
    });

    await page.goto('/admin/data-quality');
    await dismissCountryBanner(page);
    await page.getByRole('button', { name: /^Duplicados$|^Duplicates$/ }).click();
    await page.getByRole('button', { name: /Scan Now/ }).click();

    // It says it is retrying instead of stopping…
    await expect(page.getByText(/Connection dropped — retrying/)).toBeVisible({ timeout: 30_000 });
    // …and finishes.
    await expect(page.getByText(/Scan complete/)).toBeVisible({ timeout: 200_000 });
    expect(intercepted).toBeGreaterThan(3);
    await expect(page.getByText(/Scan failed|gave up/)).toHaveCount(0);
});
