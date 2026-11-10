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

const numberIn = async (loc: Locator): Promise<number> => Number(((await loc.textContent()) ?? '').match(/\d+/)?.[0] ?? NaN);

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
        const rows = card.locator('[data-testid="home-animals-due"], [data-testid="home-animal-row"]');
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
                : await c.locator('[data-testid="home-animals-due"], [data-testid="home-animal-row"]').count();
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
