import { test, expect } from '@playwright/test';

test.setTimeout(90000);

// Dead ends in the post-import wizard (audit 2026-10-21, A1/A3/A4). The fetch
// and AI routes are stubbed: what is under test is where the rescuer lands when
// they fail, not Facebook or Gemini.

const POST = 'https://www.facebook.com/groups/1/posts/2/';

test.describe('Import wizard — failures do not strand the rescuer', () => {
    test('a shared post that cannot be read returns to step 1 with the link kept', async ({ page }) => {
        await page.route('**/api/facebook/fetch-post', route =>
            route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'upstream down' }) }));

        await page.goto(`/import?shared=true&shared_url=${encodeURIComponent(POST)}&shared_text=${encodeURIComponent('Ojo con este')}`);

        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        await expect(field).toHaveValue(new RegExp(POST.replace(/[.?/]/g, '\\$&')));
        await expect(field).toHaveValue(/Ojo con este/);
        await expect(page.getByText(/Error ID:/)).toBeVisible();
        await expect(page.getByRole('button', { name: /Reintentar|Retry/i })).toBeVisible();
    });

    test('a link inside a caption is fetched, and the caption is kept', async ({ page }) => {
        let fetched = '';
        await page.route('**/api/facebook/fetch-post', async route => {
            fetched = (route.request().postDataJSON() as { url: string }).url;
            await route.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ success: true, data: { text: 'Texto del post', images: [] } }),
            });
        });

        await page.goto('/import');
        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        await field.fill(`Mirá este post ${POST} quiere adoptar`);
        await page.getByRole('button', { name: /Continue|Continuar/i }).click();

        await expect(page.getByRole('heading', { name: /Review Content|Revisar Contenido/i })).toBeVisible({ timeout: 30000 });
        expect(fetched).toBe(POST);
        const text = page.locator('textarea').first();
        await expect(text).toHaveValue(/Texto del post/);
        await expect(text).toHaveValue(/Mirá este post quiere adoptar/);
    });

    test('"Reintentar" after a failed AI read runs the AI read again', async ({ page }) => {
        let calls = 0;
        await page.route('**/api/ai/extract-from-post', route => {
            calls++;
            return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'model busy' }) });
        });

        await page.goto('/import');
        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        await field.fill('Persona Prueba quiere adoptar un gato. Tel 11 0000 0000');
        await page.getByRole('button', { name: /Continue|Continuar/i }).click();
        await page.getByRole('button', { name: /Extract with AI|Extraer con IA/i }).click();

        const retry = page.getByRole('button', { name: /Reintentar|Retry/i });
        await expect(retry).toBeVisible({ timeout: 30000 });
        expect(calls).toBe(1);
        await retry.click();
        await expect.poll(() => calls, { timeout: 30000 }).toBe(2);
    });
});
