import { test, expect, type Locator, type Page } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1Batch } from './db';

/**
 * Mis animales «Con solicitudes por evaluar» (spec 2026-11-10, «Destination
 * pages»): the tab lists the animals with applications to evaluate, each with
 * its amber row opening the applicant panel over the page («← Volver» returns
 * to it), and «Sin animal elegido» — the general applications — as its first
 * card, only there. A bell notice's deep link opens the panel at that
 * application. An adopted animal whose candidates were not told yet carries the
 * home's offer row on its card (amendment A3).
 *
 * Runs as the admin, whose team has other applications (seed, other specs): no
 * absolute numbers, every comparison is between two things on screen. Fixtures
 * are `test-ev-fixture-*-<stamp>` and are removed after. Selectors are
 * data-testids: Chromium renders English.
 */

const ADMIN = 'gatitosolivos@gmail.com';
const stamp = Date.now();
const F = (k: string) => `test-ev-fixture-${k}-${stamp}`;

// An available cat with two applications to evaluate, each on its own profile (the older one is first in the panel).
const ANIMAL = F('an');
const ANIMAL_NAME = `Evaluanda ${stamp}`;
const APPLICANTS = [
    { adopter: F('ad1'), form: F('fs1'), app: F('app1'), name: `Solicitante Uno ${stamp}`, days: 2 },
    { adopter: F('ad2'), form: F('fs2'), app: F('app2'), name: `Solicitante Dos ${stamp}`, days: 1 },
];
// General applications through the admin's link: one to decline, one to propose the animal to.
const GENERAL = {
    decline: { adopter: F('gd'), form: F('fgd'), app: F('appgd'), name: `General Declinable ${stamp}` },
    propose: { adopter: F('gp'), form: F('fgp'), app: F('appgp'), name: `General Proponible ${stamp}` },
};
// Adopted; its adoption closed a candidate nobody has told yet.
const ADOPTED = F('ado');
const ADOPTED_NAME = `Adoptada Aviso ${stamp}`;
const HOME = F('home');
const CANDIDATE = { adopter: F('ad4'), form: F('fs4'), app: F('app4'), name: `Candidata Aviso ${stamp}` };

const ADOPTERS = [...APPLICANTS.map(a => a.adopter), GENERAL.decline.adopter, GENERAL.propose.adopter, HOME, CANDIDATE.adopter];
const FORMS = [...APPLICANTS.map(a => a.form), GENERAL.decline.form, GENERAL.propose.form, CANDIDATE.form];
const inList = (ids: string[]) => ids.map(id => `'${id}'`).join(', ');

const numberIn = async (loc: Locator): Promise<number> => Number(((await loc.textContent()) ?? '').match(/\d+/)?.[0] ?? NaN);
/** The count at the end of a line that starts with a fixture name (the names carry digits of their own). */
const lastNumberIn = async (loc: Locator): Promise<number> => Number(((await loc.textContent()) ?? '').match(/(\d+)\D*$/)?.[1] ?? NaN);

async function openTab(page: Page, view = 'solicitudes') {
    await page.goto(`/my-animals?view=${view}`);
    await dismissCountryBanner(page);
    await expect(page.getByTestId('tab-todos')).toBeVisible({ timeout: 60_000 });
}

/** Every card of the tab: «Sin animal elegido» and the animals. */
const cardsOf = (page: Page) => page.locator('[data-testid="general-card"], [data-testid^="animal-card-"]');

/** The panel's applicant named `name`, paging with «Siguiente» through the whole list (the shared DB
 *  collects other specs' general applications, so it can be long). */
async function goToApplicant(panel: Locator, name: string) {
    const title = panel.locator('#applicant-panel-title');
    await expect(title).toBeVisible({ timeout: 60_000 });
    // «i / N» is the paging's aria-label (dots or counter).
    const total = Number(((await panel.locator('[aria-label*=" / "]').first().getAttribute('aria-label')) ?? '').split('/')[1]) || 30;
    for (let i = 0; i < total && !((await title.textContent()) ?? '').includes(name); i++) {
        await panel.getByRole('button', { name: /Siguiente|Next|Próximo/ }).click();
    }
    await expect(title).toContainText(name);
}

test.describe.serial('Mis animales: «Con solicitudes por evaluar»', () => {
    test.beforeAll(() => {
        const person = (p: { adopter: string; form: string; app: string; name: string }, animalId: string | null, daysAgo: number) => [
            `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${p.adopter}', '${p.name}', '', '5', '${ADMIN}', 'form', strftime('%s','now','-${daysAgo} days'), strftime('%s','now','-${daysAgo} days'))`,
            `INSERT INTO form_submissions (id, user_id, name, email, status, selected_animal_id, linked_adopter_id, created_at) VALUES ('${p.form}', '${ADMIN}', '${p.name}', '${p.form}@example.com', 'pending', ${animalId ? `'${animalId}'` : 'NULL'}, '${p.adopter}', strftime('%s','now','-${daysAgo} days'))`,
        ];
        execD1Batch([
            `INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('${ANIMAL}', '${ANIMAL_NAME}', 'cat', 'hembra', '${ADMIN}', strftime('%s','now','-10 days'), strftime('%s','now','-10 days'))`,
            ...APPLICANTS.flatMap(a => [
                ...person(a, ANIMAL, a.days),
                `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${a.app}', '${a.form}', '${ANIMAL}', 'form', 'open', strftime('%s','now','-${a.days} days'))`,
            ]),
            ...[GENERAL.decline, GENERAL.propose].flatMap(g => [
                ...person(g, null, 0),
                `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${g.app}', '${g.form}', NULL, 'form', 'open', strftime('%s','now'))`,
            ]),
            `INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('${ADOPTED}', '${ADOPTED_NAME}', 'dog', 'hembra', '${ADMIN}', strftime('%s','now','-20 days'), strftime('%s','now'))`,
            `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ('${HOME}', 'Hogar Aviso ${stamp}', '', '5', '${ADMIN}', strftime('%s','now'), strftime('%s','now'))`,
            `INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('${F('pl')}', '${ADOPTED}', '${HOME}', 'adoption', strftime('%s','now'), '${ADMIN}')`,
            ...person(CANDIDATE, ADOPTED, 5),
            `INSERT INTO applications (id, submission_id, animal_id, origin, state, close_reason, offer_done_at, closed_at, closed_by, created_at) VALUES ('${CANDIDATE.app}', '${CANDIDATE.form}', '${ADOPTED}', 'form', 'closed', 'adopted_other', NULL, strftime('%s','now'), 'application-auto', strftime('%s','now','-5 days'))`,
        ]);
    });

    test.afterAll(() => {
        execD1Batch([
            // The proposal (a new application on the animal) and the contract link it got.
            `DELETE FROM contract_invitations WHERE animal_id IN ('${ANIMAL}', '${ADOPTED}')`,
            `DELETE FROM applications WHERE submission_id IN (${inList(FORMS)})`,
            `DELETE FROM form_submissions WHERE id IN (${inList(FORMS)})`,
            // The «No avanzar» observation and its trail.
            `DELETE FROM adopter_events WHERE adopter_id IN (${inList(ADOPTERS)})`,
            `DELETE FROM adopter_history WHERE adopter_id IN (${inList(ADOPTERS)})`,
            `DELETE FROM adopter_flags WHERE adopter_id IN (${inList(ADOPTERS)})`,
            `DELETE FROM notifications WHERE url LIKE '%${stamp}%' OR metadata LIKE '%${stamp}%'`,
            `DELETE FROM placements WHERE id = '${F('pl')}'`,
            `DELETE FROM animals WHERE id IN ('${ANIMAL}', '${ADOPTED}')`,
            `DELETE FROM adopters WHERE id IN (${inList(ADOPTERS)})`,
        ]);
    });

    test('the tab count equals the cards; «Sin animal elegido» is the first card and only in this tab', async ({ page }) => {
        test.setTimeout(180_000);
        await openTab(page);
        const tab = page.getByTestId('tab-solicitudes');
        await expect(tab).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId(`solicitudes-badge-${ANIMAL}`)).toBeVisible({ timeout: 60_000 });
        expect(await numberIn(page.getByTestId(`solicitudes-badge-${ANIMAL}`))).toBe(APPLICANTS.length);
        expect(await numberIn(tab)).toBe(await cardsOf(page).count());
        // First, and the form icon instead of a photo.
        await expect(cardsOf(page).first()).toHaveAttribute('data-testid', 'general-card');
        await expect(page.getByTestId('general-card').locator('img')).toHaveCount(0);
        expect(await numberIn(page.getByTestId('general-card-badge'))).toBeGreaterThanOrEqual(2);
        // The adopted animal takes no applications: not on this tab.
        await expect(page.getByTestId(`animal-card-${ADOPTED}`)).toHaveCount(0);

        // The other tabs: no «Sin animal elegido»; the same count on the tab label; the card keeps its amber row.
        const onTab = await numberIn(tab);
        for (const view of ['available', 'todos']) {
            await openTab(page, view);
            await expect(page.getByTestId(`animal-card-${ANIMAL}`)).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('general-card')).toHaveCount(0);
            await expect(page.getByTestId(`solicitudes-badge-${ANIMAL}`)).toBeVisible();
            expect(await numberIn(page.getByTestId('tab-solicitudes'))).toBe(onTab);
        }
    });

    test('the card\'s amber row opens the panel; «← Volver» returns to the page', async ({ page }) => {
        test.setTimeout(180_000);
        await openTab(page);
        await page.getByTestId(`solicitudes-badge-${ANIMAL}`).click();
        const panel = page.getByTestId('my-animals-applicants-panel');
        // At the first one to evaluate (the oldest), both there to compare.
        await expect(panel.locator('#applicant-panel-title')).toContainText(APPLICANTS[0].name, { timeout: 60_000 });
        await expect(panel.getByLabel(`1 / ${APPLICANTS.length}`)).toHaveCount(1);
        await expect(panel.getByTestId('evaluate-send-contract')).toBeVisible();
        await expect(page).toHaveURL(/\/my-animals\?view=solicitudes/);

        await panel.getByTestId('applicant-panel-back').click();
        await expect(panel).toHaveCount(0);
        await expect(page).toHaveURL(/\/my-animals\?view=solicitudes/);
        await expect(page.getByTestId(`solicitudes-badge-${ANIMAL}`)).toBeVisible();
    });

    test('decline from the general card: rating + reason → «No avanzó · …»; the tab count drops by one', async ({ page }) => {
        test.setTimeout(180_000);
        await openTab(page);
        const tab = page.getByTestId('tab-solicitudes');
        const badge = page.getByTestId('general-card-badge');
        await expect(badge).toBeVisible({ timeout: 60_000 });
        const [tabBefore, generalBefore] = [await numberIn(tab), await numberIn(badge)];

        await badge.click();
        const panel = page.getByTestId('my-animals-applicants-panel');
        await goToApplicant(panel, GENERAL.decline.name);
        // A general application: «No avanzar» + «Proponer un animal».
        await expect(panel.getByTestId('evaluate-propose')).toBeVisible();
        await panel.getByTestId('evaluate-decline').click();
        const dialog = page.getByTestId('decline-dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: '4 stars' }).click();
        await dialog.getByTestId('decline-reason').fill('Busca un perro y no tenemos.');
        await dialog.getByTestId('decline-save').click();
        await expect(dialog).toHaveCount(0, { timeout: 60_000 });

        // The panel moves on to the next one to evaluate (or closes when none is left)…
        const title = panel.locator('#applicant-panel-title');
        await expect.poll(async () => !(await panel.isVisible()) || !((await title.textContent()) ?? '').includes(GENERAL.decline.name),
            { timeout: 60_000 }).toBe(true);
        // …and the declined one, paged back to, reads its outcome, with no buttons.
        if (await panel.isVisible()) {
            await goToApplicant(panel, GENERAL.decline.name);
            await expect(panel.getByTestId('applicant-status-line')).toHaveAttribute('data-status', 'declined');
            await expect(panel.getByTestId('evaluate-decline')).toHaveCount(0);
            await panel.getByTestId('applicant-panel-back').click();
        }
        await expect(panel).toHaveCount(0);
        // One fewer general application to evaluate: the card's number, or the whole card when it was the last.
        if (generalBefore > 1) {
            await expect.poll(() => numberIn(badge), { timeout: 60_000 }).toBe(generalBefore - 1);
            expect(await numberIn(tab)).toBe(tabBefore);
        } else {
            await expect(page.getByTestId('general-card')).toHaveCount(0, { timeout: 60_000 });
            await expect.poll(() => numberIn(tab), { timeout: 60_000 }).toBe(tabBefore - 1);
        }
        expect(await numberIn(tab)).toBe(await cardsOf(page).count());
    });

    test('propose from the general card: pick the animal → it becomes that animal\'s candidate; «Enviar contrato» issues a link', async ({ page }) => {
        test.setTimeout(180_000);
        await openTab(page);
        const animalBadge = page.getByTestId(`solicitudes-badge-${ANIMAL}`);
        await expect(animalBadge).toBeVisible({ timeout: 60_000 });
        const before = await numberIn(animalBadge);

        await page.getByTestId('general-card-badge').click();
        const panel = page.getByTestId('my-animals-applicants-panel');
        await goToApplicant(panel, GENERAL.propose.name);
        await panel.getByTestId('evaluate-propose').click();
        const sheet = page.getByTestId('propose-sheet');
        await expect(sheet).toBeVisible();
        await sheet.getByTestId(`propose-animal-${ANIMAL}`).click();
        await expect(sheet).toHaveCount(0, { timeout: 60_000 });
        if (await panel.isVisible()) await panel.getByTestId('applicant-panel-back').click();
        await expect(panel).toHaveCount(0);

        // The person is now one of the animal's candidates to evaluate.
        await expect.poll(() => numberIn(animalBadge), { timeout: 60_000 }).toBe(before + 1);
        await animalBadge.click();
        await goToApplicant(panel, GENERAL.propose.name);
        await panel.getByTestId('evaluate-send-contract').click();
        await expect(panel.locator('code[title]')).toHaveAttribute('title', /^https?:\/\/\S+/, { timeout: 60_000 });
        await panel.getByTestId('applicant-panel-back').click();
        // A contract sent is no longer to evaluate.
        await expect.poll(() => numberIn(animalBadge), { timeout: 60_000 }).toBe(before);
    });

    test('a notification deep link opens the panel at that application', async ({ page }) => {
        test.setTimeout(180_000);
        // The second applicant — not the one the panel opens at by itself.
        await page.goto(`/my-animals?view=solicitudes&animal=${ANIMAL}&solicitud=${APPLICANTS[1].app}`);
        await dismissCountryBanner(page);
        const panel = page.getByTestId('my-animals-applicants-panel');
        await expect(panel.locator('#applicant-panel-title')).toContainText(APPLICANTS[1].name, { timeout: 60_000 });
        // «← Volver» drops the link, so the page stays on the tab.
        await panel.getByTestId('applicant-panel-back').click();
        await expect(panel).toHaveCount(0);
        await expect(page).not.toHaveURL(/solicitud=/);
        await expect(page.getByTestId('tab-solicitudes')).toBeVisible();

        // A general one, from another tab.
        await page.goto(`/my-animals?view=available&animal=general&solicitud=${GENERAL.propose.app}`);
        await expect(panel.locator('#applicant-panel-title')).toContainText(GENERAL.propose.name, { timeout: 60_000 });
        await expect(panel.getByTestId('applicant-status-line')).toHaveAttribute('data-status', 'proposed');
    });

    test('adopted card shows the offer row while the offer is pending, and not after markOfferDone', async ({ page }) => {
        test.setTimeout(180_000);
        for (const view of ['adopted', 'todos']) {
            await openTab(page, view);
            await expect(page.getByTestId(`offer-badge-${ADOPTED}`)).toBeVisible({ timeout: 60_000 });
            expect(await lastNumberIn(page.getByTestId(`offer-badge-${ADOPTED}`))).toBe(1);
            await expect(page.getByTestId(`offer-badge-${ADOPTED}`)).toContainText(ADOPTED_NAME);
        }
        await page.getByTestId(`offer-badge-${ADOPTED}`).click();
        const sheet = page.getByTestId('offer-sheet');
        await expect(sheet.getByTestId(`offer-email-${CANDIDATE.app}`)).toBeVisible({ timeout: 60_000 });
        await sheet.getByTestId('offer-not-now').click();
        await expect(sheet).toHaveCount(0, { timeout: 60_000 });
        await expect(page.getByTestId(`offer-badge-${ADOPTED}`)).toHaveCount(0, { timeout: 60_000 });
        await openTab(page, 'adopted');
        await expect(page.getByTestId(`animal-card-${ADOPTED}`)).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId(`offer-badge-${ADOPTED}`)).toHaveCount(0);
    });
});
