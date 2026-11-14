import { test, expect, type Page } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * The home «Instalá la app» card (option C, Jon 2026-11-12). Desktop Chromium
 * never offers an install on the test server, so the Android case hands the
 * page a synthetic `beforeinstallprompt` — re-sent until the card appears,
 * because the listener only exists once the home has hydrated. Selectors are
 * test ids only: the copy is translated. The 30-day rule itself is unit-tested
 * in src/domain/installCard.test.ts.
 */

const DISMISSED_KEY = 'install-card-dismissed-at';

/** Fire a fake install prompt whose dialog answers `outcome`. */
async function offerInstall(page: Page, outcome: 'accepted' | 'dismissed' = 'dismissed') {
    await page.evaluate((o) => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        Object.assign(e, { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: o }) });
        window.dispatchEvent(e);
    }, outcome);
}

async function cardOffered(page: Page, outcome: 'accepted' | 'dismissed' = 'dismissed') {
    const card = page.getByTestId('install-card');
    await expect.poll(async () => {
        await offerInstall(page, outcome);
        return card.count();
    }, { timeout: 30000 }).toBe(1);
    return card;
}

test.describe('home install card — a browser that offers an install', () => {
    test('no card on a desktop browser that offers nothing', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('input#search')).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('install-card')).toHaveCount(0);
    });

    test('«Not now» hides it and remembers it on this device', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        const card = await cardOffered(page);
        await expect(card.getByTestId('install-card-install')).toBeVisible();
        await card.getByTestId('install-card-not-now').click();
        await expect(card).toHaveCount(0);
        const stored = await page.evaluate((k) => window.localStorage.getItem(k), DISMISSED_KEY);
        expect(Number(stored)).toBeGreaterThan(0);

        // Offered again after a reload: still hidden.
        await page.reload();
        await expect(page.locator('input#search')).toBeVisible({ timeout: 30000 });
        for (let i = 0; i < 5; i++) {
            await offerInstall(page);
            await page.waitForTimeout(300);
        }
        await expect(page.getByTestId('install-card')).toHaveCount(0);
    });

    test('the ✕ hides it too', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        const card = await cardOffered(page);
        await card.getByTestId('install-card-close').click();
        await expect(card).toHaveCount(0);
        expect(await page.evaluate((k) => window.localStorage.getItem(k), DISMISSED_KEY)).not.toBeNull();
    });

    test('accepting the browser install removes the card', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        const card = await cardOffered(page, 'accepted');
        await card.getByTestId('install-card-install').click();
        await expect(card).toHaveCount(0);
        // Accepting is not a dismissal: nothing stored.
        expect(await page.evaluate((k) => window.localStorage.getItem(k), DISMISSED_KEY)).toBeNull();
    });
});

test.describe('home install card — iPhone', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });

    test('«Install» opens the home-screen steps; Escape closes them', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        const card = page.getByTestId('install-card');
        await expect(card).toBeVisible({ timeout: 30000 });
        await card.getByTestId('install-card-install').click();
        const steps = page.getByTestId('install-card-ios-steps');
        await expect(steps).toBeVisible();
        await expect(steps.locator('li')).toHaveCount(2);
        await expect(steps.getByTestId('install-card-ios-ok')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(steps).toHaveCount(0);
        // Reading the steps is not a dismissal: the card stays.
        await expect(card).toBeVisible();
    });

    test('at phone width: nothing overflows, the buttons share a row, ✕ is 44px, the steps sit on the bottom edge', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await dismissCountryBanner(page);
        const card = page.getByTestId('install-card');
        await expect(card).toBeVisible({ timeout: 30000 });
        const m = await card.evaluate((el) => {
            const box = (id: string) => el.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
            return {
                cardOverflow: el.scrollWidth - el.clientWidth,
                pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
                installTop: box('install-card-install').top,
                notNowTop: box('install-card-not-now').top,
                installHeight: box('install-card-install').height,
                close: { w: box('install-card-close').width, h: box('install-card-close').height },
            };
        });
        expect(m.cardOverflow).toBeLessThanOrEqual(0);
        expect(m.pageOverflow).toBeLessThanOrEqual(0);
        expect(m.installTop).toBe(m.notNowTop);
        expect(m.installHeight).toBeGreaterThanOrEqual(44);
        expect(m.close).toEqual({ w: 44, h: 44 });

        await card.getByTestId('install-card-install').click();
        const steps = page.getByTestId('install-card-ios-steps');
        await expect(steps).toBeVisible();
        const sheet = await steps.boundingBox();
        expect(Math.round(sheet!.y + sheet!.height)).toBe(844);
        expect(Math.round(sheet!.width)).toBe(390);
    });
});
