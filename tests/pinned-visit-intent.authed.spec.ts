import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * ENABLE_PINNED_VISIT_INTENT pins the "¿Qué pasó con X?" card to the bottom of
 * the screen, so recording what happened is one tap from anywhere on the
 * profile instead of sitting below the whole adopter card.
 *
 * Flag is off in the seed; this spec turns it on for itself and back off after.
 * Phone-sized viewport, because that is where the placement matters.
 */

const PROFILE = '/adopter/test-adopter-1';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
}

async function cardBox(page: Page) {
    const card = page.locator('.visit-intent-card');
    await expect(card).toBeVisible({ timeout: 30000 });
    return card.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, position: getComputedStyle(el).position, vh: window.innerHeight };
    });
}

test.describe('pinned visit-intent card', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test.beforeAll(() => {
        execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PINNED_VISIT_INTENT', 'true', strftime('%s','now'), 'e2e')`);
    });

    test.afterAll(() => {
        execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PINNED_VISIT_INTENT'`);
    });

    test('sits at the bottom of the screen on first view, without scrolling', async ({ page }) => {
        await page.goto(PROFILE);
        await dismissCountryBanner(page);
        const box = await cardBox(page);
        expect(box.position).toBe('fixed');
        expect(Math.abs(box.bottom - box.vh)).toBeLessThanOrEqual(2);
    });

    test('choosing an option opens the wizard in view', async ({ page }) => {
        await page.goto(PROFILE);
        await dismissCountryBanner(page);
        await cardBox(page);
        await page.getByTestId('visit-intent-adoption_request').click();
        // The card gives way to the wizard, which scrolls itself into view.
        await expect(page.getByTestId('wizard-close')).toBeInViewport({ timeout: 30000 });
    });

    test('gets out of the way while a field is being edited', async ({ page }) => {
        await page.goto(PROFILE);
        await dismissCountryBanner(page);
        // Precondition: on screen before editing — otherwise "moved away" proves nothing.
        const before = await cardBox(page);
        expect(before.top).toBeLessThan(before.vh - 50);
        await page.locator('main button[aria-label="Editar"], main button[aria-label="Edit"]').first().click();
        await expect(page.locator('main input:focus, main textarea:focus')).toHaveCount(1);
        // Slid below the fold, so a phone keyboard never lands on top of it.
        await expect.poll(async () => (await cardBox(page)).top, { timeout: 5000 })
            .toBeGreaterThanOrEqual(844 - 1);
    });
});
