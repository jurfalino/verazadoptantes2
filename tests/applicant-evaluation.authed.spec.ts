import { test, expect, type Page, type Route } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1Batch, rows, isDbNull } from './db';

/**
 * Evaluating applicants, end to end (spec 2026-11-10): a contract sent to one
 * candidate and then another, «No avanzar» on a live contract, an adoption
 * registered in-app closing the other candidates and the offer to tell them
 * (with its three outcomes: people to tell, nobody, a failed read), a fostered
 * animal taking contracts, and a form for an adopted animal landing in «Sin
 * animal elegido».
 *
 * Runs as the admin. Every test has its own animal (a contract retires the
 * animal's other links; an adoption closes all its applications), inserted in
 * beforeAll as `test-ev-fixture-*-<stamp>` and removed in afterAll. Selectors
 * are data-testids (Chromium renders English); outcomes are read from
 * `data-status`.
 */

const ADMIN = 'gatitosolivos@gmail.com';
const ADMIN_USER_ID = 'test-admin-id';
const stamp = Date.now();
// Short keys: an id stays under 52 characters (decline record ids are 'decline-app-<submissionId>' ≤ 64).
const F = (k: string) => `test-ev-fixture-${k}-${stamp}`;

type Person = { adopter: string; form: string; app: string; name: string; email: string };
const person = (k: string, label: string): Person => ({
    adopter: F(`a${k}`), form: F(`f${k}`), app: F(`p${k}`), name: `${label} ${stamp}`, email: `ev-${k}-${stamp}@example.com`,
});
type Animal = { id: string; name: string };
const animal = (k: string, label: string): Animal => ({ id: F(`n${k}`), name: `${label} ${stamp}` });

// 1. A contract sent to A, then to B.
const SWAP = animal('sw', 'Contratada');
const SWAP_A = person('swa', 'Primera Contrato');
const SWAP_B = person('swb', 'Segunda Contrato');
// 2. «No avanzar» on a live contract.
const VOID = animal('vo', 'Anulada');
const VOID_A = person('voa', 'Con Contrato');
const VOID_TOKEN = F('tok');
// 3. An adoption in-app closes the others; the offer sheet opens after the save.
const ADOPT = animal('ad', 'Adoptable');
const ADOPT_A = person('ada', 'Adoptante Elegida');
const ADOPT_B = person('adb', 'Candidata Cerrada');
// 3b. Nobody else applied: no sheet.
const SOLO = animal('so', 'Solitaria');
const SOLO_A = person('soa', 'Unica Candidata');
// 3c. The offer can't be read: the sheet says so (errorId); closing it finishes the save.
const FAILS = {
    refused: { animal: animal('fr', 'Oferta Rechazada'), a: person('fra', 'Adopta Rechazo'), b: person('frb', 'Otra Rechazo') },
    network: { animal: animal('fn', 'Oferta Caida'), a: person('fna', 'Adopta Caida'), b: person('fnb', 'Otra Caida') },
};
// 4. A fostered animal takes contracts.
const FOSTERED = animal('fo', 'Transitada');
const FOSTER_HOME = F('hfo');
const FOSTERED_A = person('foa', 'Pide Transitada');
// 5. A form for an adopted animal.
const ADOPTED = animal('do', 'Ya Adoptada');
const ADOPTED_HOME = F('hdo');

const ANIMALS = [SWAP, VOID, ADOPT, SOLO, FAILS.refused.animal, FAILS.network.animal, FOSTERED, ADOPTED];
const CANDIDATES: Array<[Person, Animal]> = [
    [SWAP_A, SWAP], [SWAP_B, SWAP], [VOID_A, VOID], [ADOPT_A, ADOPT], [ADOPT_B, ADOPT], [SOLO_A, SOLO],
    [FAILS.refused.a, FAILS.refused.animal], [FAILS.refused.b, FAILS.refused.animal],
    [FAILS.network.a, FAILS.network.animal], [FAILS.network.b, FAILS.network.animal],
    [FOSTERED_A, FOSTERED],
];
const PEOPLE = CANDIDATES.map(([p]) => p);
const ADOPTERS = [...PEOPLE.map(p => p.adopter), FOSTER_HOME, ADOPTED_HOME];
const inList = (ids: string[]) => ids.map(id => `'${id}'`).join(', ');

/** Submissions made through the public form in a test (their profiles are auto-created). */
const submitted: string[] = [];

const numberIn = async (page: Page, testId: string): Promise<number> =>
    Number(((await page.getByTestId(testId).textContent()) ?? '').match(/(\d+)\D*$/)?.[1] ?? NaN);

/** The Mis animales panel at one application (a bell notice's deep link). */
async function openPanelAt(page: Page, animalId: string, applicationId: string, name: string, view = 'todos') {
    await page.goto(`/my-animals?view=${view}&animal=${animalId}&solicitud=${applicationId}`);
    await dismissCountryBanner(page);
    const panel = page.getByTestId('my-animals-applicants-panel');
    await expect(panel.locator('#applicant-panel-title')).toContainText(name, { timeout: 60_000 });
    return panel;
}

/** «Enviar contrato» in the panel → the link it issued. */
async function sendContract(page: Page, panel: ReturnType<Page['getByTestId']>): Promise<string> {
    await panel.getByTestId('evaluate-send-contract').click();
    const code = panel.locator('code[title]');
    await expect(code).toHaveAttribute('title', /\/c\/[^/?#]+/, { timeout: 60_000 });
    const url = (await code.getAttribute('title')) ?? '';
    return url.match(/\/c\/([^/?#]+)/)![1];
}

/** The adopter's profile → «Adopción» → the inventory picker → this animal → save. */
async function registerAdoption(page: Page, adopter: Person, target: Animal) {
    await page.goto(`/adopter/${adopter.adopter}`);
    await dismissCountryBanner(page);
    await page.getByTestId('visit-intent-adoption').click({ timeout: 60_000 });
    await expect(page.getByTestId('animal-picker-trigger')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('animal-picker-trigger').click();
    await page.getByTestId(`animal-option-${target.id}`).click();
    await page.getByTestId('wizard-next-step1').click();
    await page.getByTestId('wizard-next-step2').click();
    await page.getByTestId('wizard-submit').click();
}

const applicationRow = (id: string) => rows(`SELECT state, close_reason, offer_done_at, animal_id, asked_animal_id FROM applications WHERE id = '${id}'`)[0];

test.describe.serial('Evaluating applicants, end to end', () => {
    test.beforeAll(() => {
        const daysAgo = (i: number) => `strftime('%s','now','-${i + 1} days')`;
        execD1Batch([
            ...ANIMALS.map(a => `INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('${a.id}', '${a.name}', 'cat', 'hembra', '${ADMIN}', strftime('%s','now','-20 days'), strftime('%s','now','-20 days'))`),
            // Older first: A applied before B.
            ...CANDIDATES.flatMap(([p, a], i) => {
                const at = daysAgo(CANDIDATES.length - i);
                return [
                    `INSERT INTO adopters (id, name, contact_info, status, added_by, source, created_at, updated_at) VALUES ('${p.adopter}', '${p.name}', '', '5', '${ADMIN}', 'form', ${at}, ${at})`,
                    `INSERT INTO form_submissions (id, user_id, name, email, status, selected_animal_id, linked_adopter_id, created_at) VALUES ('${p.form}', '${ADMIN}', '${p.name}', '${p.email}', 'linked', '${a.id}', '${p.adopter}', ${at})`,
                    `INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES ('${p.app}', '${p.form}', '${a.id}', 'form', 'open', ${at})`,
                ];
            }),
            // A live contract for «No avanzar».
            `INSERT INTO contract_invitations (token, animal_id, adopter_id, created_by, created_at, used_at, expires_at) VALUES ('${VOID_TOKEN}', '${VOID.id}', '${VOID_A.adopter}', '${ADMIN}', strftime('%s','now','-1 days'), NULL, strftime('%s','now','+13 days'))`,
            // The foster home and the adopter, each with its active placement.
            ...([[FOSTER_HOME, FOSTERED, 'foster'], [ADOPTED_HOME, ADOPTED, 'adoption']] as const).flatMap(([home, a, type]) => [
                `INSERT INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES ('${home}', 'Hogar ${type} ${stamp}', '', '5', '${ADMIN}', strftime('%s','now'), strftime('%s','now'))`,
                `INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, recorded_by) VALUES ('${F(`pl${type}`)}', '${a.id}', '${home}', '${type}', strftime('%s','now','-5 days'), '${ADMIN}')`,
            ]),
        ]);
    });

    test.afterAll(() => {
        const animals = inList(ANIMALS.map(a => a.id));
        // The submissions the public form made, and the profiles it auto-created for them.
        const auto = submitted.length
            ? rows(`SELECT linked_adopter_id AS a FROM form_submissions WHERE id IN (${inList(submitted)})`).map(r => r.a).filter(a => !isDbNull(a)) as string[]
            : [];
        const adopters = inList([...ADOPTERS, ...auto]);
        const forms = inList([...PEOPLE.map(p => p.form), ...submitted]);
        execD1Batch([
            `DELETE FROM contract_invitations WHERE animal_id IN (${animals})`,
            `DELETE FROM applications WHERE submission_id IN (${forms})`,
            `DELETE FROM form_submissions WHERE id IN (${forms})`,
            // The wizard's adoptions, the «No avanzar» observations, the forms' «Solicitud» records and their trail.
            `DELETE FROM placements WHERE animal_id IN (${animals})`,
            `DELETE FROM adopter_events WHERE adopter_id IN (${adopters})`,
            `DELETE FROM adopter_history WHERE adopter_id IN (${adopters})`,
            `DELETE FROM adopter_flags WHERE adopter_id IN (${adopters})`,
            `DELETE FROM duplicate_tokens WHERE adopter_id IN (${adopters})`,
            `DELETE FROM duplicate_candidates WHERE adopter1_id IN (${adopters}) OR adopter2_id IN (${adopters})`,
            `DELETE FROM notifications WHERE url LIKE '%${stamp}%' OR metadata LIKE '%${stamp}%'${submitted.map(s => ` OR metadata LIKE '%${s}%'`).join('')}`,
            `DELETE FROM animals WHERE id IN (${animals})`,
            `DELETE FROM adopters WHERE id IN (${adopters})`,
        ]);
    });

    test('a contract sent to A then to B: A reads «Su contrato se reemplazó el …» and por evaluar again; the tab count includes A', async ({ page }) => {
        test.setTimeout(240_000);
        let panel = await openPanelAt(page, SWAP.id, SWAP_A.app, SWAP_A.name);
        await sendContract(page, panel);
        panel = await openPanelAt(page, SWAP.id, SWAP_B.app, SWAP_B.name);
        await sendContract(page, panel);

        // A: to evaluate again, with the note that their link was replaced; «Enviar contrato» is back.
        panel = await openPanelAt(page, SWAP.id, SWAP_A.app, SWAP_A.name);
        const line = panel.getByTestId('applicant-status-line');
        await expect(line).toHaveAttribute('data-status', 'to_evaluate');
        await expect(line).toHaveText(/reemplazó|replaced|substituído/);
        await expect(panel.getByTestId('evaluate-send-contract')).toBeVisible();
        await expect(panel.getByTestId('evaluate-decline')).toBeVisible();
        // B holds the live contract.
        panel = await openPanelAt(page, SWAP.id, SWAP_B.app, SWAP_B.name);
        await expect(panel.getByTestId('applicant-status-line')).toHaveAttribute('data-status', 'contract_sent');

        // «Con solicitudes por evaluar»: the animal is there, counting A (B's contract is out).
        await page.goto('/my-animals?view=solicitudes');
        await dismissCountryBanner(page);
        await expect(page.getByTestId(`solicitudes-badge-${SWAP.id}`)).toBeVisible({ timeout: 60_000 });
        expect(await numberIn(page, `solicitudes-badge-${SWAP.id}`)).toBe(1);
        await expect(page.getByTestId(`animal-card-${SWAP.id}`)).toBeVisible();
    });

    test('«No avanzar» on a live contract: the link page answers expired (GET /api/contract/by-token/<token> → 410 expired)', async ({ page, request }) => {
        test.setTimeout(180_000);
        // Live before.
        expect((await request.get(`/api/contract/by-token/${VOID_TOKEN}`)).status()).toBe(200);

        const panel = await openPanelAt(page, VOID.id, VOID_A.app, VOID_A.name);
        await expect(panel.getByTestId('applicant-status-line')).toHaveAttribute('data-status', 'contract_sent');
        await panel.getByTestId('evaluate-decline').click();
        const dialog = page.getByTestId('decline-dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: '3 stars' }).click();
        await dialog.getByTestId('decline-reason').fill('Eligió no seguir con la adopción.');
        await dialog.getByTestId('decline-save').click();
        await expect(dialog).toHaveCount(0, { timeout: 60_000 });
        expect(applicationRow(VOID_A.app).state).toBe('declined');

        // The voided link: expires_at = now, so it reads expired from the next second on.
        await expect.poll(async () => {
            const res = await request.get(`/api/contract/by-token/${VOID_TOKEN}`);
            return `${res.status()} ${((await res.json().catch(() => ({}))) as { code?: string }).code ?? ''}`;
        }, { timeout: 15_000 }).toBe('410 expired');
    });

    test('an adoption registered in-app closes the other candidates: their panel line «Cerrada: … adoptada por otra persona», the offer sheet opens after the save', async ({ page }) => {
        test.setTimeout(240_000);
        await registerAdoption(page, ADOPT_A, ADOPT);

        // The save closed B: the offer to tell them, before the wizard closes.
        const sheet = page.getByTestId('offer-sheet');
        await expect(sheet).toBeVisible({ timeout: 60_000 });
        await expect(sheet.getByTestId('offer-candidate')).toHaveCount(1, { timeout: 60_000 });
        await expect(sheet.getByTestId(`offer-email-${ADOPT_B.app}`)).toBeVisible();
        await expect(page.getByTestId('wizard-close')).toBeVisible();
        // «Listo»: the offer is done, the sheet closes and the save's own close and refresh go on.
        await sheet.getByTestId('offer-done').click();
        await expect(sheet).toHaveCount(0, { timeout: 60_000 });
        await expect(page.getByTestId('wizard-close')).toHaveCount(0, { timeout: 60_000 });
        // …and its refresh: the profile lists the new adoption.
        await expect(page.locator(`[id="adoption-${ADOPT.id}"]`)).toBeVisible({ timeout: 60_000 });
        expect(isDbNull(applicationRow(ADOPT_B.app).offer_done_at)).toBe(false);
        expect(rows(`SELECT adopter_id FROM adoptions WHERE id = '${ADOPT.id}'`)[0]?.adopter_id).toBe(ADOPT_A.adopter);

        // B's line: closed, naming the animal. A's own application: adopted.
        let panel = await openPanelAt(page, ADOPT.id, ADOPT_B.app, ADOPT_B.name, 'adopted');
        const line = panel.getByTestId('applicant-status-line');
        await expect(line).toHaveAttribute('data-status', 'closed');
        await expect(line).toHaveText(new RegExp(`^(Cerrada|Closed|Encerrada): ${ADOPT.name} (fue adoptada por otra persona|was adopted by someone else|foi adotada por outra pessoa)$`));
        await expect(panel.getByTestId('evaluate-decline')).toHaveCount(0);
        panel = await openPanelAt(page, ADOPT.id, ADOPT_A.app, ADOPT_A.name, 'adopted');
        await expect(panel.getByTestId('applicant-status-line')).toHaveAttribute('data-status', 'adopted');
    });

    test('an adoption with no other candidates: no offer sheet, the wizard closes as before', async ({ page }) => {
        test.setTimeout(180_000);
        await registerAdoption(page, SOLO_A, SOLO);
        // The wizard closes only after the sheet would have: closing untouched means no sheet was shown.
        await expect(page.getByTestId('wizard-close')).toHaveCount(0, { timeout: 60_000 });
        await expect(page.getByTestId('offer-sheet')).toHaveCount(0);
        await expect(page.locator(`[id="adoption-${SOLO.id}"]`)).toBeVisible({ timeout: 60_000 });
        expect(rows(`SELECT adopter_id FROM adoptions WHERE id = '${SOLO.id}'`)[0]?.adopter_id).toBe(SOLO_A.adopter);
        expect(applicationRow(SOLO_A.app).state).toBe('adopted');
    });

    for (const [mode, f] of Object.entries(FAILS)) {
        test(`the offer can't be read (${mode}): the sheet shows the error with an errorId; closing it completes the save`, async ({ page }) => {
            test.setTimeout(180_000);
            // getAdoptionOffer(animalId) is the only action posted with exactly these arguments.
            const offerArgs = JSON.stringify([f.animal.id]);
            let hits = 0;
            await page.route('**/*', async (route: Route) => {
                const req = route.request();
                if (req.method() !== 'POST' || !req.headers()['next-action'] || req.postData()?.trim() !== offerArgs) return route.fallback();
                hits++;
                // refused: the real action answers { ok: false } (no such animal); network: the call itself fails.
                if (mode === 'refused') return route.continue({ postData: JSON.stringify([F('missing')]) });
                return route.abort('failed');
            });
            await registerAdoption(page, f.a, f.animal);

            const sheet = page.getByTestId('offer-sheet');
            await expect(sheet.getByTestId('offer-failed')).toBeVisible({ timeout: 60_000 });
            expect(hits).toBeGreaterThan(0);
            // The code a person can quote: 8 characters, in parentheses after the message.
            await expect(sheet.getByTestId('offer-failed')).toHaveText(/\(.+: [A-Za-z0-9]{8}\)$/);
            await expect(page.getByTestId('wizard-close')).toBeVisible();
            await sheet.getByTestId('offer-sheet-close').click();
            await expect(sheet).toHaveCount(0, { timeout: 30_000 });
            await expect(page.getByTestId('wizard-close')).toHaveCount(0, { timeout: 60_000 });
            await expect(page.locator(`[id="adoption-${f.animal.id}"]`)).toBeVisible({ timeout: 60_000 });
            // The adoption was saved and B closed; the offer is still pending (it can be done later).
            expect(rows(`SELECT adopter_id FROM adoptions WHERE id = '${f.animal.id}'`)[0]?.adopter_id).toBe(f.a.adopter);
            const b = applicationRow(f.b.app);
            expect(b.state).toBe('closed');
            expect(isDbNull(b.offer_done_at)).toBe(true);
        });
    }

    test('a fostered animal: its applicant gets «Enviar contrato» and the token page loads (200)', async ({ page, request }) => {
        test.setTimeout(180_000);
        const panel = await openPanelAt(page, FOSTERED.id, FOSTERED_A.app, FOSTERED_A.name);
        await expect(panel.getByTestId('evaluate-send-contract')).toBeVisible();
        const token = await sendContract(page, panel);
        const res = await request.get(`/api/contract/by-token/${token}`);
        expect(res.status(), await res.text()).toBe(200);
    });

    test('a form for an adopted animal is a general form in «Mis adoptantes» with «Pidió a … (ya adoptada)»', async ({ page, request }) => {
        test.setTimeout(180_000);
        const name = `Pide Adoptada ${stamp}`;
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, {
            data: { name, email: `ev-late-${stamp}@example.com`, phone: `+54911${String(stamp).slice(-8)}`, intent: 'self', species: 'cat', animalId: ADOPTED.id },
        });
        const body = await res.text();
        expect(res.ok(), body).toBeTruthy();
        const { submissionId } = JSON.parse(body) as { submissionId: string };
        submitted.push(submissionId);

        // A general application that remembers the animal asked for.
        const app = applicationRow(`app-${submissionId}`);
        expect(isDbNull(app.animal_id)).toBe(true);
        expect(app.asked_animal_id).toBe(ADOPTED.id);
        expect(app.state).toBe('open');

        await page.goto(`/my-adopters?solicitud=app-${submissionId}#pendientes`);
        await dismissCountryBanner(page);
        const panel = page.getByTestId('request-panel');
        await expect(panel.locator('#applicant-panel-title')).toContainText(name, { timeout: 60_000 });
        await expect(panel.getByTestId('applicant-asked-animal')).toHaveText(
            new RegExp(`^(Pidió a|Asked for|Pediu) ${ADOPTED.name} \\((ya adoptada|already adopted|já adotada)\\)$`));
        await expect(panel.getByTestId('evaluate-propose')).toBeVisible();
        // «← Volver»: back on «Mis adoptantes», where it waits under «Formularios generales».
        await panel.getByTestId('applicant-panel-back').click();
        await expect(page.getByTestId('general-request-row').filter({ hasText: name })).toBeVisible({ timeout: 60_000 });
    });
});
