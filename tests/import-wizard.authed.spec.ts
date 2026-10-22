import { test, expect } from '@playwright/test';

test.setTimeout(90000);

// Dead ends in the post-import wizard (audit 2026-10-21, A1/A3/A4). The fetch
// and AI routes are stubbed: what is under test is where the rescuer lands when
// they fail, not Facebook or Gemini.

const POST = 'https://www.facebook.com/groups/1/posts/2/';

test.describe('Import wizard', () => {
    test('a shared post that cannot be read returns to step 1 with the link kept', async ({ page }) => {
        await page.route('**/api/facebook/fetch-post', route =>
            route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'upstream down' }) }));

        await page.goto(`/import?shared=true&shared_url=${encodeURIComponent(POST)}&shared_text=${encodeURIComponent('Ojo con este')}`);

        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        // The field renders before the share logic runs; give start-up + the stubbed fetch time.
        await expect(field).toHaveValue(new RegExp(POST.replace(/[.?/]/g, '\\$&')), { timeout: 30000 });
        await expect(field).toHaveValue(/Ojo con este/);
        await expect(page.getByText(/Error ID:/)).toBeVisible();
        await expect(page.getByRole('button', { name: /Reintentar|Retry/i })).toBeVisible();
        // The caption and link are not left in the address, where analytics would record them.
        expect(new URL(page.url()).search).toBe('');
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
        // Pasted text goes straight to the AI read (no echo step since design change 12).
        await page.getByRole('button', { name: /Continue|Continuar/i }).click();

        const retry = page.getByRole('button', { name: /Reintentar|Retry/i });
        await expect(retry).toBeVisible({ timeout: 30000 });
        expect(calls).toBe(1);
        await retry.click();
        await expect.poll(() => calls, { timeout: 30000 }).toBe(2);
    });

    test('the record type shows even when the AI saw no adoption, and can be changed', async ({ page }) => {
        await stubAi(page, { name: 'Persona Prueba', phones: ['1100000000'], adoptionDetected: false, recordType: undefined });
        await pasteAndContinue(page, 'Persona Prueba consulta por un gato');

        const observation = page.getByRole('radio', { name: /Note|Nota|Observa/i });
        await expect(observation).toHaveAttribute('aria-checked', 'true');
        // Picking a type that involves an animal opens its fields.
        await page.getByRole('radio', { name: /Request|Solicitud|Pedido/i }).click();
        await expect(page.locator('#import-animal-name')).toBeVisible();
    });

    test('a profile with no name can be saved when it has a phone', async ({ page }) => {
        await stubAi(page, { name: '', phones: ['1100000000'] });
        await pasteAndContinue(page, 'sin nombre, tel 11 0000 0000');

        await expect(page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i })).toBeEnabled();
        await expect(page.locator('#import-save-hint')).toHaveCount(0);
    });

    test('a profile with no name and no identifier says why it cannot be saved', async ({ page }) => {
        await stubAi(page, { name: '', phones: [] });
        await pasteAndContinue(page, 'sin nombre');

        await expect(page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i })).toBeDisabled();
        await expect(page.locator('#import-save-hint')).toBeVisible();
    });

    test('no duplicates: saves straight away and lands on the new profile', async ({ page }) => {
        const unique = `Fixture Sinduplicado ${Date.now()}`;
        await stubAi(page, { name: unique, phones: [] });
        // The create is stubbed so the shared e2e database is not written to.
        await page.route('**/api/adopters', route => route.request().method() === 'POST'
            ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-import-fixture-1' }) })
            : route.continue());
        await pasteAndContinue(page, `${unique} quiere adoptar`);

        await page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i }).click();
        await page.waitForURL(/\/adopter\/test-import-fixture-1/, { timeout: 30000 });
    });
});

test.describe('Import wizard — duplicates', () => {
    test('an already-imported post leads with "Ver perfil" and offers adding a relative', async ({ page }) => {
        await page.route('**/api/facebook/fetch-post', route => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ success: true, data: { text: 'Cuidado con Juan y Ana', images: [] } }),
        }));
        await stubAi(page, { name: 'Ana Prueba', phones: [] });
        let lookedUp = '';
        await page.route('**/api/adopters?sourceUrl=*', route => {
            lookedUp = new URL(route.request().url()).searchParams.get('sourceUrl') ?? '';
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ matchType: 'url', matches: [{ id: 'test-import-fixture-juan', name: 'Juan Prueba', canEdit: true }] }) });
        });

        await page.goto('/import');
        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        await field.fill(POST);
        await page.getByRole('button', { name: /Continue|Continuar/i }).click();
        await page.getByRole('button', { name: /Extract with AI|Extraer con IA/i }).click();
        await page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i }).click();

        await expect(page.getByRole('heading', { name: /already imported|Ya importaste/i })).toBeVisible({ timeout: 30000 });
        expect(lookedUp).toBe(POST);
        const actions = page.getByTestId('import-actions');
        // "Ver perfil" first (decision B9), then add-interaction, then add-as-relative (B6).
        await expect(actions.locator('a, button').first()).toHaveAttribute('href', '/adopter/test-import-fixture-juan');
        await expect(actions.getByRole('button', { name: /relative|familiar/i })).toBeVisible();
    });

    test('when the same-post check fails, it says so instead of saving as new', async ({ page }) => {
        // It used to answer "no matches" on error, and a re-paste became a duplicate
        // profile with no warning (review of 2.56.213, item 1).
        await page.route('**/api/facebook/fetch-post', route => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ success: true, data: { text: 'Post', images: [] } }),
        }));
        await stubAi(page, { name: `Fixture Sincheck ${Date.now()}`, phones: [] });
        let created = false;
        await page.route('**/api/adopters**', route => {
            const req = route.request();
            if (req.method() === 'POST') { created = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'x' }) }); }
            if (req.url().includes('sourceUrl=')) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Duplicate check failed', errorId: 'abcd1234' }) });
            return route.continue();
        });

        await page.goto('/import');
        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        await field.fill(POST);
        await page.getByRole('button', { name: /Continue|Continuar/i }).click();
        await page.getByRole('button', { name: /Extract with AI|Extraer con IA/i }).click();
        await page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i }).click();

        await expect(page.getByText(/Could not verify|No se pudo verificar/i)).toBeVisible({ timeout: 30000 });
        expect(created).toBe(false);
    });

    test('a failed same-post check is shown on the match screen too', async ({ page }) => {
        // Re-review of 2.56.214, D: with any person match, the warning used to vanish.
        await page.route('**/api/facebook/fetch-post', route => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ success: true, data: { text: 'Post', images: [] } }),
        }));
        await stubAi(page, { name: 'María García López', phones: [] });
        await page.route('**/api/adopters?sourceUrl=*', route => route.fulfill({
            status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Duplicate check failed', errorId: 'abcd1234' }),
        }));

        await page.goto('/import');
        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        await field.fill(POST);
        await page.getByRole('button', { name: /Continue|Continuar/i }).click();
        await page.getByRole('button', { name: /Extract with AI|Extraer con IA/i }).click();
        await page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i }).click();

        await expect(page.getByRole('heading', { name: /may already exist|ya exista/i })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(/Could not verify|No se pudo verificar/i)).toBeVisible();
    });

    test('a name-only match is not pre-selected, and "create new" leads', async ({ page }) => {
        // Seeded profile; the AI returns the same name and no contact.
        await stubAi(page, { name: 'María García López', phones: [] });
        await pasteAndContinue(page, 'María García López quiere adoptar');

        // The review screen names the match and offers to add to it (decision B7).
        const hint = page.getByTestId('import-match-hint');
        await expect(hint).toContainText('María García López', { timeout: 30000 });

        await page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i }).click();
        await expect(page.getByRole('heading', { name: /may already exist|ya exista/i })).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole('radio').first()).toBeVisible();
        // A name with no contact is never a strong match, so nothing is selected
        // and "create" is the main action (audit D5, decision B5).
        await expect(page.locator('[role="radio"][aria-checked="true"]')).toHaveCount(0);
        await expect(page.getByTestId('import-actions').getByRole('button').first()).toHaveText(/Create a new profile|Crear un perfil nuevo/i);
        await expect(page.getByRole('button', { name: /Add to the selected|Agregar al perfil elegido/i })).toBeDisabled();
    });

    test('"Agregar a este perfil" on the review screen opens the match, selected', async ({ page }) => {
        await stubAi(page, { name: 'María García López', phones: [] });
        await pasteAndContinue(page, 'María García López quiere adoptar');
        const hint = page.getByTestId('import-match-hint');
        await expect(hint).toBeVisible({ timeout: 30000 });
        await hint.getByRole('button', { name: /Add to this profile|Agregar a este perfil/i }).click();

        await expect(page.getByRole('heading', { name: /may already exist|ya exista/i })).toBeVisible({ timeout: 30000 });
        await expect(page.locator('[role="radio"][aria-checked="true"]')).toHaveCount(1);
        await expect(page.getByRole('button', { name: /Add to the selected|Agregar al perfil elegido/i })).toBeEnabled();
    });
});

test.describe('Import wizard on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('no sideways scroll, and the step buttons stay pinned to the bottom', async ({ page }) => {
        // Step 2's bare file input poked 16px past the card at 390px (audit A5);
        // the buttons scrolled away under long content (Jon, 2026-10-21).
        await page.route('**/api/facebook/fetch-post', route => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ success: true, data: { text: 'Texto del post\n'.repeat(40), images: [] } }),
        }));
        await page.goto('/import');
        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        await field.fill(POST);
        await page.getByRole('button', { name: /Continue|Continuar/i }).click();
        await expect(page.getByRole('heading', { name: /Review Content|Revisar Contenido/i })).toBeVisible({ timeout: 30000 });

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        const actions = page.getByTestId('import-actions');
        await expect(actions).toHaveCSS('position', 'sticky');
        const box = await actions.boundingBox();
        expect(box).not.toBeNull();
        // Pinned: its bottom edge sits at the viewport's bottom while the card runs on below.
        expect(Math.abs((box!.y + box!.height) - 844)).toBeLessThanOrEqual(2);
    });
});

async function stubAi(page: import('@playwright/test').Page, data: Record<string, unknown>) {
    await page.route('**/api/ai/extract-from-post', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { emails: [], addresses: [], socialProfiles: [], notes: '', confidence: 'high', adoptionDetected: false, ...data } }),
    }));
}

async function pasteAndContinue(page: import('@playwright/test').Page, text: string) {
    await page.goto('/import');
    const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
    await expect(field).toBeVisible({ timeout: 30000 });
    await field.fill(text);
    await page.getByRole('button', { name: /Continue|Continuar/i }).click();
    await expect(page.getByRole('heading', { name: /Review Extracted Data|Revisar Datos Extraídos/i })).toBeVisible({ timeout: 30000 });
}
