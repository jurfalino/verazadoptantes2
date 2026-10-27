import { test, expect } from '@playwright/test';
import { cleanupProfiles, createProfileViaApi, housemates, rows } from './householdFixtures';

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

    test('no activity type to pick; the AI rating is pre-filled and can be changed', async ({ page }) => {
        await stubAi(page, { name: 'Persona Prueba', phones: ['1100000000'], adoptionRating: 1 });
        await pasteAndContinue(page, 'Persona Prueba abandonó a su perro en la ruta');

        await expect(page.getByRole('radio', { name: /Adoption|Adopción|Request|Solicitud/i })).toHaveCount(0);
        const rating = page.getByTestId('import-rating');
        await expect(rating).toContainText(/Dangerous|Peligroso/);
        // Terse (Jon, 2026-10-22): no «Quitar», no confidence pill.
        await expect(rating.getByRole('button', { name: /Clear|Quitar/i })).toHaveCount(0);
        await expect(page.getByText(/High confidence|Alta confianza/i)).toHaveCount(0);
        await rating.getByRole('button').nth(1).click();
        await expect(rating).toContainText(/Risky|Riesgoso|Arriscado/);
    });

    test('with no grounds the AI suggests nothing and the stars start empty', async ({ page }) => {
        await stubAi(page, { name: 'Persona Prueba', phones: ['1100000000'], adoptionRating: 2.5 });
        await pasteAndContinue(page, 'Persona Prueba');
        await expect(page.getByTestId('import-rating')).toContainText(/Not rated|Sin calificar/i);
    });

    test('other people the post names are listed and saved as relatives', async ({ page }) => {
        await stubAi(page, {
            name: `Fixture Titular ${Date.now()}`, phones: [],
            otherPeople: [
                { name: 'Ana Pareja', relationship: 'partner', phones: ['11 3333 4444'] },
                { name: 'Leo Error', relationship: 'unknown' },
            ],
        });
        let sent: { householdMembers?: string } = {};
        await page.route('**/api/adopters', route => {
            if (route.request().method() !== 'POST') return route.continue();
            sent = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-import-fixture-2' }) });
        });
        await pasteAndContinue(page, 'Cuidado con este y su pareja Ana');

        const list = page.getByTestId('import-relatives');
        await expect(list).toContainText('Ana Pareja');
        // The rescuer drops the one the AI got wrong.
        await list.getByRole('button', { name: /Leo Error/ }).click();
        await expect(list).not.toContainText('Leo Error');

        await page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i }).click();
        await page.waitForURL(/\/adopter\/test-import-fixture-2/, { timeout: 30000 });
        const members = JSON.parse(sent.householdMembers ?? '[]') as Array<{ name: string; relationship: string }>;
        expect(members.map(m => [m.name, m.relationship])).toEqual([['Ana Pareja', 'partner']]);
    });

    test('«¿Es este perfil?» per relative: «Sí» links the existing profile, «No, es otra persona» makes a new one (Task 8)', async ({ page }) => {
        test.setTimeout(180_000);
        const stamp = Date.now();
        const phone = `11 7${String(stamp).slice(-3)}-${String(stamp).slice(-7, -3)}`;
        const ANA = await createProfileViaApi(page.request, { name: `Ana Existe ${stamp}`, phone });
        const LEO = await createProfileViaApi(page.request, { name: `Leo Duplicado ${stamp}`, email: `leo-${stamp}@example.com` });
        let created = '';
        try {
            await stubAi(page, {
                name: `Fixture Titular Rel ${stamp}`, phones: [],
                otherPeople: [
                    { name: `Ana Pareja ${stamp}`, relationship: 'partner', phones: [phone] },
                    { name: `Leo Duplicado ${stamp}`, relationship: 'sibling' },
                ],
            });
            await pasteAndContinue(page, 'Cuidado con este, su pareja Ana y su hermano Leo');
            const list = page.getByTestId('import-relatives');
            const ana = list.locator('li').filter({ hasText: `Ana Pareja ${stamp}` });
            const anaAsk = ana.getByTestId('import-relative-candidate').filter({ hasText: `Ana Existe ${stamp}` });
            await expect(anaAsk).toBeVisible({ timeout: 60_000 });
            await anaAsk.getByTestId('import-relative-candidate-yes').click();
            await expect(ana.getByTestId('import-relative-linked')).toBeVisible();
            const leo = list.locator('li').filter({ hasText: `Leo Duplicado ${stamp}` });
            const leoAsk = leo.getByTestId('import-relative-candidate');
            await expect(leoAsk).toBeVisible({ timeout: 60_000 });
            for (let i = 0; i < 3 && await leoAsk.isVisible(); i++) await leoAsk.getByTestId('import-relative-candidate-no').click();
            await expect(leoAsk).toHaveCount(0);

            await page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i }).click();
            await page.waitForURL(/\/adopter\/(?!create)[^/?]+/, { timeout: 60_000 });
            created = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);
            await expect.poll(() => housemates(created).map(h => h.profileId).sort().join(','), { timeout: 30_000 }).toContain(ANA);
            const mates = housemates(created).map(h => String(h.profileId));
            expect(mates).toContain(ANA); // «Sí»: the existing profile, linked
            expect(mates).not.toContain(LEO); // «No»: someone else …
            const leos = rows(`SELECT id FROM adopters WHERE name = 'Leo Duplicado ${stamp}' AND deleted_at IS NULL`).map(r => String(r.id));
            expect(leos.filter(id => id !== LEO).some(id => mates.includes(id))).toBe(true); // … made as a new profile
            expect(rows(`SELECT id FROM adopters WHERE name = 'Ana Pareja ${stamp}'`)).toHaveLength(0);
        } finally {
            cleanupProfiles([created, ANA, LEO].filter(Boolean));
        }
    });

    test('extraction hints: only real problems, each with its fix', async ({ page }) => {
        // Everything read: no hint box at all (no generic banner, no confidence pill).
        await stubAi(page, { name: 'Persona Prueba', phones: ['1100000000'], confidence: 'high', extractionIssues: [] });
        await pasteAndContinue(page, 'Persona Prueba, tel 11 0000 0000');
        await expect(page.getByTestId('import-quality')).toHaveCount(0);
    });

    test('the AI says what it could not read, and a name with no contact is flagged', async ({ page }) => {
        // Every problem shown is also logged (Jon, 2026-10-22): capture the report.
        const reports: Array<{ message: string; level?: string; extra?: { issues?: string[] } }> = [];
        await page.route('**/api/log-client-error', async route => {
            reports.push(route.request().postDataJSON());
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"errorId":null}' });
        });
        await stubAi(page, { name: 'Persona Prueba', phones: [], confidence: 'medium', extractionIssues: ['image_unreadable', 'not_a_code'] });
        await pasteAndContinue(page, 'Persona Prueba');
        const hints = page.getByTestId('import-quality');
        await expect(hints.locator('[data-issue]')).toHaveCount(2);
        await expect(hints.locator('[data-issue="image_unreadable"]').getByRole('button')).toBeVisible();
        await expect(hints.locator('[data-issue="no_contact_found"]')).toBeVisible();
        await expect.poll(() => reports.find(r => r.message === 'import: extraction problems shown')?.extra?.issues).toEqual(['image_unreadable', 'no_contact_found']);
        expect(reports.find(r => r.message === 'import: extraction problems shown')?.level).toBe('warn');
    });

    test('a post whose text Facebook hid is flagged, with a way back to add it', async ({ page }) => {
        await page.route('**/api/facebook/fetch-post', route => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ success: true, missingPostText: true, data: { text: '', images: ['https://example.com/a.jpg'] } }),
        }));
        await stubAi(page, { name: 'Persona Prueba', phones: ['1100000000'], confidence: 'high' });
        await page.goto('/import');
        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        await field.fill(POST);
        await page.getByRole('button', { name: /Continue|Continuar/i }).click();
        await page.getByRole('button', { name: /Extract with AI|Extraer con IA/i }).click();

        const hint = page.getByTestId('import-quality').locator('[data-issue="post_text_unavailable"]');
        await expect(hint).toBeVisible({ timeout: 30000 });
        await hint.getByRole('button', { name: /Add|Agregar/i }).click();
        await expect(page.getByRole('heading', { name: /Review Content|Revisar Contenido/i })).toBeVisible();
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
        // The AI read a date: the shared DatePicker opens on month and year.
        await stubAi(page, { name: unique, phones: [], adoptionDate: '2026-03-10' });
        // The create is stubbed so the shared e2e database is not written to.
        let sent: { adoption?: Record<string, unknown> } = {};
        await page.route('**/api/adopters', route => {
            if (route.request().method() !== 'POST') return route.continue();
            sent = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-import-fixture-1' }) });
        });
        await pasteAndContinue(page, `${unique} quiere adoptar`);

        await page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i }).click();
        await page.waitForURL(/\/adopter\/test-import-fixture-1/, { timeout: 30000 });
        // A report: no activity type chosen, no animal, month kept as the 1st.
        expect(sent.adoption?.recordType).toBe('observation');
        expect(sent.adoption?.date).toBe('2026-03-01');
        expect(sent.adoption?.species).toBeUndefined();
    });
});

test.describe('Import wizard — duplicates', () => {
    test('an already-imported post leads with "Ver perfil"', async ({ page }) => {
        await page.route('**/api/facebook/fetch-post', route => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ success: true, data: { text: 'Cuidado con Juan y Ana', images: [] } }),
        }));
        // Unique name: the "no es el mismo post" step must not find a name match in the seed.
        await stubAi(page, { name: `Fixture Otrapersona ${Date.now()}`, phones: [] });
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
        // "Ver perfil" first (decision B9). No "otra persona del post" option any more:
        // people a post names are saved as relatives on the first import (Jon, 2026-10-22).
        await expect(actions.locator('a, button').first()).toHaveAttribute('href', '/adopter/test-import-fixture-juan');
        await expect(page.getByRole('button', { name: /relative|familiar/i })).toHaveCount(0);

        // "No es el mismo post" leaves the screen and saves as new when nothing else matches.
        let created = false;
        await page.route('**/api/adopters', route => {
            if (route.request().method() !== 'POST') return route.continue();
            created = true;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-import-fixture-ana' }) });
        });
        await page.getByRole('button', { name: /Not the same post|No es el mismo post/i }).click();
        await page.waitForURL(/\/adopter\/test-import-fixture-ana/, { timeout: 30000 });
        expect(created).toBe(true);
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

    test('a match on the phone but not the name asks: same person or a relative?', async ({ page }) => {
        // Seeded María has phone 555-1234; the post names someone else with that phone.
        await stubAi(page, { name: 'Pedro Prueba', phones: ['555-1234'] });
        await pasteAndContinue(page, 'Pedro Prueba, tel 555-1234');
        await page.getByRole('button', { name: /Save Adopter|Guardar Adoptante/i }).click();
        await expect(page.getByRole('heading', { name: /may already exist|ya exista/i })).toBeVisible({ timeout: 30000 });

        const card = page.locator('[role="radio"]').filter({ hasText: /María/ }).first();
        if ((await card.getAttribute('aria-checked')) !== 'true') await card.click();
        const choice = page.getByTestId('import-identity-choice');
        await expect(choice).toBeVisible();
        const merge = page.getByRole('button', { name: /Add to the selected|Agregar al perfil elegido/i });
        await expect(merge).toBeDisabled();
        await choice.getByRole('radio', { name: /relative|familiar/i }).check();
        await expect(merge).toBeEnabled();
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

    test('after a reload with a saved draft, «Continuar» works', async ({ page }) => {
        // The tab reloaded on Jon's phone (2026-10-22): the field showed the link
        // but the button kept the server's `disabled` and never recovered.
        await page.goto('/import');
        const field = page.getByPlaceholder(/paste|pegá|URL|text/i);
        await expect(field).toBeVisible({ timeout: 30000 });
        await field.fill(POST);
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('import_wizard_state') ?? '')).toContain('posts/2');
        await page.reload();
        await expect(field).toHaveValue(POST, { timeout: 30000 });
        const btn = page.getByRole('button', { name: /Continue|Continuar/i });
        await expect(btn).toBeEnabled();
        await field.fill(POST + '?x=1');
        await expect(btn).toBeEnabled();
    });

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
