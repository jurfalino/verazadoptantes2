import { test, expect, type Locator } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1Batch } from './db';

/**
 * Mobile viewport tests — runs on iPhone 14 (390×844).
 * Verifies responsive layouts don't break at mobile widths.
 */

test.setTimeout(60000);

test.describe('Mobile Responsive', () => {

    test('Homepage search is usable at mobile width', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);

        // Search input should be visible and full-width
        const searchInput = page.locator('input#search');
        await expect(searchInput).toBeVisible({ timeout: 30000 });

        // Search button should be visible — use form submit button
        const searchBtn = page.locator('button[type="submit"]');
        await expect(searchBtn).toBeVisible({ timeout: 30000 });

        // Type and search
        await searchInput.fill('María');
        await searchBtn.click();

        // Results should appear — look for adopter links
        await expect(page.locator('[data-walkthrough="results"] a[href*="/adopter/"]').first()).toBeVisible({ timeout: 30000 });

        // Result cards should not overflow the viewport
        const firstCard = page.locator('[data-walkthrough="results"] a[href*="/adopter/"]').first();
        const cardBox = await firstCard.boundingBox();
        const viewportSize = page.viewportSize();
        if (cardBox && viewportSize) {
            expect(cardBox.width).toBeLessThanOrEqual(viewportSize.width);
        }
    });

    test('Footer is visible at mobile width', async ({ page }) => {
        await page.goto('/');
        await dismissCountryBanner(page);
        await expect(page.locator('input#search')).toBeVisible({ timeout: 30000 });

        // Scroll to bottom
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

        // Footer should be present — look for the copyright text
        await expect(page.getByText(/© 2026/)).toBeVisible({ timeout: 30000 });
    });

    // The applicant panel (spec 2026-11-10): its footer and the «No avanzar» dialog at 390px. Fixtures
    // are owned by the `mobile` project's user (testuser@example.com) and removed after.
    test.describe('applicant panel at 390px', () => {
        const USER = 'testuser@example.com';
        const stamp = Date.now();
        const F = (k: string) => `test-ev-fixture-${k}-${stamp}`;
        const [animal, adopter, form, app] = [F('mn'), F('ma'), F('mf'), F('mp')];
        const name = `Solicitante Movil ${stamp}`;

        test.beforeAll(() => {
            execD1Batch([
                `INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('${animal}', 'Movil ${stamp}', 'cat', 'hembra', '${USER}', strftime('%s','now','-3 days'), strftime('%s','now','-3 days'))`,
                `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${adopter}', '${name}', '', '5', '${USER}', 'form', strftime('%s','now','-1 days'), strftime('%s','now','-1 days'))`,
                `INSERT INTO form_submissions (id, user_id, name, email, status, selected_animal_id, linked_adopter_id, created_at) VALUES ('${form}', '${USER}', '${name}', 'ev-movil-${stamp}@example.com', 'linked', '${animal}', '${adopter}', strftime('%s','now','-1 days'))`,
                `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${app}', '${form}', '${animal}', 'form', 'open', strftime('%s','now','-1 days'))`,
            ]);
        });
        test.afterAll(() => {
            execD1Batch([
                `DELETE FROM applications WHERE id = '${app}'`,
                `DELETE FROM form_submissions WHERE id = '${form}'`,
                `DELETE FROM adopter_history WHERE adopter_id = '${adopter}'`,
                `DELETE FROM adopters WHERE id = '${adopter}'`,
                `DELETE FROM animals WHERE id = '${animal}'`,
            ]);
        });

        /** The element's own overflow and every button in it. */
        const measure = (root: Locator) => root.evaluate((el) => ({
            scrollW: el.scrollWidth, clientW: el.clientWidth,
            buttons: Array.from(el.querySelectorAll('button')).map(b => ({
                label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30),
                h: Math.round(b.getBoundingClientRect().height), scrollW: b.scrollWidth, clientW: b.clientWidth,
            })),
        }));

        test('the panel footer and the «No avanzar» dialog fit 390px; every button (the stars too) is ≥44px tall', async ({ page }) => {
            test.setTimeout(180_000);
            await page.goto(`/my-animals?view=solicitudes&animal=${animal}&solicitud=${app}`);
            await dismissCountryBanner(page);
            const panel = page.getByTestId('my-animals-applicants-panel');
            await expect(panel.locator('#applicant-panel-title')).toContainText(name, { timeout: 60_000 });
            expect(page.viewportSize()?.width).toBe(390);
            // The sticky footer: «No avanzar» + «Enviar contrato».
            const footer = panel.getByTestId('applicant-panel-footer');
            await expect(footer.getByTestId('evaluate-send-contract')).toBeVisible();
            const footerBox = await measure(footer);
            await panel.getByTestId('evaluate-decline').click();
            const dialog = page.getByTestId('decline-dialog');
            await expect(dialog).toBeVisible();
            const dialogBox = await measure(dialog);
            const rect = await dialog.boundingBox();

            for (const [what, m] of [['panel footer', footerBox], ['decline dialog', dialogBox]] as const) {
                expect(m.scrollW, `${what} overflows`).toBeLessThanOrEqual(m.clientW);
                expect(m.buttons.length, `${what} has buttons`).toBeGreaterThan(0);
                for (const b of m.buttons) {
                    expect(b.scrollW, `${what} «${b.label}» overflows`).toBeLessThanOrEqual(b.clientW);
                    expect(b.h, `${what} «${b.label}» height`).toBeGreaterThanOrEqual(44);
                }
            }
            expect(footerBox.buttons).toHaveLength(2);
            // The five rating stars are among the dialog's buttons.
            expect(dialogBox.buttons.filter(b => /^\d stars?$/.test(b.label))).toHaveLength(5);
            expect(rect && rect.x >= 0 && rect.x + rect.width <= 390, 'dialog inside the viewport').toBe(true);
            // Nothing saved: cancel.
            await dialog.locator('[data-modal-cancel]').click();
            await expect(dialog).toHaveCount(0);
        });
    });

    // Many general forms (Jon 2026-11-13: they are people in «Mis adoptantes», listed — never paged — and each opens
    // alone): at 390px every row and the request's «← Volver» stay on screen, and an old «Sin animal elegido» link still lands.
    test.describe('25 general forms at 390px', () => {
        const USER = 'testuser@example.com';
        const stamp = Date.now();
        const N = 25;
        const people = Array.from({ length: N }, (_, i) => ({
            adopter: `test-ev-fixture-ga${i}-${stamp}`, form: `test-ev-fixture-gf${i}-${stamp}`, app: `test-ev-fixture-gp${i}-${stamp}`, name: `Muchos ${i} ${stamp}`,
        }));

        test.beforeAll(() => {
            execD1Batch(people.flatMap((p, i) => [
                `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${p.adopter}', '${p.name}', '', '5', '${USER}', 'form', strftime('%s','now','-${i + 1} hours'), strftime('%s','now','-${i + 1} hours'))`,
                `INSERT INTO form_submissions (id, user_id, name, email, status, linked_adopter_id, created_at) VALUES ('${p.form}', '${USER}', '${p.name}', 'ev-muchos${i}-${stamp}@example.com', 'linked', '${p.adopter}', strftime('%s','now','-${i + 1} hours'))`,
                `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${p.app}', '${p.form}', NULL, 'form', 'open', strftime('%s','now','-${i + 1} hours'))`,
            ]));
        });
        test.afterAll(() => {
            execD1Batch(people.flatMap(p => [
                `DELETE FROM applications WHERE id = '${p.app}'`,
                `DELETE FROM form_submissions WHERE id = '${p.form}'`,
                `DELETE FROM adopter_history WHERE adopter_id = '${p.adopter}'`,
                `DELETE FROM adopters WHERE id = '${p.adopter}'`,
            ]));
        });

        test('an old «Sin animal elegido» link opens the request alone; «← Volver» and all 25 rows stay within 390px', async ({ page }) => {
            test.setTimeout(180_000);
            const first = people[N - 1];
            await page.goto(`/my-animals?view=solicitudes&animal=general&solicitud=${first.app}`);
            await dismissCountryBanner(page);
            await expect(page).toHaveURL(new RegExp(`/my-adopters\\?solicitud=${first.app}`), { timeout: 60_000 });
            const panel = page.getByTestId('request-panel');
            await expect(panel).toContainText(first.name, { timeout: 60_000 });
            await expect(panel.getByRole('button', { name: /Siguiente|Next|Próximo/ })).toHaveCount(0);
            const back = panel.getByTestId('applicant-panel-back').first();
            const box = await back.boundingBox();
            expect(box && box.x >= 0 && box.x + box.width <= 390, `«← Volver» inside 390px: ${JSON.stringify(box)}`).toBe(true);

            await back.click();
            const rows = page.getByTestId('general-request-row').filter({ hasText: String(stamp) });
            await expect(rows).toHaveCount(N, { timeout: 30_000 });
            const outside = await rows.evaluateAll(els => els
                .map(e => { const r = e.getBoundingClientRect(); return { r, sw: e.scrollWidth, cw: e.clientWidth }; })
                .filter(({ r, sw, cw }) => r.x < 0 || r.right > 390 || sw > cw).length);
            expect(outside, 'rows overflowing 390px').toBe(0);
        });
    });
});
