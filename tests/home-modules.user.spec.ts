import { test, expect, type Locator, type Page } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1Batch } from './db';

/**
 * Homepage modules (2026-11-04): every number on a card is the number on the
 * page it opens. Runs as the `user` project (testuser@example.com, in no
 * group) with ENABLE_CLEAN_HOMEPAGE off (the seed default).
 *
 * Other specs add rows for the same user in parallel, so each comparison
 * re-reads BOTH sides until they agree (expect.poll) instead of trusting one
 * snapshot. Fixtures carry `test-hm-fixture-*` ids and are removed after.
 * Selectors are data-testids: Chromium renders English.
 */

const USER = 'testuser@example.com';
const stamp = Date.now();
const POST_ADOPTER = `test-hm-fixture-post-${stamp}`;
const POST_NAME = `Posteado Home ${stamp}`;
const DUE_ADOPTER = `test-hm-fixture-home-${stamp}`;
const DUE_ANIMAL = `test-hm-fixture-an-${stamp}`;
const DUE_ANIMAL_NAME = `Controlin ${stamp}`;
// A possible duplicate of the user's own: the newest and strongest, so it's the first the amber row names.
const PAIR_A = `test-hm-fixture-pa-${stamp}`;
const PAIR_B = `test-hm-fixture-pb-${stamp}`;
const PAIR_CAND = `test-hm-fixture-cand-${stamp}`;
const PAIR_NAME = `Parejita Home ${stamp}`;
// «Evaluar solicitudes» (2026-11-10): an animal with 2 applications to evaluate, and an adopted
// one whose adoption closed a candidate who was not told yet (the offer row).
const EV = (k: string) => `test-hm-fixture-ev-${k}-${stamp}`;
const EV_ANIMAL = EV('an');
const EV_ANIMAL_NAME = `Evaluable ${stamp}`;
const EV_APPLICANTS = [
    { adopter: EV('ad1'), form: EV('fs1'), app: EV('app1'), name: `Postulanta Uno ${stamp}`, days: 2 },
    { adopter: EV('ad2'), form: EV('fs2'), app: EV('app2'), name: `Postulanta Dos ${stamp}`, days: 1 },
];
const EV_ADOPTED = EV('ado');
const EV_ADOPTED_NAME = `Adoptadita ${stamp}`;
const EV_HOME = EV('home');
const EV_CANDIDATE = { adopter: EV('ad4'), form: EV('fs4'), app: EV('app4'), name: `Candidata Cuatro ${stamp}` };
const EV_ADOPTERS = [...EV_APPLICANTS.map(a => a.adopter), EV_HOME, EV_CANDIDATE.adopter];
const EV_FORMS = [...EV_APPLICANTS.map(a => a.form), EV_CANDIDATE.form];
const inList = (ids: string[]) => ids.map(id => `'${id}'`).join(', ');

const numberIn = async (loc: Locator): Promise<number> => Number(((await loc.textContent()) ?? '').match(/\d+/)?.[0] ?? NaN);
/** The number in a row's line under the name (the fixture names carry digits of their own; both carry a title). */
const lineNumberIn = (row: Locator): Promise<number> => numberIn(row.locator('[title]').last());
/** Every row of Mis animales that is an animal (never «Sin animal elegido»). */
const ANIMAL_ROWS = '[data-testid="home-animals-due"], [data-testid="home-animal-row"], [data-testid="home-animals-applications"], [data-testid="home-animals-offer"]';

async function openHome(page: Page) {
    await page.goto('/');
    await dismissCountryBanner(page);
    await expect(page.getByTestId('home-modules')).toBeVisible({ timeout: 60_000 });
}

/** A card's summary number, then — through the card's own header link — the destination's number. */
async function cardAndDestination(page: Page, card: string, destination: (page: Page) => Locator): Promise<[number, number]> {
    await openHome(page);
    const onCard = await numberIn(page.getByTestId(`${card}-summary`));
    await page.getByTestId(`${card}-header`).click();
    const dest = destination(page);
    await expect(dest).toBeVisible({ timeout: 60_000 });
    return [onCard, await numberIn(dest)];
}

test.describe.serial('homepage modules', () => {
    test.beforeAll(() => {
        execD1Batch([
            // Someone the user brought in from a Facebook post.
            `INSERT INTO adopters (id, name, contact_info, status, added_by, source, source_url, created_at, updated_at) VALUES ('${POST_ADOPTER}', '${POST_NAME}', '', '5', '${USER}', 'imported', 'https://www.facebook.com/share/p/${stamp}', strftime('%s','now'), strftime('%s','now'))`,
            `INSERT INTO adopter_events (id, adopter_id, event_type, rating, source_url, recorded_by, created_at) VALUES ('test-hm-fixture-ev-${stamp}', '${POST_ADOPTER}', 'observation', 2, 'https://www.facebook.com/share/p/${stamp}', '${USER}', strftime('%s','now'))`,
            // An animal adopted 40 days ago: its first-month check-in is overdue.
            `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ('${DUE_ADOPTER}', 'Hogar Home ${stamp}', '', '5', '${USER}', strftime('%s','now','-40 days'), strftime('%s','now','-40 days'))`,
            `INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('${DUE_ANIMAL}', '${DUE_ANIMAL_NAME}', 'dog', '${USER}', strftime('%s','now','-60 days'), strftime('%s','now','-60 days'))`,
            `INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('test-hm-fixture-pl-${stamp}', '${DUE_ANIMAL}', '${DUE_ADOPTER}', 'adoption', strftime('%s','now','-40 days'), '${USER}')`,
            `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ('${PAIR_A}', '${PAIR_NAME}', '', '5', '${USER}', strftime('%s','now','-2 days'), strftime('%s','now','-2 days'))`,
            `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ('${PAIR_B}', '${PAIR_NAME} G.', '', '5', '${USER}', strftime('%s','now'), strftime('%s','now'))`,
            `INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at) VALUES ('${PAIR_CAND}', '${PAIR_B}', '${PAIR_A}', '["name_word"]', '{}', 100, 'high', 'pending', strftime('%s','now','+1 day'))`,
            // An available animal with two applications to evaluate, each on its own profile.
            `INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('${EV_ANIMAL}', '${EV_ANIMAL_NAME}', 'cat', 'hembra', '${USER}', strftime('%s','now','-10 days'), strftime('%s','now','-10 days'))`,
            ...EV_APPLICANTS.flatMap(a => [
                `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${a.adopter}', '${a.name}', '', '5', '${USER}', 'form', strftime('%s','now','-${a.days} days'), strftime('%s','now','-${a.days} days'))`,
                `INSERT INTO form_submissions (id, user_id, name, email, phone, status, selected_animal_id, linked_adopter_id, created_at) VALUES ('${a.form}', '${USER}', '${a.name}', '${a.form}@example.com', '11 5555 01${a.days}${a.days}', 'pending', '${EV_ANIMAL}', '${a.adopter}', strftime('%s','now','-${a.days} days'))`,
                `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${a.app}', '${a.form}', '${EV_ANIMAL}', 'form', 'open', strftime('%s','now','-${a.days} days'))`,
            ]),
            // Adopted today (no check-up due yet); its adoption closed a candidate nobody has told.
            `INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('${EV_ADOPTED}', '${EV_ADOPTED_NAME}', 'dog', 'hembra', '${USER}', strftime('%s','now','-20 days'), strftime('%s','now'))`,
            `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ('${EV_HOME}', 'Hogar Evaluar ${stamp}', '', '5', '${USER}', strftime('%s','now'), strftime('%s','now'))`,
            `INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('${EV('pl')}', '${EV_ADOPTED}', '${EV_HOME}', 'adoption', strftime('%s','now'), '${USER}')`,
            `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${EV_CANDIDATE.adopter}', '${EV_CANDIDATE.name}', '', '5', '${USER}', 'form', strftime('%s','now','-5 days'), strftime('%s','now','-5 days'))`,
            `INSERT INTO form_submissions (id, user_id, name, email, phone, status, selected_animal_id, linked_adopter_id, created_at) VALUES ('${EV_CANDIDATE.form}', '${USER}', '${EV_CANDIDATE.name}', 'candidata-${stamp}@example.com', '11 5555 0144', 'pending', '${EV_ADOPTED}', '${EV_CANDIDATE.adopter}', strftime('%s','now','-5 days'))`,
            `INSERT INTO applications (id, submission_id, animal_id, origin, state, close_reason, offer_done_at, closed_at, closed_by, created_at) VALUES ('${EV_CANDIDATE.app}', '${EV_CANDIDATE.form}', '${EV_ADOPTED}', 'form', 'closed', 'adopted_other', NULL, strftime('%s','now'), 'application-auto', strftime('%s','now','-5 days'))`,
        ]);
    });

    test.afterAll(() => {
        execD1Batch([
            // The check-in the last test registers from the home (adoptions is a view; follow-ups live here).
            `DELETE FROM adopter_events WHERE adopter_id = '${DUE_ADOPTER}'`,
            `DELETE FROM placements WHERE id = 'test-hm-fixture-pl-${stamp}'`,
            `DELETE FROM animals WHERE id = '${DUE_ANIMAL}'`,
            `DELETE FROM adopter_events WHERE id = 'test-hm-fixture-ev-${stamp}'`,
            `DELETE FROM duplicate_candidates WHERE id = '${PAIR_CAND}'`,
            `DELETE FROM adopter_flags WHERE adopter_id IN ('${PAIR_A}', '${PAIR_B}') OR target_adopter_id IN ('${PAIR_A}', '${PAIR_B}')`,
            `DELETE FROM adopters WHERE id IN ('${POST_ADOPTER}', '${DUE_ADOPTER}', '${PAIR_A}', '${PAIR_B}')`,
            // «Evaluar solicitudes»: the applications, forms, the «No avanzar» observation and its trail.
            `DELETE FROM applications WHERE submission_id IN (${inList(EV_FORMS)})`,
            `DELETE FROM form_submissions WHERE id IN (${inList(EV_FORMS)})`,
            `DELETE FROM adopter_events WHERE adopter_id IN (${inList(EV_ADOPTERS)})`,
            `DELETE FROM adopter_history WHERE adopter_id IN (${inList(EV_ADOPTERS)})`,
            `DELETE FROM adopter_flags WHERE adopter_id IN (${inList(EV_ADOPTERS)})`,
            `DELETE FROM notifications WHERE url LIKE '%${stamp}%' OR metadata LIKE '%${stamp}%'`,
            `DELETE FROM placements WHERE id = '${EV('pl')}'`,
            `DELETE FROM animals WHERE id IN ('${EV_ANIMAL}', '${EV_ADOPTED}')`,
            `DELETE FROM adopters WHERE id IN (${inList(EV_ADOPTERS)})`,
            `UPDATE user_profiles SET home_prefs = NULL WHERE user_id = (SELECT id FROM user WHERE email = '${USER}')`,
        ]);
    });

    test('Mis adoptantes: the card count is the «Todos» count on /my-adopters', async ({ page }) => {
        test.setTimeout(240_000);
        await expect.poll(async () => {
            const [card, dest] = await cardAndDestination(page, 'home-adopters', p => p.getByTestId('filter-all-count'));
            return card === dest && card > 0;
        }, { timeout: 200_000, intervals: [2_000] }).toBe(true);
    });

    test('Mis adoptantes: a form that looks like someone already registered counts as «pendientes de revisar», never as a form to review', async ({ page, request }) => {
        test.setTimeout(120_000);
        const s = String(Date.now());
        const person = { name: `Formulario Home ${s}`, email: `e2e-home-form-${s}@example.com`, phone: `19${s.slice(-8)}`, address: '1 Home St', intent: 'self' };
        for (let i = 0; i < 2; i++) {
            const res = await request.post('/api/form/test-user-id/submit', { data: person });
            expect(res.ok(), await res.text()).toBeTruthy();
        }
        await page.goto('/');
        await dismissCountryBanner(page);
        // One row per pending item now (option b): any of them.
        await expect(page.getByTestId('home-adopters-pending').first()).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('home-adopters-forms')).toHaveCount(0);
    });

    test('Posts de redes: the card counts people, the same as «Desde un post»', async ({ page }) => {
        test.setTimeout(240_000);
        await openHome(page);
        const posts = page.getByTestId('home-posts');
        await expect(posts).toBeVisible();
        // The newest post's person, with the network and «Observación», never «Reporte».
        await expect(posts.getByTestId('home-person-row').first()).toContainText(POST_NAME);
        await expect(posts.getByTestId('home-person-row').first()).toContainText('Facebook');
        await expect.poll(async () => {
            const [card, dest] = await cardAndDestination(page, 'home-posts', p => p.getByTestId('filter-posts-count'));
            return card === dest && card > 0;
        }, { timeout: 200_000, intervals: [2_000] }).toBe(true);
        await expect(page).toHaveURL(/filtro=posts/);
    });

    test('Mis animales: one amber row per overdue animal, and «Con controles pendientes» lists the same number', async ({ page }) => {
        test.setTimeout(240_000);
        await openHome(page);
        const animals = page.getByTestId('home-animals');
        await expect(animals.getByTestId('home-animals-due').filter({ hasText: DUE_ANIMAL_NAME })).toHaveCount(1);
        // Shown as the animal it is: its photo (or the species placeholder) beside the name.
        await expect(animals.getByTestId('home-animals-due').filter({ hasText: DUE_ANIMAL_NAME }).locator('img')).toHaveCount(1);
        await expect.poll(async () => {
            await openHome(page);
            const card = page.getByTestId('home-animals');
            const rows = await card.getByTestId('home-animals-due').count();
            const more = card.getByTestId('home-animals-due-more');
            const onCard = rows + ((await more.count()) > 0 ? await numberIn(more) : 0);
            await page.goto('/my-animals?view=pendientes');
            const tab = page.getByTestId('tab-pendientes');
            await expect(tab).toBeVisible({ timeout: 60_000 });
            await expect(page.getByText(DUE_ANIMAL_NAME).first()).toBeVisible({ timeout: 60_000 });
            return onCard === await numberIn(tab);
        }, { timeout: 200_000, intervals: [2_000] }).toBe(true);
    });

    test('Mis animales: at most 4 animals (one per slot), each once; «Ver los N animales» is the «Todos» count', async ({ page }) => {
        test.setTimeout(240_000);
        await openHome(page);
        const card = page.getByTestId('home-animals');
        // Every slot: the animals (general forms are «Mis adoptantes» rows since 2026-11-13).
        const rows = card.locator(ANIMAL_ROWS);
        expect(await rows.count()).toBeLessThanOrEqual(4);
        // The overdue animal is listed as due, never again as «recently updated».
        await expect(card.getByTestId('home-animal-row').filter({ hasText: DUE_ANIMAL_NAME })).toHaveCount(0);
        await expect.poll(async () => {
            await openHome(page);
            const c = page.getByTestId('home-animals');
            const more = c.getByTestId('home-animals-more');
            // No «Ver los N» when every animal already has its row.
            const onCard = (await more.count()) > 0
                ? await numberIn(more)
                : await c.locator(ANIMAL_ROWS).count();
            await page.goto('/my-animals?view=todos');
            const tab = page.getByTestId('tab-todos');
            await expect(tab).toBeVisible({ timeout: 60_000 });
            await expect(page.getByText(DUE_ANIMAL_NAME).first()).toBeVisible({ timeout: 60_000 });
            return onCard === await numberIn(tab);
        }, { timeout: 200_000, intervals: [2_000] }).toBe(true);
    });

    test('Mis adoptantes: a pending pair is its own row; answering it over the home shows the next one', async ({ page }) => {
        test.setTimeout(240_000);
        await openHome(page);
        // One row per item waiting on the user (option b) — the fixture is the newest, strongest pair.
        const row = page.getByTestId('home-adopters-pending').filter({ hasText: PAIR_NAME });
        await expect(row).toHaveCount(1, { timeout: 60_000 });
        await row.click();

        // Over the home: that pair, open, with «No, es otra persona».
        const panel = page.getByTestId('home-pending-panel');
        await expect(panel).toBeVisible({ timeout: 60_000 });
        await expect(page).toHaveURL(/\/$|\/\?/);
        const open = panel.getByTestId('dedup-row');
        await expect(open).toContainText(PAIR_NAME, { timeout: 60_000 });
        await expect(panel.getByTestId('home-pending-panel-all')).toHaveAttribute('href', '/my-adopters#pendientes');
        await open.getByTestId('dedup-keep-separate').click();

        // Still on the home: the panel moves to the next pair (or closes when none is left); the card drops this row.
        await expect(page).toHaveURL(/\/$|\/\?/);
        await expect(panel.getByTestId('dedup-row').filter({ hasText: PAIR_NAME })).toHaveCount(0, { timeout: 60_000 });
        if (await panel.isVisible()) await panel.getByTestId('home-pending-panel-close').click();
        await expect(row).toHaveCount(0, { timeout: 60_000 });
    });

    test('Mis animales: the animal row\'s «N solicitudes por evaluar» equals the applications its panel lists to evaluate', async ({ page }) => {
        test.setTimeout(240_000);
        await openHome(page);
        const row = page.getByTestId('home-animals').getByTestId('home-animals-applications').filter({ hasText: EV_ANIMAL_NAME });
        await expect(row).toHaveCount(1, { timeout: 60_000 });
        // The amber line in place of the grey «Disponible · N interesadas».
        expect(await lineNumberIn(row)).toBe(EV_APPLICANTS.length);
        await row.click();
        const panel = page.getByTestId('home-applicants-panel');
        await expect(panel.locator('#applicant-panel-title')).toBeVisible({ timeout: 60_000 });
        // Every one of them is still to evaluate: no outcome line, «No avanzar» offered.
        await expect(panel.getByLabel(`1 / ${EV_APPLICANTS.length}`)).toHaveCount(1);
        await expect(panel.getByTestId('applicant-status-line')).toHaveCount(0);
        await expect(panel.getByTestId('evaluate-decline')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
    });

    test('Mis animales: tapping the row opens the applicant panel over the home; «No avanzar» there moves to the next and the row\'s count drops', async ({ page }) => {
        test.setTimeout(240_000);
        await openHome(page);
        const row = page.getByTestId('home-animals').getByTestId('home-animals-applications').filter({ hasText: EV_ANIMAL_NAME });
        await expect(row).toHaveCount(1, { timeout: 60_000 });
        const before = await lineNumberIn(row);
        await row.click();

        const panel = page.getByTestId('home-applicants-panel');
        const title = panel.locator('#applicant-panel-title');
        await expect(title).toBeVisible({ timeout: 60_000 });
        await expect(page).toHaveURL(/\/$|\/\?/);
        const first = (await title.textContent()) ?? '';
        expect(EV_APPLICANTS.some(a => first.includes(a.name))).toBe(true);

        await panel.getByTestId('evaluate-decline').click();
        const dialog = page.getByTestId('decline-dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: '4 stars' }).click();
        await dialog.getByTestId('decline-reason').fill('Prefirió esperar a un cachorro.');
        await dialog.getByTestId('decline-save').click();

        // Still on the home: the panel moved on to the other applicant, and the card says one fewer.
        await expect(page).toHaveURL(/\/$|\/\?/);
        await expect(dialog).toHaveCount(0, { timeout: 60_000 });
        const other = EV_APPLICANTS.find(a => !first.includes(a.name))!;
        await expect(title).toContainText(other.name, { timeout: 60_000 });
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect.poll(() => lineNumberIn(row), { timeout: 60_000, intervals: [1_000] }).toBe(before - 1);
    });

    test('Mis animales: offer row → sheet → «Listo» → the row is gone after reload', async ({ page }) => {
        test.setTimeout(240_000);
        await openHome(page);
        const row = page.getByTestId('home-animals').getByTestId('home-animals-offer').filter({ hasText: EV_ADOPTED_NAME });
        await expect(row).toHaveCount(1, { timeout: 60_000 });
        await row.click();

        const sheet = page.getByTestId('offer-sheet');
        await expect(sheet).toBeVisible({ timeout: 60_000 });
        await expect(page).toHaveURL(/\/$|\/\?/);
        // The candidate, with the contacts they left on the form, and the message to edit.
        await expect(sheet.getByTestId('offer-message')).toBeVisible({ timeout: 60_000 });
        await expect(sheet.getByTestId(`offer-wa-${EV_CANDIDATE.app}`)).toHaveAttribute('href', /^https:\/\/wa\.me\/\d+\?text=/);
        await expect(sheet.getByTestId(`offer-email-${EV_CANDIDATE.app}`)).toHaveAttribute('href', new RegExp(`^mailto:candidata-${stamp}@example\\.com\\?subject=`));
        await sheet.getByTestId('offer-done').click();
        await expect(sheet).toHaveCount(0, { timeout: 60_000 });

        await openHome(page);
        await expect(page.getByTestId('home-animals')).toBeVisible();
        await expect(page.getByTestId('home-animals').getByTestId('home-animals-offer').filter({ hasText: EV_ADOPTED_NAME })).toHaveCount(0);
    });

    // Last: it resolves the fixture's check-in, which the tests above count on.
    test('Mis animales: an overdue animal opens «Para hacer ahora» over the home, and registering there clears it', async ({ page }) => {
        test.setTimeout(240_000);
        await openHome(page);
        const row = page.getByTestId('home-animals').getByTestId('home-animals-due').filter({ hasText: DUE_ANIMAL_NAME });
        await row.click();

        // Over the home, not the animal page: the same block, with «Registrar», and the way to the page.
        const panel = page.getByTestId('home-due-panel');
        await expect(panel).toBeVisible({ timeout: 60_000 });
        await expect(page).toHaveURL(/\/$|\/\?/);
        await expect(panel.getByTestId('due-banner')).toBeVisible({ timeout: 60_000 });
        await expect(panel.getByTestId('home-due-panel-page')).toHaveAttribute('href', `/my-animals/${DUE_ANIMAL}`);

        await panel.locator('[data-testid^="register-"]').first().click();
        await expect(page.getByTestId('animal-event-type')).toHaveValue('follow_up');
        await page.getByRole('button', { name: '4 stars' }).click();
        await page.getByTestId('animal-event-save').click();

        // Still on the home; once nothing is due the panel closes and the card drops the animal.
        await expect(page).toHaveURL(/\/$|\/\?/);
        await expect.poll(async () => {
            if (await panel.isVisible()) await panel.getByTestId('home-due-panel-close').click();
            return row.count();
        }, { timeout: 60_000, intervals: [2_000] }).toBe(0);
    });

});

/**
 * Home ↔ «Con solicitudes por evaluar» (spec «every home count equals the page it opens»): the
 * home's application rows, «Sin animal elegido» and «N animales más con solicitudes» account for
 * every card on /my-animals?view=solicitudes — including an animal that is both due and has
 * applications, which the home lists as due (check-up first) but the tab must still list. Its own
 * fixtures (more to-dos than the 4 slots, so «más» shows), made after the suite above has cleaned up.
 */
test.describe.serial('homepage ↔ «Con solicitudes por evaluar»', () => {
    const P = (k: string) => `test-hm-fixture-par-${k}-${stamp}`;
    // Fostered 35 days ago: its first monthly foster check-in is due, and it takes applications.
    const DUAL = P('dual');
    const DUAL_NAME = `Transitoria ${stamp}`;
    const FOSTER_HOME = P('foster');
    const ANIMALS = [DUAL, ...[1, 2, 3, 4].map(i => P(`an${i}`))];
    const NAMES = [DUAL_NAME, ...[1, 2, 3, 4].map(i => `Pedida ${i} ${stamp}`)];
    // One applicant per animal, plus one general application.
    const APPS = [...ANIMALS.map((animal, i) => ({ animal: animal as string | null, i })), { animal: null as string | null, i: ANIMALS.length }]
        .map(({ animal, i }) => ({ animal, adopter: P(`ad${i}`), form: P(`fs${i}`), app: P(`app${i}`), name: `Paridad ${i} ${stamp}` }));
    const ROW_NAME = '[title]';

    test.beforeAll(() => {
        execD1Batch([
            ...ANIMALS.map((id, i) => `INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('${id}', '${NAMES[i]}', 'dog', 'macho', '${USER}', strftime('%s','now','-50 days'), strftime('%s','now','-50 days'))`),
            `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ('${FOSTER_HOME}', 'Hogar Paridad ${stamp}', '', '5', '${USER}', strftime('%s','now','-35 days'), strftime('%s','now','-35 days'))`,
            `INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('${P('pl')}', '${DUAL}', '${FOSTER_HOME}', 'foster', strftime('%s','now','-35 days'), '${USER}')`,
            ...APPS.flatMap(a => [
                `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${a.adopter}', '${a.name}', '', '5', '${USER}', 'form', strftime('%s','now','-1 days'), strftime('%s','now','-1 days'))`,
                `INSERT INTO form_submissions (id, user_id, name, email, status, selected_animal_id, linked_adopter_id, created_at) VALUES ('${a.form}', '${USER}', '${a.name}', '${a.form}@example.com', 'pending', ${a.animal ? `'${a.animal}'` : 'NULL'}, '${a.adopter}', strftime('%s','now','-1 days'))`,
                `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${a.app}', '${a.form}', ${a.animal ? `'${a.animal}'` : 'NULL'}, 'form', 'open', strftime('%s','now','-1 days'))`,
            ]),
        ]);
    });

    test.afterAll(() => {
        execD1Batch([
            `DELETE FROM applications WHERE submission_id IN (${inList(APPS.map(a => a.form))})`,
            `DELETE FROM form_submissions WHERE id IN (${inList(APPS.map(a => a.form))})`,
            `DELETE FROM adopter_events WHERE adopter_id IN (${inList([FOSTER_HOME, ...APPS.map(a => a.adopter)])})`,
            `DELETE FROM adopter_history WHERE adopter_id IN (${inList([FOSTER_HOME, ...APPS.map(a => a.adopter)])})`,
            `DELETE FROM notifications WHERE url LIKE '%${stamp}%' OR metadata LIKE '%${stamp}%'`,
            `DELETE FROM placements WHERE id = '${P('pl')}'`,
            `DELETE FROM animals WHERE id IN (${inList(ANIMALS)})`,
            `DELETE FROM adopters WHERE id IN (${inList([FOSTER_HOME, ...APPS.map(a => a.adopter)])})`,
        ]);
    });

    test('the home\'s «N solicitudes por evaluar» rows + «N animales más con solicitudes» account for every card on the tab, an animal both due and with applications included', async ({ page }) => {
        test.setTimeout(240_000);
        await expect.poll(async () => {
            await openHome(page);
            const card = page.getByTestId('home-animals');
            await expect(card.locator(ANIMAL_ROWS).first()).toBeVisible({ timeout: 60_000 });
            // Every row shown, by name.
            const shown = new Set<string>();
            for (const r of await card.locator(ANIMAL_ROWS).all()) {
                shown.add((await r.locator(ROW_NAME).first().getAttribute('title')) ?? '');
            }
            const appRows: string[] = [];
            for (const r of await card.locator('[data-testid="home-animals-applications"]').all()) {
                appRows.push((await r.locator(ROW_NAME).first().getAttribute('title')) ?? '');
            }
            // The fostered animal reads as due on the home, never as an applications row.
            const dualAsApplications = await card.getByTestId('home-animals-applications').filter({ hasText: DUAL_NAME }).count();
            const moreRow = card.getByTestId('home-animals-applications-more');
            const more = (await moreRow.count()) > 0 ? await numberIn(moreRow) : 0;

            await page.goto('/my-animals?view=solicitudes');
            const tab = page.getByTestId('tab-solicitudes');
            await expect(tab).toBeVisible({ timeout: 60_000 });
            await expect(page.locator('[data-testid^="animal-card-"]').first()).toBeVisible({ timeout: 60_000 });
            const tabNames = (await page.locator('[data-testid^="animal-card-"] + div h3').allTextContents()).map(n => n.trim());
            const verdict = {
                tabIsItsCards: (await numberIn(tab)) === tabNames.length,
                hiddenAreTheMore: tabNames.filter(n => !shown.has(n)).length === more,
                applicationRowsOnTab: appRows.every(n => tabNames.includes(n)),
                dualOnTab: tabNames.includes(DUAL_NAME),
                dualAsApplications,
                moreShows: more > 0,
            };
            console.log('PARITY', JSON.stringify({ ...verdict, more, shown: [...shown], tabNames }));
            return verdict;
        }, { timeout: 200_000, intervals: [2_000] }).toEqual({
            tabIsItsCards: true, hiddenAreTheMore: true, applicationRowsOnTab: true, dualOnTab: true, dualAsApplications: 0, moreShows: true,
        });
    });
});
