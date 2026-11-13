import { test, expect, type Page } from '@playwright/test';
import { execD1, rows, isDbNull } from './db';
import { dismissCountryBanner } from './helpers';

/**
 * «Personalizar» on a group card (/organizations). ENABLE_GROUP_BRANDING is ON in the seed.
 * AUTHED (admin) — the admin owns test-org-fixture-1 («Refugio E2E», slug refugio-e2e).
 * Selectors are locale-agnostic (testids / values): Chromium may render English.
 *
 * group-branding.unauthed.spec.ts asserts refugio-e2e has NO branding, so the fixture's
 * branding columns are reset before (an aborted earlier run) and after this file.
 */
const ORG_ID = 'test-org-fixture-1';
const RESET = `UPDATE organizations SET logo_url = NULL, banner_url = NULL, brand_theme = NULL, brand_accent = NULL,
    instagram_url = NULL, facebook_url = NULL, website_url = NULL, branding_updated_at = NULL, branding_updated_by = NULL
    WHERE id = '${ORG_ID}'`;

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => { execD1(RESET); });
test.afterAll(() => { execD1(RESET); });

const section = (page: Page) => page.locator(`[data-testid="group-branding"][data-org-id="${ORG_ID}"]`);

async function openSection(page: Page) {
    await page.goto('/organizations');
    await dismissCountryBanner(page);
    const s = section(page);
    const toggle = s.getByTestId('group-branding-toggle');
    await expect(toggle).toBeVisible({ timeout: 30000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Loaded = the form is there (the theme radios render only once getGroupBranding answered).
    await expect(s.locator('input[name^="group-theme-"][value="dark"]')).toBeVisible({ timeout: 30000 });
    return s;
}

function storedBranding() {
    return rows(`SELECT brand_theme, brand_accent, instagram_url, website_url, branding_updated_at FROM organizations WHERE id = '${ORG_ID}'`)[0];
}

test.describe('Personalizar on a group card', () => {
    test('a javascript: website is refused on that field and nothing is saved', async ({ page }) => {
        const s = await openSection(page);
        await s.getByTestId('group-branding-website').fill('javascript:x');
        await s.locator('input[name^="group-theme-"][value="light"]').check();
        await s.getByTestId('group-branding-save').click();

        await expect(s.getByTestId('group-branding-website-error')).toBeVisible({ timeout: 30000 });
        await expect(s.getByTestId('group-branding-website')).toHaveAttribute('aria-invalid', 'true');
        await expect(s.getByTestId('group-branding-instagram-error')).toHaveCount(0);

        const row = storedBranding();
        expect(isDbNull(row.brand_theme)).toBe(true);
        expect(isDbNull(row.website_url)).toBe(true);
        expect(isDbNull(row.branding_updated_at)).toBe(true);
    });

    test('a non-image logo is refused in the browser, with nothing stored', async ({ page }) => {
        const s = await openSection(page);
        const input = s.getByTestId('group-branding-logo-input');
        // An HTML file renamed .png: the type says image, the browser cannot decode it.
        await input.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('<html><body>not an image</body></html>') });
        await expect(s.getByTestId('group-branding-logo-error')).toBeVisible({ timeout: 30000 });
        // An SVG: refused by type before any decoding.
        await input.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
        await expect(s.getByTestId('group-branding-logo-error')).toBeVisible();
        expect(isDbNull(rows(`SELECT logo_url FROM organizations WHERE id = '${ORG_ID}'`)[0].logo_url)).toBe(true);
    });

    test('Claro + Turquesa + Instagram are saved, shown back normalised, and public', async ({ page, request }) => {
        const s = await openSection(page);
        await s.locator('input[name^="group-theme-"][value="light"]').check();
        await s.locator('[data-testid="group-branding-swatch"][data-accent="turquesa"]').click();
        await expect(s.locator('input[data-accent="turquesa"]')).toBeChecked();
        await s.getByTestId('group-branding-instagram').fill('@refugioe2e');
        await s.getByTestId('group-branding-save').click();

        await expect(page.getByRole('alert').filter({ hasText: /Guardamos|saved|Salvamos/i })).toBeVisible({ timeout: 30000 });
        // The stored (normalised) link is shown back, and who changed it last.
        await expect(s.getByTestId('group-branding-instagram')).toHaveValue('https://instagram.com/refugioe2e', { timeout: 30000 });
        await expect(s.getByTestId('group-branding-last-edited')).toBeVisible();

        const again = await openSection(page);
        await expect(again.locator('input[name^="group-theme-"][value="light"]')).toBeChecked();
        await expect(again.locator('input[data-accent="turquesa"]')).toBeChecked();
        await expect(again.getByTestId('group-branding-instagram')).toHaveValue('https://instagram.com/refugioe2e');

        const res = await request.get('/api/showcase/org/refugio-e2e');
        expect(res.status()).toBe(200);
        expect((await res.json()).branding).toMatchObject({
            accentId: 'turquesa', theme: 'light', instagramUrl: 'https://instagram.com/refugioe2e', websiteUrl: null,
        });
    });

    test('the open section fits the screen at 390 and 1280', async ({ page }) => {
        for (const width of [390, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            const s = await openSection(page);
            await s.scrollIntoViewIfNeeded();
            const m = await page.evaluate((orgId) => {
                const el = document.querySelector(`[data-testid="group-branding"][data-org-id="${orgId}"]`) as HTMLElement;
                const de = document.documentElement;
                return { docScroll: de.scrollWidth, docClient: de.clientWidth, secScroll: el.scrollWidth, secClient: el.clientWidth };
            }, ORG_ID);
            test.info().annotations.push({ type: `overflow@${width}`, description: JSON.stringify(m) });
            console.log(`group-branding overflow @${width}: ${JSON.stringify(m)}`);
            expect(m.docScroll).toBe(m.docClient);
            expect(m.secScroll).toBe(m.secClient);
        }
    });
});

test.describe('Settings: «Al compartir, usar:» also decides the look', () => {
    // The earlier tests in this file save branding on the group; this one needs it unbranded.
    test.beforeAll(() => { execD1(RESET); });
    test('shows the hint, a look sub-line per row and the groups link; «Los míos» persists as self', async ({ page }) => {
        await page.goto('/settings#adoption-docs');
        const card = page.getByTestId('adoption-docs-settings');
        await expect(card).toBeVisible({ timeout: 30000 });
        await expect(card.getByTestId('adoption-docs-hint')).toHaveText(/logo, colores y redes|logo, colors and (social|networks)/i);

        await expect(card.getByTestId('adoption-docs-look-self')).toHaveText(/estándar de BuenAdoptante|standard BuenAdoptante/i);
        // «Refugio E2E» has no branding (RESET) → the "not yet" line.
        await expect(card.getByTestId(`adoption-docs-look-org:${ORG_ID}`)).toHaveText(/todavía no cargó|hasn.t (added|uploaded)/i);
        await expect(card.getByTestId(`adoption-docs-thumb-org:${ORG_ID}`)).toBeVisible();
        await expect(card.getByTestId('adoption-docs-groups-link')).toHaveAttribute('href', '/organizations');

        // Pick the group, then «Los míos»: the explicit choice must survive a reload.
        await card.locator(`input[name="adoption-docs-source"][value="org:${ORG_ID}"]`).check();
        await expect(card.locator('input[name="adoption-docs-source"][value="self"]')).not.toBeChecked();
        await expect.poll(() => rows(`SELECT group_concat(p.adoption_docs_source) AS s FROM user_profiles p WHERE p.user_id IN (SELECT id FROM user WHERE lower(email) = 'gatitosolivos@gmail.com')`)[0]?.s, { timeout: 30000 }).toContain(`org:${ORG_ID}`);
        await card.locator('input[name="adoption-docs-source"][value="self"]').check();
        await expect.poll(() => rows(`SELECT group_concat(p.adoption_docs_source) AS s FROM user_profiles p WHERE p.user_id IN (SELECT id FROM user WHERE lower(email) = 'gatitosolivos@gmail.com')`)[0]?.s, { timeout: 30000 }).toMatch(/^self(,self)*$/);

        await page.reload();
        await expect(page.getByTestId('adoption-docs-settings').locator('input[name="adoption-docs-source"][value="self"]')).toBeChecked({ timeout: 30000 });
    });

    test('fits the screen at 390 and 1280', async ({ page }) => {
        for (const width of [390, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/settings#adoption-docs');
            const card = page.getByTestId('adoption-docs-settings');
            await expect(card.getByTestId('adoption-docs-groups-link')).toBeVisible({ timeout: 30000 });
            const m = await page.evaluate(() => {
                const el = document.querySelector('[data-testid="adoption-docs-settings"]') as HTMLElement;
                const de = document.documentElement;
                return { docScroll: de.scrollWidth, docClient: de.clientWidth, secScroll: el.scrollWidth, secClient: el.clientWidth };
            });
            console.log(`settings docs overflow @${width}: ${JSON.stringify(m)}`);
            expect(m.docScroll).toBe(m.docClient);
            expect(m.secScroll).toBe(m.secClient);
        }
    });
});
