import { test, expect, type APIRequestContext } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * /my-adopters "Con formulario": the place to see everyone who filled the
 * adoption form, newest first, with what they applied for and whether a form
 * still waits for "¿es la misma persona?" ("Por revisar").
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

/** The chip's count badge, e.g. "With a form 7" → 7. */
async function chipCount(page: import('@playwright/test').Page, name: RegExp): Promise<number> {
    const text = await page.getByRole('button', { name }).innerText();
    return Number(text.match(/(\d+)\s*$/)?.[1] ?? NaN);
}

test.describe('/my-adopters — people who filled a form', () => {
    test('"Con formulario" lists them newest first, says what they applied for, and flags the undecided', async ({ page, request }) => {
        test.setTimeout(120_000);
        const stamp = Date.now();
        const email = `e2e-list-${stamp}@example.com`;
        const phone = `16${String(stamp).slice(-8)}`;
        const name = `E2E Lista ${stamp}`;
        // Same person twice: the second form's new profile has a look-alike → "Por revisar".
        await submitForm(request, { name, email, phone });
        const secondId = await submitForm(request, { name, email, phone });

        await page.goto(`/my-adopters?filtro=formularios`);
        await dismissCountryBanner(page);

        const formsChip = page.getByRole('button', { name: /With a form|Con formulario|Com formulário/ });
        await expect(formsChip).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });

        const rows = page.locator('a[href*="?ref=my-adopters"]:visible');
        const all = await chipCount(page, /^(All|Todos)/);
        const withForms = await chipCount(page, /With a form|Con formulario|Com formulário/);
        expect(withForms).toBeLessThan(all); // seed people without forms are filtered out
        await expect(rows).toHaveCount(withForms);

        // Newest form first: one of this run's two people is the top row.
        await expect(rows.first()).toContainText(name);
        const reviewRow = rows.filter({ hasText: /To review|Por revisar|Para revisar/ }).filter({ hasText: name });
        await expect(reviewRow).toHaveCount(1);
        await expect(reviewRow).toContainText(/General form|Formulario general|Formulário geral/);

        // The seeded admin's T&C modal can open after load and cover the list.
        await dismissCountryBanner(page);
        // The form line opens that form, not the profile behind the row.
        await reviewRow.getByRole('link', { name: /General form|Formulario general|Formulário geral/ }).click();
        await expect(page).toHaveURL(new RegExp(`/form-results/${secondId}`), { timeout: 30_000 });
        await expect(page.getByTestId('form-status-banner')).toHaveAttribute('data-state', 'review_matches');

        // Back keeps the filter (it lives in the URL), and "Todos" shows everyone again.
        await page.goBack();
        await expect(formsChip).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: /^(All|Todos)/ }).click();
        await expect(page).toHaveURL(/\/my-adopters$/);
        await expect(rows).toHaveCount(all);
    });
});
