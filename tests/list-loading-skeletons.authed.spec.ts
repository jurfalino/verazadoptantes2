/**
 * /my-adopters and /my-animals load in ONE shape: the list area shows its skeleton
 * under the real header (never a full-page «Cargando…»), and nothing moves when the
 * data lands — at desktop and phone widths, and on a /my-animals tab switch.
 * The list request is held open so the loading state can be measured.
 */
import { test, expect, type Page } from '@playwright/test';

const top = (page: Page, sel: string) =>
    page.locator(sel).first().evaluate(el => Math.round(el.getBoundingClientRect().top + window.scrollY));

for (const vp of [{ w: 1280, h: 900 }, { w: 390, h: 844 }]) {
    test(`my-adopters @${vp.w}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        await page.route('**/api/my-adopters', async route => { await gate; await route.continue(); });
        await page.goto('/my-adopters');
        await expect(page.getByTestId('adopter-list-skeleton')).toBeVisible();
        await expect(page.getByText(/^(Cargando|Loading|Carregando)…?\.{0,3}$/)).toHaveCount(0);
        // The duplicates section loads alongside the list now; let it settle before measuring.
        await expect(page.getByTestId('pending-dedup-loading')).toHaveCount(0, { timeout: 15000 });
        const loading = { h1: await top(page, 'h1'), list: await top(page, '[data-testid="adopter-list-skeleton"]') };
        release();
        await expect(page.getByTestId('adopter-list-toolbar')).toBeVisible();
        const done = { h1: await top(page, 'h1'), list: await top(page, '[data-testid="adopter-list-toolbar"]') };
                expect(done.h1).toBe(loading.h1);
        expect(done.list).toBe(loading.list);
    });

    test(`my-animals @${vp.w}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        let release!: () => void;
        let gate = new Promise<void>(r => { release = r; });
        await page.route('**/api/my-animals?view=*', async route => { await gate; await route.continue(); });
        await page.goto('/my-animals');
        await expect(page.getByTestId('animal-grid-skeleton')).toBeVisible();
        await expect(page.getByText(/^(Cargando|Loading|Carregando)…?\.{0,3}$/)).toHaveCount(0);
        const loading = { h1: await top(page, 'h1'), grid: await top(page, '[data-testid="animal-grid-skeleton"]') };
        release();
        await expect(page.getByTestId('animal-grid-skeleton')).toHaveCount(0, { timeout: 15000 });
        const firstCard = page.locator('[data-testid^="animal-card-"]');
        const hasCards = await firstCard.count() > 0;
        const done = { h1: await top(page, 'h1'), grid: hasCards ? await firstCard.first().evaluate(el => Math.round(el.closest('.grid')!.getBoundingClientRect().top + window.scrollY)) : null };
        expect(done.h1).toBe(loading.h1);
        if (hasCards) expect(done.grid).toBe(loading.grid);

        // Tab switch: header and tabs stay, cards become skeletons (no "Cargando" page).
        gate = new Promise<void>(r => { release = r; });
        const tabsTop = await top(page, 'a[href="/my-animals?view=adopted"]');
        await page.locator('a[href="/my-animals?view=adopted"]').click();
        await expect(page.getByTestId('animal-grid-skeleton')).toBeVisible();
        const during = { h1: await top(page, 'h1'), tabs: await top(page, 'a[href="/my-animals?view=adopted"]') };
        expect(during.h1).toBe(done.h1);
        expect(during.tabs).toBe(tabsTop);
        release();
        await expect(page.getByTestId('animal-grid-skeleton')).toHaveCount(0);
    });
}
