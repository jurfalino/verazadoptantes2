import { test, expect, type APIRequestContext } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1, rows as dbRows } from './db';

/**
 * /my-adopters "Por formulario": the place to see everyone who filled the
 * adoption form, newest first, with what they applied for. A form that looks
 * like an existing profile is an ordinary possible duplicate (spec 2026-11-05):
 * the row carries «Posible duplicado», not a «Por revisar» of its own.
 *
 * Runs under `authed` (the admin owns forms sent to ADMIN_USER_ID). Own rows
 * only — unique email/phone per run.
 */

const ADMIN_USER_ID = 'test-admin-id';

async function submitForm(request: APIRequestContext, data: { name: string; email: string; phone: string }): Promise<string> {
    const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, { data: { ...data, address: '1 E2E List St', intent: 'self' } });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).submissionId as string;
}

/** The chip's count badge, e.g. "Via form 7" → 7. */
async function chipCount(page: import('@playwright/test').Page, name: RegExp): Promise<number> {
    const text = await page.getByRole('button', { name }).innerText();
    return Number(text.match(/(\d+)\s*$/)?.[1] ?? NaN);
}

test.describe('/my-adopters — people who filled a form', () => {
    test('"Por formulario" lists them newest first, says what they applied for, and marks the undecided as a possible duplicate', async ({ page, request }) => {
        test.setTimeout(120_000);
        const stamp = Date.now();
        const email = `e2e-list-${stamp}@example.com`;
        const phone = `16${String(stamp).slice(-8)}`;
        const name = `E2E Lista ${stamp}`;
        // Same person twice: the second form's new profile has a look-alike → «Posible duplicado».
        await submitForm(request, { name, email, phone });
        const secondId = await submitForm(request, { name, email, phone });

        await page.goto(`/my-adopters?filtro=formularios`);
        await dismissCountryBanner(page);

        const formsChip = page.getByRole('button', { name: /Via form|Por formulario|Por formulário/ });
        await expect(formsChip).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });

        // Each row is a container whose one link is the name (no link inside a link — fix round 2, item 19).
        const rows = page.locator('[data-testid="my-adopters-row"]:visible');
        const all = await chipCount(page, /^(All|Todos)/);
        const withForms = await chipCount(page, /Via form|Por formulario|Por formulário/);
        expect(withForms).toBeLessThan(all); // seed people without forms are filtered out
        await expect(rows).toHaveCount(withForms);

        // Newest form first: one of this run's two people is the top row.
        await expect(rows.first()).toContainText(name);
        // No «Por revisar» anywhere: no chip in the filters, no pill on rows.
        await expect(page.getByRole('button', { name: /^(To review|Por revisar|Para revisar)/ })).toHaveCount(0);
        await expect(page.getByTestId('row-needs-review')).toHaveCount(0);
        const reviewRow = rows.filter({ has: page.getByTestId('row-pending-dup') }).filter({ hasText: name });
        // Both applications are the same person, so both rows say so.
        await expect(reviewRow).toHaveCount(2);

        // The seeded admin's T&C modal can open after load and cover the list.
        await dismissCountryBanner(page);
        // The form line opens that form, not the profile behind the row.
        const secondRow = rows.filter({ has: page.locator(`a[href*="/form-results/${secondId}"]`) });
        await secondRow.getByRole('link', { name: /General form|Formulario general|Formulário geral/ }).click();
        await expect(page).toHaveURL(new RegExp(`/form-results/${secondId}`), { timeout: 30_000 });
        await expect(page.getByTestId('form-status-banner')).toHaveAttribute('data-state', 'review_matches');

        // Back keeps the filter (it lives in the URL), and "Todos" shows everyone again.
        await page.goBack();
        await expect(formsChip).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: /^(All|Todos)/ }).click();
        await expect(page).toHaveURL(/\/my-adopters$/);
        await expect(rows).toHaveCount(all);
    });

    test('on a phone, the card shows the profile\'s own bar with a 44px «Revisar»', async ({ browser, request }) => {
        test.setTimeout(120_000);
        const stamp = Date.now();
        const name = `E2E Barra ${stamp}`;
        const email = `e2e-bar-${stamp}@example.com`;
        const phone = `17${String(stamp).slice(-8)}`;
        await submitForm(request, { name, email, phone });
        await submitForm(request, { name, email, phone });
        const ctx = await browser.newContext({ storageState: '.auth/admin.json', viewport: { width: 390, height: 844 } });
        try {
            const page = await ctx.newPage();
            await page.goto('/my-adopters');
            await dismissCountryBanner(page);
            const bar = page.locator('[data-testid="row-pending-dup-bar"]:visible').filter({ hasText: name }).first();
            await expect(bar).toBeVisible({ timeout: 30_000 });
            const review = bar.getByRole('link', { name: /Review|Revisar/ });
            expect((await review.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await expect(review).toHaveAttribute('href', /\/my-adopters\?pair=.+#pendientes/);
        } finally {
            await ctx.close();
        }
    });

    test('two open questions: the bar says «y 1 más» and «Revisar» opens the newest', async ({ browser, request }) => {
        test.setTimeout(150_000);
        const stamp = Date.now();
        const name = `E2E Dos ${stamp}`;
        const email = `e2e-two-${stamp}@example.com`;
        const phone = `18${String(stamp).slice(-8)}`;
        const a = await submitForm(request, { name, email, phone });
        const b = await submitForm(request, { name, email, phone });
        const c = await submitForm(request, { name, email, phone });
        const id = (sub: string) => String(dbRows(`SELECT auto_adopter_id AS id FROM form_submissions WHERE id = '${sub}'`)[0].id);
        const [A, B, C] = [id(a), id(b), id(c)];
        // C pairs with A and with B; make C–B the newest, C–A older.
        const pairWhere = (x: string, y: string) => `(adopter1_id = '${x}' AND adopter2_id = '${y}') OR (adopter1_id = '${y}' AND adopter2_id = '${x}')`;
        execD1(`UPDATE duplicate_candidates SET detected_at = strftime('%s','now','-2 days') WHERE ${pairWhere(C, A)}`);
        execD1(`UPDATE duplicate_candidates SET detected_at = strftime('%s','now') WHERE ${pairWhere(C, B)}`);
        const ctx = await browser.newContext({ storageState: '.auth/admin.json', viewport: { width: 390, height: 844 } });
        try {
            const page = await ctx.newPage();
            await page.goto('/my-adopters');
            await dismissCountryBanner(page);
            const card = page.locator('[data-testid="my-adopters-row"]:visible').filter({ has: page.locator(`a[href="/adopter/${C}?ref=my-adopters"]`) });
            const bar = card.getByTestId('row-pending-dup-bar');
            await expect(bar).toContainText(/1 more|1 más|1 mais/, { timeout: 30_000 });
            const href = await bar.getByRole('link', { name: /Review|Revisar/ }).getAttribute('href');
            expect(decodeURIComponent(href ?? '')).toContain(B);
        } finally {
            await ctx.close();
        }
    });
});
