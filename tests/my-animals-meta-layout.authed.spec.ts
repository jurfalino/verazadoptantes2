import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * The «Actualizado por <Nombre> · hace 20 días» line on a Mis Animales card
 * was cut to «Caro Méndez · …» (Reel 06 re-recording): it was `truncate` in a
 * ~207px column. It now wraps, and the v2.56.134 footer (controls drop to their
 * own line before the meta column gets narrower than 9rem) still holds.
 *
 * Measured at 390 and 1280, in Spanish. Own animal + own user row per run
 * (the admin owns the animal; a named teammate last touched it 20 days ago),
 * removed at the end.
 */

const ADMIN_EMAIL = 'gatitosolivos@gmail.com';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}

for (const width of [390, 1280]) {
    test(`card meta line at ${width}px is never cut`, async ({ page }) => {
        test.setTimeout(120_000);
        const stamp = Date.now();
        const animalId = `test-animal-meta-${stamp}`;
        const email = `meta-layout-${stamp}@example.com`;
        execD1(`INSERT INTO user (id, name, email) VALUES ('test-meta-user-${stamp}', 'Carolina Méndez Etchegaray', '${email}')`);
        execD1(`INSERT INTO animals (id, name, species, added_by, updated_by, created_at, updated_at) VALUES ('${animalId}', 'Meta${stamp}', 'cat', '${ADMIN_EMAIL}', '${email}', strftime('%s','now','-40 days'), strftime('%s','now','-20 days'))`);
        try {
            await page.addInitScript(() => { try { localStorage.setItem('app-locale', 'es'); } catch { /* private mode */ } });
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/my-animals?view=available');
            await dismissCountryBanner(page);
            const meta = page.getByTestId(`last-update-${animalId}`);
            await expect(meta).toContainText('Carolina Méndez Etchegaray', { timeout: 30_000 });
            await expect(meta).toContainText(/hace/);

            const m = await meta.evaluate(el => {
                const col = el.parentElement!;
                return {
                    scrollW: el.scrollWidth, clientW: el.clientWidth, height: Math.round(el.getBoundingClientRect().height),
                    lineH: Math.round(parseFloat(getComputedStyle(el).lineHeight) || 16),
                    colW: Math.round(col.getBoundingClientRect().width),
                    pageScrollW: document.documentElement.scrollWidth, pageClientW: document.documentElement.clientWidth,
                    text: el.textContent,
                };
            });
            console.log(`META ${width}`, JSON.stringify(m));
            // A crop of the card's footer for the record (test-results/ is not tracked).
            const footer = meta.locator('xpath=ancestor::div[contains(@class,"border-t")][1]');
            await footer.scrollIntoViewIfNeeded();
            await page.evaluate(() => window.scrollBy(0, 160));
            const box = await footer.boundingBox();
            if (box) await page.screenshot({ path: `test-results/card-meta-${width}.png`, clip: box });

            // Nothing cut: the whole line is laid out (no ellipsis overflow).
            expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
            // The v2.56.134 floor still holds: the meta column is never squeezed below 9rem.
            expect(m.colW).toBeGreaterThanOrEqual(144);
            // No horizontal page scroll.
            expect(m.pageScrollW).toBeLessThanOrEqual(m.pageClientW);
        } finally {
            execD1(`DELETE FROM animals WHERE id = '${animalId}'`);
            execD1(`DELETE FROM user WHERE email = '${email}'`);
        }
    });
}
