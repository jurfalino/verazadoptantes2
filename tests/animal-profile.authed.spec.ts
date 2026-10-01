import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';

/**
 * v2.55.15 (animal-timeline PR2): the animal detail page.
 * Runs under the `authed` project (admin session = gatitosolivos@gmail.com,
 * the owner of the seeded fixture animal). Selectors are locale-agnostic
 * (data-testid / roles) — CI Chromium renders English.
 */

const ANIMAL_ID = 'test-animal-fixture-1';

test.describe('Animal detail page', () => {

    test('renders header, custody trail and care events', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);

        // Header: hero caption with the animal's name.
        await expect(page.getByTestId('animal-name')).toHaveText('Timon', { timeout: 30000 });

        // Status chip links to the active adopter.
        const chip = page.getByTestId('animal-status-chip');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveAttribute('href', '/adopter/test-adopter-fixture-tl1');

        // Timeline: origin (v2.55.18) + adoption start + ended foster (start+end)
        // + follow_up + vaccination = 6 items.
        const items = page.getByTestId('timeline-item');
        await expect(items).toHaveCount(6);

        // The follow-up's note and the care event's note are both on the page.
        await expect(page.getByText('Muy bien adaptado a la casa nueva')).toBeVisible();
        await expect(page.getByText('Quíntuple, primera dosis')).toBeVisible();

        // v2.55.18: attribution + origin — who added the animal (and the team),
        // and the registration date as the timeline's first event.
        await expect(page.getByTestId('animal-added-by')).toContainText('Test Admin');
        await expect(page.getByTestId('animal-added-by')).toContainText('Refugio E2E');
        await expect(page.getByText(/Rescued and registered|Rescatado y registrado/)).toBeVisible();
    });

    test('a teammate\'s animal is visible, attributed, and actionable (full parity)', async ({ page }) => {
        // test-animal-fixture-2 belongs to e2e-teammate@example.com — same org.
        await page.goto('/my-animals/test-animal-fixture-2');
        await expect(page.getByTestId('animal-name')).toHaveText('Nube', { timeout: 30000 });
        await expect(page.getByTestId('animal-added-by')).toContainText('Vero E2E');

        // Full parity: the admin records a care event on the teammate's animal.
        const before = await page.getByTestId('timeline-item').count();
        await page.getByTestId('add-animal-event').click();
        await page.getByTestId('animal-event-type').selectOption('vet_visit');
        await page.getByTestId('animal-event-details').fill(`E2E control veterinario ${Date.now()}`);
        await page.getByTestId('animal-event-save').click();
        await expect(page.getByTestId('timeline-item')).toHaveCount(before + 1, { timeout: 30000 });

        // And the teammate's card shows up in the admin's available list, attributed.
        await page.goto('/my-animals?view=available');
        await expect(page.getByTestId('animal-card-test-animal-fixture-2')).toBeVisible({ timeout: 30000 });
        // v2.56.16: the old "de Vero" owner marker is replaced by the
        // always-visible attribution line — and since THIS test just recorded a
        // vet visit on Vero's animal as the admin, the line must now name the
        // admin, not the owner. That is the whole point of «Actualizado por»,
        // and it proves the value is derived from the event just created.
        const attribution = page.getByTestId('last-update-test-animal-fixture-2');
        await expect(attribution).toContainText(/Updated by|Actualizado por/);
        await expect(attribution).toContainText('Test Admin');
    });

    test('records a care event through the modal', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });

        const before = await page.getByTestId('timeline-item').count();

        await page.getByTestId('add-animal-event').click();
        await page.getByTestId('animal-event-type').selectOption('deworming');
        await page.getByTestId('animal-event-details').fill(`E2E desparasitación ${Date.now()}`);
        await page.getByTestId('animal-event-save').click();

        // router.refresh() re-renders the server component with the new event.
        await expect(page.getByTestId('timeline-item')).toHaveCount(before + 1, { timeout: 30000 });
    });

    test('add-event modal: rating for follow-ups, no duplicated subtype list, photo input', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('add-animal-event').click();

        // Timon has an active adoption → the follow-up option leads the list and
        // is selected by default, and it carries a rating.
        const typeSelect = page.getByTestId('animal-event-type');
        await expect(typeSelect).toHaveValue('follow_up');
        // StarRating renders one button per star with a hardcoded English aria-label.
        await expect(page.getByRole('button', { name: /^[1-5] stars?$/ })).toHaveCount(5);

        // v2.56.9: the old second dropdown repeated vacunación/castración/veterinario.
        await expect(page.getByTestId('animal-event-subtype')).toHaveCount(0);
        // Photos can be attached.
        await expect(page.getByTestId('animal-event-photo')).toHaveCount(1);

        // Care events have no rating (animal_events has no such column).
        await typeSelect.selectOption('vaccination');
        await expect(page.getByRole('button', { name: /^[1-5] stars?$/ })).toHaveCount(0);
    });

    test('share sheet is intent-keyed and offers recording an adoption', async ({ page }) => {
        // v2.56.15: rows lead with the situation, and the funnel now ends with
        // "an adoption that already happened" — the only door on a list card.
        await page.goto('/my-animals/test-animal-fixture-2'); // available, not adopted
        await expect(page.getByTestId('animal-name')).toHaveText('Nube', { timeout: 30000 });

        await page.getByTestId('share-sheet-test-animal-fixture-2').click();
        await expect(page.getByText(/If you want to vet adopters|Si querés evaluar adoptantes/)).toBeVisible();
        await expect(page.getByTestId('share-record-adoption-test-animal-fixture-2')).toBeVisible();

        // On an already-adopted animal that row is gone — nothing to record.
        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });
        await page.getByTestId(`share-sheet-${ANIMAL_ID}`).click();
        await expect(page.getByTestId(`share-record-adoption-${ANIMAL_ID}`)).toHaveCount(0);
    });

    test('card meta says WHAT the date means and who last touched the animal', async ({ page }) => {
        await page.goto('/my-animals?view=adopted');
        const card = page.getByTestId(`animal-card-${ANIMAL_ID}`);
        await expect(card).toBeVisible({ timeout: 30000 });

        // v2.56.16: the bare 📅 meant three different things (the compat view's
        // date is COALESCE(placement.started_at, animal.created_at)). Timon is
        // adopted, so his date is the adoption's.
        await expect(page.getByTestId(`card-date-${ANIMAL_ID}`)).toContainText(/Adopted on|Adoptado el/);

        // Attribution is always visible — «Actualizado por» when someone has
        // touched it since, «Agregado por» when nobody has.
        const meta = page.getByTestId(`last-update-${ANIMAL_ID}`);
        await expect(meta).toBeVisible();
        await expect(meta).toContainText(/Updated by|Actualizado por|Added by|Agregado por/);
    });

    test('adopted animals are grouped by the year they were adopted', async ({ page }) => {
        // v2.56.92: the adopted list is an archive that only grows; the year is
        // how a rescuer remembers them.
        await page.goto('/my-animals?view=adopted');
        await expect(page.getByTestId(`animal-card-${ANIMAL_ID}`)).toBeVisible({ timeout: 30000 });
        const year = String(new Date().getFullYear());
        const heading = page.getByRole('heading', { name: year, exact: true });
        await expect(heading).toBeVisible();
        // The card sits under its year, not in one flat grid.
        const section = page.locator('section').filter({ has: heading });
        await expect(section.getByTestId(`animal-card-${ANIMAL_ID}`)).toBeVisible();

        // Available animals stay one flat list — no year headings there.
        await page.goto('/my-animals?view=available');
        await expect(page.getByTestId('animal-card-test-animal-fixture-2')).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole('heading', { name: year, exact: true })).toHaveCount(0);
    });

    test('list card navigates to the detail page', async ({ page }) => {
        await page.goto('/my-animals?view=adopted');
        const card = page.getByTestId(`animal-card-${ANIMAL_ID}`);
        await expect(card).toBeVisible({ timeout: 30000 });
        await card.click();
        // Generous timeout: under fullyParallel this can be the FIRST request to
        // /my-animals/[id], and next dev compiles the route on demand while the
        // soft-navigation's RSC fetch waits (the 5s default expired mid-compile).
        await expect(page).toHaveURL(new RegExp(`/my-animals/${ANIMAL_ID}$`), { timeout: 45000 });
        await expect(page.getByTestId('animal-name')).toHaveText('Timon', { timeout: 30000 });
    });

    test('projected follow-ups render with the flag on', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });

        // Timon was adopted ~80 days ago with no birthdate (health omitted):
        // the 7d check-in is expired, the seeded follow-up satisfies the 30d one
        // via the date heuristic, and the 6-month check-in is scheduled.
        const section = page.getByTestId('projected-section');
        await expect(section).toBeVisible();
        await expect(section.getByText(/Six-month check-in|Control de los 6 meses/)).toBeVisible();
        // No due slot → no banner, no pending pill.
        await expect(page.getByTestId('due-banner')).not.toBeVisible();
        await expect(page.getByTestId('pending-pill')).not.toBeVisible();
        // The expired 7d reminder sits collapsed under the disclosure — which
        // v2.56.13 moved BELOW the «Hoy» divider (an expired reminder is past,
        // so it can't sit above the future), hence page- not section-scoped.
        const disclosure = page.getByRole('button', { name: /1 (expired reminder|recordatorio vencido)/ });
        await expect(disclosure).toBeVisible();
        // …and v2.56.10 lets it be logged late: the row carries its own CTA,
        // which passes the slot key so the matcher clears it whatever the date.
        await disclosure.click();
        await expect(page.getByTestId('register-missed-checkin_7d')).toBeVisible();
    });

    test('a scheduled follow-up explains when the reminder arrives', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });

        // v2.56.14: "Programado" on its own leaves the user guessing whether
        // anything will actually reach them. The 6-month check-in is upcoming.
        const body = page.getByTestId('explain-body-checkin_180d');
        await expect(body).toHaveCount(0);
        await page.getByTestId('explain-checkin_180d').click();
        await expect(body).toBeVisible();
        await expect(body).toContainText(/remind you on|Te avisamos el/);
        // Email is off by default → the section offers the settings deep link.
        await expect(body.getByRole('link')).toHaveAttribute('href', '/settings#followups');
    });

    test('photos: add, choose the main one, remove — staged until Guardar', async ({ page }) => {
        // v2.56.86: before this, an animal's photos could only be set at creation.
        // A 1x1 PNG is enough — data: image URLs are stored inline, no R2 needed.
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64',
        );
        const file = { name: 'p.png', mimeType: 'image/png', buffer: png };
        const editor = page.getByTestId('animal-photo-editor');

        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('profile-edit').click();
        await expect(editor).toBeVisible();
        const before = await editor.locator('img').count();

        // Cancelar must really cancel: nothing may reach the server.
        await page.getByTestId('animal-photo-input').setInputFiles(file);
        await expect(editor.locator('img')).toHaveCount(before + 1, { timeout: 15000 });
        await page.getByTestId('inline-edit-cancel').click();
        await expect(page.getByTestId('inline-edit-form')).not.toBeVisible();
        await page.getByTestId('profile-edit').click();
        await expect(editor.locator('img')).toHaveCount(before);

        // Add TWO, so "which one leads" is a real choice. Ids are read from the
        // DOM rather than picked by position: the surfaces disagree about which
        // photo comes first when none is primary, and a retry that left debris
        // on this shared fixture would silently target a seeded photo.
        const idsOf = async () => (await page.locator('[data-testid^="photo-main-"]').all())
            .reduce(async (acc, el) => [...(await acc), (await el.getAttribute('data-testid'))!.replace('photo-main-', '')], Promise.resolve([] as string[]));
        const idsBefore = await idsOf();
        await page.getByTestId('animal-photo-input').setInputFiles(file);
        await expect(editor.locator('img')).toHaveCount(before + 1);
        await page.getByTestId('animal-photo-input').setInputFiles(file);
        await expect(editor.locator('img')).toHaveCount(before + 2);
        await page.getByTestId('inline-edit-save').click();
        await expect(page.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30000 });

        // Both persisted. Take the ids THIS test created and make one main.
        await page.getByTestId('profile-edit').click();
        await expect(editor.locator('img')).toHaveCount(before + 2, { timeout: 30000 });
        const mine = (await idsOf()).filter(id => !idsBefore.includes(id));
        expect(mine).toHaveLength(2);
        // Whichever of the two is NOT already on top. Picking by position is
        // unsafe (uploaded_at has one-second resolution, so two uploads in one
        // save usually tie), and picking the one already first would satisfy
        // "is first" without is_primary doing any work at all.
        const firstNow = (await page.locator('[data-testid^="photo-main-"]').first()
            .getAttribute('data-testid'))!.replace('photo-main-', '');
        const chosen = mine.find(id => id !== firstNow)!;
        await page.getByTestId(`photo-main-${chosen}`).click();
        await page.getByTestId('inline-edit-save').click();
        await expect(page.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30000 });

        // The choice survived the round trip AND reordered the gallery: the
        // chosen photo is now FIRST, which is what is_primary ordering buys.
        await page.getByTestId('profile-edit').click();
        const firstMainBtn = page.locator('[data-testid^="photo-main-"]').first();
        await expect(firstMainBtn).toHaveAttribute('data-testid', `photo-main-${chosen}`, { timeout: 30000 });
        await expect(firstMainBtn).toHaveAttribute('aria-pressed', 'true');

        // Clean up exactly the two this test added — never by position.
        for (const id of mine) await page.getByTestId(`photo-remove-${id}`).click();
        await expect(editor.locator('img')).toHaveCount(before);
        await page.getByTestId('inline-edit-save').click();
        await expect(page.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30000 });
    });

    test('every added photo can be opened full size', async ({ page }) => {
        // v2.56.97: thumbnails were inert and anything past the third lived only
        // inside a «+N» count, so photos could be stored and never viewed.
        //
        // Counts are RELATIVE: this fixture is shared, and a sibling test that
        // fails mid-way leaves photos behind (CI saw 7 where a clean run has 0).
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        const file = { name: 'p.png', mimeType: 'image/png', buffer: png };
        const photoIds = async () => (await page.locator('[data-testid^="photo-main-"]').all())
            .reduce(async (acc, el) => [...(await acc), (await el.getAttribute('data-testid'))!.replace('photo-main-', '')], Promise.resolve([] as string[]));

        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('profile-edit').click();
        await expect(page.getByTestId('animal-photo-editor')).toBeVisible();
        const idsBefore = await photoIds();
        const editor = page.getByTestId('animal-photo-editor');
        const staged = editor.locator('img');
        const imgsBefore = await staged.count();

        // Wait for each thumbnail to appear before picking the next. Each pick
        // compresses on the main thread and disables Save while it runs, so
        // firing four in a row and clicking Save immediately raced on CI: the
        // click landed mid-compression and only some photos were staged.
        for (let i = 0; i < 4; i++) {
            await page.getByTestId('animal-photo-input').setInputFiles(file);
            await expect(staged).toHaveCount(imgsBefore + i + 1, { timeout: 20000 });
        }
        await expect(page.getByTestId('inline-edit-save')).toBeEnabled();
        await page.getByTestId('inline-edit-save').click();
        await expect(page.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30000 });
        const total = idsBefore.length + 4;

        // The 4th photo is reachable ONLY through «+N» — that was the bug.
        await expect(page.getByTestId('hero-thumb-more')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('hero-thumb-more').click();
        await expect(page.getByTestId('photo-counter')).toHaveText(`4 / ${total}`);

        // Step back through the gallery with the button, then the keyboard.
        await page.getByTestId('photo-prev').click();
        await expect(page.getByTestId('photo-counter')).toHaveText(`3 / ${total}`);
        await page.keyboard.press('ArrowLeft');
        await expect(page.getByTestId('photo-counter')).toHaveText(`2 / ${total}`);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('photo-counter')).toHaveCount(0);

        // The hero opens at the first photo.
        await page.getByTestId('hero-photo').click();
        await expect(page.getByTestId('photo-counter')).toHaveText(`1 / ${total}`);
        await page.keyboard.press('Escape');

        // Remove exactly the ids this test created — never by position.
        await page.getByTestId('profile-edit').click();
        await expect(editor).toBeVisible();
        const mine = (await photoIds()).filter(id => !idsBefore.includes(id));
        expect(mine).toHaveLength(4);
        for (const id of mine) await page.getByTestId(`photo-remove-${id}`).click();
        await page.getByTestId('inline-edit-save').click();
        await expect(page.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30000 });
    });

    test('registering a due check-in stays on the animal', async ({ page }) => {
        // v2.56.105: check-ins used to push to /adopter/<id>, throwing the rescuer
        // onto a different person's page mid-task. Uses its OWN fixture — an
        // adoption 35 days old with no follow-up, so the 30-day check-in is due.
        const DUE_ID = 'test-animal-fixture-due';
        await page.goto(`/my-animals/${DUE_ID}`);
        await expect(page.getByTestId('animal-name')).toHaveText('Pendiente', { timeout: 30000 });

        const due = page.getByTestId('due-slot-checkin_30d');
        await expect(due).toBeVisible({ timeout: 30000 });
        const before = await page.getByTestId('timeline-item').count();
        await due.getByRole('button', { name: /^(Registrar|Record|Register)$/ }).first().click();

        // It must NOT navigate away.
        await expect(page).toHaveURL(new RegExp(`/my-animals/${DUE_ID}`));
        await expect(page.getByTestId('animal-event-type')).toHaveValue('follow_up');
        // The rating is the reason the redirect existed; the modal carries it.
        await expect(page.getByRole('button', { name: /^[1-5] stars?$/ })).toHaveCount(5);

        await page.getByRole('button', { name: '4 stars' }).click();
        await page.getByTestId('animal-event-details').fill(`E2E control ${Date.now()}`);
        await page.getByTestId('animal-event-save').click();
        await expect(page.getByTestId('timeline-item')).toHaveCount(before + 1, { timeout: 30000 });
    });

    test('photos attached to a timeline event can be opened full size', async ({ page }) => {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        const file = { name: 'p.png', mimeType: 'image/png', buffer: png };
        const DUE_ID = 'test-animal-fixture-due';
        await page.goto(`/my-animals/${DUE_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });
        const before = await page.getByTestId('timeline-item').count();
    
        await page.getByTestId('add-animal-event').click();
        await page.getByTestId('animal-event-type').selectOption('vaccination');
        await page.getByTestId('animal-event-details').fill(`E2E foto evento ${Date.now()}`);
        const thumbs = page.locator('[role="dialog"] img');
        const n0 = await thumbs.count();
        for (let i = 0; i < 2; i++) {
            await page.getByTestId('animal-event-photo').setInputFiles(file);
            await expect(thumbs).toHaveCount(n0 + i + 1, { timeout: 20000 });
        }
        await page.getByTestId('animal-event-save').click();
        await expect(page.getByTestId('timeline-item')).toHaveCount(before + 1, { timeout: 30000 });
    
        // The event's thumbnails must be openable — this is what was inert.
        const firstThumb = page.locator('[data-testid^="event-photo-"][data-testid$="-0"]').first();
        await expect(firstThumb).toBeVisible({ timeout: 30000 });
        await firstThumb.click();
        await expect(page.getByTestId('event-photo-counter')).toHaveText('1 / 2');
        await page.getByTestId('event-photo-next').click();
        await expect(page.getByTestId('event-photo-counter')).toHaveText('2 / 2');
        await page.keyboard.press('ArrowLeft');
        await expect(page.getByTestId('event-photo-counter')).toHaveText('1 / 2');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('event-photo-counter')).toHaveCount(0);
        console.log('::OK:: event photos open, navigate, and close');
    });

    test('picker distinguishes my records, my team\'s, and everyone else\'s', async ({ page }) => {
        // One adopter per ownership class, all matching the same query.
        for (const f of ['local.db', '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/3e1a4f0276e8c62cda040b0ac336784f29a9472f81b9c52d99f1307686008885.sqlite']) {
            try {
                const db = new Database(f);
                const ins = db.prepare("INSERT OR REPLACE INTO adopters (id,name,contact_info,status,added_by,country,created_at,updated_at) VALUES (?,?,?,'5',?,'AR',strftime('%s','now'),strftime('%s','now'))");
                ins.run('zz-own-mine', 'Zulema Ownership', 'Tel: 555-1001', 'gatitosolivos@gmail.com');
                ins.run('zz-own-team', 'Zulema Teamwork', 'Tel: 555-1002', 'e2e-teammate@example.com');
                ins.run('zz-own-other', 'Zulema Stranger', 'Tel: 555-1003', 'someone-else@example.com');
                db.close();
            } catch { /* one of the two may be unreadable */ }
        }
    
        await page.goto('/my-animals/test-animal-fixture-2');
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('profile-record-adoption').click();
        await page.locator('input').last().fill('Zulema');
        await page.waitForTimeout(4000);
    
        const rows = await page.evaluate(() => [...document.querySelectorAll('div.divide-y > div')]
            .map(r => (r as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 60)));
        console.log('::ROWS:: ' + JSON.stringify(rows));
        const all = rows.join(' | ');
        expect(all).toMatch(/Zulema Ownership[^|]*(Tuyo|Yours)/);
        expect(all).toMatch(/Zulema Teamwork[^|]*(equipo|team)/i);
        expect(all).not.toMatch(/Zulema Stranger[^|]*(Tuyo|Yours|equipo|team)/i);
    
        // Created by this test, so removed by it — they are not in seed.sql and
        // must not drift into another spec's counts.
        for (const f of ['local.db', '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/3e1a4f0276e8c62cda040b0ac336784f29a9472f81b9c52d99f1307686008885.sqlite']) {
            try {
                const db = new Database(f);
                db.prepare("DELETE FROM adopters WHERE id LIKE 'zz-own-%'").run();
                db.close();
            } catch { /* ignore */ }
        }
    });

    const DBS = ['.wrangler/state/v3/d1/miniflare-D1DatabaseObject/3e1a4f0276e8c62cda040b0ac336784f29a9472f81b9c52d99f1307686008885.sqlite', 'local.db'];
    function q<T>(sql: string, ...args: unknown[]): T | undefined {
        for (const f of DBS) { try { const db = new Database(f); const r = db.prepare(sql).get(...args as never[]); db.close(); return r as T; } catch { /* next */ } }
        return undefined;
    }

    test('registering an adoption never leaves the animal, and custody really changes', async ({ page }) => {
        const ANIMAL = 'test-animal-fixture-2';   // available, owned by the teammate
        await page.goto(`/my-animals/${ANIMAL}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });
    
        await page.getByTestId('profile-record-adoption').click();
        await page.locator('input').last().fill('Fátima');
        await page.waitForTimeout(3500);
        await page.locator('div.divide-y > div button').first().click();
    
        // The whole point: still on the animal.
        await expect(page).toHaveURL(new RegExp(`/my-animals/${ANIMAL}`), { timeout: 15000 });
        const dlg = page.locator('[role="dialog"], .fixed.inset-0').last();
        await expect(dlg).toBeVisible({ timeout: 15000 });
        // The wizard mounts only once its inventory has loaded.
        await expect(dlg).toContainText(/What happened|Qué pasó/, { timeout: 20000 });
        // v2.56.110: the entry point already chose the record type and the
        // animal, so the form opens on Details — step 1 is marked done.
        await expect(dlg).toContainText(/✓\s*(What happened|Qué pasó)/, { timeout: 10000 });
        await expect(dlg).toContainText(/Rating|Calificaci/i);
        console.log('::OPENED:: ' + (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 120));
        console.log('::URL:: ' + page.url().replace(/^https?:\/\/[^/]+/, ''));
    
        // Step 1 → 2: is the ANIMAL carried through? If the prefill did not match
        // inventory the adoption saves with no animal — a silent, high-stakes loss.
        const next = dlg.getByRole('button', { name: /Continue|Continuar|Siguiente|Next/ }).first();
        if (await next.count()) { await next.click(); await page.waitForTimeout(1500); }
        console.log('::STEP2:: ' + (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 220));
    
        const before = q<{ n: number }>('SELECT COUNT(*) n FROM placements WHERE animal_id = ?', ANIMAL)?.n ?? -1;
    
        // step 2 → 3 → save
        for (let i = 0; i < 2; i++) {
            const b = dlg.getByRole('button', { name: /Next|Siguiente|Continuar|Continue/ }).first();
            if (await b.count()) { await b.click(); await page.waitForTimeout(1200); }
        }
        console.log('::STEP3:: ' + (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 160));
        const save = dlg.getByRole('button', { name: /Save|Guardar|Registrar|Finish|Finalizar/ }).first();
        await save.click();
        await page.waitForTimeout(4000);
    
        const after = q<{ n: number }>('SELECT COUNT(*) n FROM placements WHERE animal_id = ?', ANIMAL)?.n ?? -1;
        const row = q<{ adopter_id: string; record_type: string }>(
            'SELECT adopter_id, record_type FROM placements WHERE animal_id = ? ORDER BY rowid DESC LIMIT 1', ANIMAL);
        console.log(`::CUSTODY:: placements ${before} -> ${after}; newest ${JSON.stringify(row)}`);
        console.log('::URL-AFTER:: ' + page.url().replace(/^https?:\/\/[^/]+/, ''));
        expect(after).toBe(before + 1);
        expect(page.url()).toContain(`/my-animals/${ANIMAL}`);
        expect(page.url()).not.toContain('newAdoption');
    
        // Undo it: three sibling tests need this animal AVAILABLE.
        for (const f of DBS) {
            try { const db = new Database(f); db.prepare('DELETE FROM placements WHERE animal_id = ?').run(ANIMAL); db.close(); } catch { /* ignore */ }
        }
    });

    test('a devolución returns the animal to the available list', async ({ page }) => {
        const ANIMAL = 'test-animal-fixture-1';
        const before = q<{ rt: string; ad: string | null }>('SELECT record_type rt, adopter_id ad FROM adoptions WHERE id=?', ANIMAL);
        console.log('::BEFORE:: ' + JSON.stringify(before));
        expect(before?.rt).toBe('adoption');
    
        await page.goto(`/my-animals/${ANIMAL}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });
        await page.getByRole('button', { name: /Registrar devoluci|Record return/i }).first().click();
    
        // Current behaviour: this navigates to the adopter's wizard.
        await page.waitForURL(/\/adopter\//, { timeout: 30000 });
        const dlg = page.locator('[role="dialog"], .fixed.inset-0').last();
        await expect(dlg).toContainText(/What happened|Qué pasó|Details|Detalles/, { timeout: 20000 });
        for (let i = 0; i < 4; i++) {
            const b = dlg.getByRole('button', { name: /Next|Siguiente/ }).first();
            if (await b.count() && await b.isEnabled()) { await b.click(); await page.waitForTimeout(1200); }
            else break;
        }
        const save = dlg.getByRole('button', { name: /Save|Guardar|Registrar/ }).first();
        if (await save.count()) await save.click();
        await page.waitForTimeout(5000);
    
        const after = q<{ rt: string; ad: string | null }>('SELECT record_type rt, adopter_id ad FROM adoptions WHERE id=?', ANIMAL);
        const open = q<{ n: number }>('SELECT COUNT(*) n FROM placements WHERE animal_id=? AND ended_at IS NULL', ANIMAL)?.n;
        const ev = q<{ n: number }>("SELECT COUNT(*) n FROM adopter_events WHERE animal_id=? AND event_type='returned_pet'", ANIMAL)?.n;
        console.log(`::AFTER:: ${JSON.stringify(after)}  openPlacements=${open}  returnEvents=${ev}`);
        expect(ev).toBeGreaterThan(0);
        expect(open).toBe(0);
        expect(after?.rt).toBe('available');
        expect(after?.ad).toBeNull();
    
        // Put Timon back: four sibling tests expect him adopted.
        for (const f of DBS) {
            try {
                const db = new Database(f);
                db.prepare("UPDATE placements SET ended_at = NULL WHERE animal_id = ? AND record_type = 'adoption'").run(ANIMAL);
                db.prepare("DELETE FROM adopter_events WHERE animal_id = ? AND event_type = 'returned_pet'").run(ANIMAL);
                db.close();
            } catch { /* ignore */ }
        }
    });

    test('in-place edit updates identity without touching custody', async ({ page }) => {
        await page.goto(`/my-animals/${ANIMAL_ID}`);
        await expect(page.getByTestId('animal-name')).toBeVisible({ timeout: 30000 });

        await page.getByTestId('profile-edit').click();
        const colorInput = page.locator('#ae-color');
        await expect(colorInput).toBeVisible();
        const newColor = `caramelo`;
        await colorInput.fill(newColor);
        await page.getByTestId('inline-edit-save').click();

        // Back out of edit mode with the new color in the descriptor…
        await expect(page.getByTestId('inline-edit-form')).not.toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('animal-header')).toContainText(newColor);
        // …and the adoption is still active (the old edit form used to end it).
        await expect(page.getByTestId('animal-status-chip')).toHaveAttribute('href', '/adopter/test-adopter-fixture-tl1');
    });
});
