import { test, expect, type APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * "Es la misma persona" on /form-results — the flow that looked broken:
 * the rescuer linked a form to an existing profile, landed on that profile,
 * came Back, and saw the page exactly as before. Two causes, both covered:
 *
 *  1. Every submission auto-creates a profile and links the form to it, so the
 *     page already said "linked" before the rescuer decided anything, and said
 *     the same afterwards. It now tells the states apart (src/domain/formLink.ts).
 *  2. The link never revalidated, so Back replayed the pre-link page from the
 *     client Router Cache.
 *
 * Also proves linking no longer leaves the auto-created profile behind as a
 * duplicate — it is folded into the chosen one, like contracts.
 *
 * Runs under `authed`: the admin session owns forms sent to ADMIN_USER_ID.
 * Own rows only (unique email/phone per run), never seed adopters.
 */

const ADMIN_USER_ID = 'test-admin-id';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}

/** Throws on a failed query, so a broken read can't pass an assertion by returning nothing. */
function rows(sql: string): Array<Record<string, unknown>> {
    const wrapped = JSON.parse(execD1(sql));
    const results = (Array.isArray(wrapped) ? wrapped[0] : wrapped)?.results;
    if (!Array.isArray(results)) throw new Error(`D1 query returned no result set: ${sql}`);
    return results;
}

/** Exactly one row, or the test fails here — not later on an `undefined`. */
function one(sql: string): Record<string, unknown> {
    const r = rows(sql);
    expect(r, sql).toHaveLength(1);
    return r[0];
}

/** wrangler --json prints SQL NULL as the string "null". */
const isNull = (v: unknown) => v === null || v === 'null';

async function submitForm(request: APIRequestContext, data: { name: string; email: string; phone: string }): Promise<string> {
    const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, {
        data: { ...data, address: '1 E2E Link St', intent: 'self' },
    });
    const body = await res.text();
    expect(res.ok(), `submit failed: ${body}`).toBeTruthy();
    const { submissionId } = JSON.parse(body);
    expect(submissionId).toBeTruthy();
    return submissionId as string;
}

test.describe('form-results: linking to an existing profile', () => {
    test('shows which profile it was linked to — including after coming Back — and leaves no duplicate', async ({ page, request }) => {
        test.setTimeout(120_000);
        const stamp = Date.now();
        const email = `e2e-formlink-${stamp}@example.com`;
        const phone = `11${String(stamp).slice(-8)}`;
        const existingName = `E2E Formlink Original ${stamp}`;

        // The same person applies twice. The first application's auto-created
        // profile is the "existing" one the second must be linked to.
        const firstId = await submitForm(request, { name: existingName, email, phone });
        const secondId = await submitForm(request, { name: `E2E Formlink Again ${stamp}`, email, phone });

        const first = one(`SELECT auto_adopter_id FROM form_submissions WHERE id = '${firstId}'`);
        const second = one(`SELECT auto_adopter_id, linked_adopter_id FROM form_submissions WHERE id = '${secondId}'`);
        expect(isNull(first.auto_adopter_id), 'submit records the auto-created profile').toBe(false);
        expect(isNull(second.auto_adopter_id)).toBe(false);
        const existingId = String(first.auto_adopter_id);
        const orphanId = String(second.auto_adopter_id);
        expect(second.linked_adopter_id).toBe(orphanId);

        // Give the existing person a history worth reading: one 4-star
        // adoption (own fixture rows, never a seed adopter).
        execD1(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('test-formlink-fixture-animal-${stamp}', 'E2E Fixture Pet', 'dog', 'test-seed', strftime('%s','now'), strftime('%s','now'))`);
        execD1(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, ended_at, status, rating, recorded_by) VALUES ('test-formlink-fixture-placement-${stamp}', 'test-formlink-fixture-animal-${stamp}', '${existingId}', 'adoption', strftime('%s','now','-10 days'), NULL, 'completed', 4, 'test-seed')`);

        // Before deciding: the page asks, instead of claiming "linked".
        await page.goto(`/form-results/${secondId}`);
        await dismissCountryBanner(page);
        const banner = page.getByTestId('form-status-banner');
        await expect(banner).toHaveAttribute('data-state', 'review_matches', { timeout: 30_000 });

        const card = page.locator('article').filter({ hasText: existingName });
        await card.getByRole('button', { name: /^(Same person|Es la misma persona|É a mesma pessoa)$/ }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText(existingName);
        await dialog.getByRole('button', { name: /Yes, same person|Sí, es la misma persona|Sim, é a mesma pessoa/ }).click();

        await expect(page).toHaveURL(new RegExp(`/adopter/${existingId}`), { timeout: 30_000 });

        // The reported bug: Back must show the link, not the pre-link page.
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/form-results/${secondId}`));
        await expect(banner).toHaveAttribute('data-state', 'linked_existing', { timeout: 30_000 });
        await expect(banner).toContainText(existingName);
        // …and how that person is rated — the trust signal the rescuer is here for.
        await expect(banner).toContainText(/Good|Bueno|Bom/);
        await expect(banner.getByRole('link', { name: /^(View profile|Ver perfil)/ })).toHaveAttribute('href', `/adopter/${existingId}`);
        // The seeded admin can get the T&C modal mid-test; it covers the page.
        await dismissCountryBanner(page);

        // The matches fold away once decided; opened, the chosen one is marked
        // and nothing offers to link again.
        await page.getByRole('button', { name: /Matching profiles|Perfiles coincidentes|Perfis coincidentes/ }).click();
        await expect(card.getByText(/^(Linked profile|Perfil vinculado)$/)).toBeVisible();
        await expect(page.getByRole('button', { name: /^(Same person|Es la misma persona|É a mesma pessoa)$/ })).toHaveCount(0);

        // Data: form on the existing profile, auto-created one folded in (no
        // duplicate left), the request in the existing profile's history.
        const after = one(`SELECT linked_adopter_id, auto_adopter_id, status FROM form_submissions WHERE id = '${secondId}'`);
        expect(after.linked_adopter_id).toBe(existingId);
        expect(after.auto_adopter_id, 'auto_adopter_id is history, never re-pointed').toBe(orphanId);
        expect(after.status, 'the link claim is released').toBe('linked');
        const orphan = one(`SELECT deleted_at FROM adopters WHERE id = '${orphanId}'`);
        expect(isNull(orphan.deleted_at), 'the auto-created profile is merged away').toBe(false);
        const requests = rows(`SELECT id FROM adoptions WHERE adopter_id = '${existingId}' AND source_url = 'form:${secondId}'`);
        expect(requests).toHaveLength(1);
    });

    test('the shared location is a map you open — nothing is fetched until you do', async ({ page, request }) => {
        const stamp = Date.now();
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, {
            data: {
                name: `E2E Formlink Map ${stamp}`, email: `e2e-formlink-map-${stamp}@example.com`, phone: `14${String(stamp).slice(-8)}`,
                address: '1 E2E Map St', intent: 'self', latitude: '-34.5185839099628', longitude: '-58.4854964873305',
            },
        });
        expect(res.ok()).toBeTruthy();
        const { submissionId } = await res.json();

        const cspViolations: string[] = [];
        page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
        const mapRequests: string[] = [];
        page.on('request', (r) => { if (r.url().includes('openstreetmap.org')) mapRequests.push(r.url()); });

        await page.goto(`/form-results/${submissionId}`);
        await dismissCountryBanner(page);
        const toggle = page.getByRole('button', { name: /Ubicación verificada|Verified location|Localização verificada/ });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('iframe[src*="openstreetmap.org"]')).toHaveCount(0);
        // The raw coordinates are no longer printed on the page.
        await expect(page.getByText('-34.5185839099628')).toHaveCount(0);
        expect(mapRequests, 'closed map fetches nothing').toEqual([]);

        await toggle.click();
        const map = page.locator('iframe[src*="openstreetmap.org/export/embed.html"]');
        await expect(map).toBeVisible();
        expect(await map.getAttribute('src')).toContain('marker=-34.5185839099628%2C-58.4854964873305');
        await expect(page.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', /google\.com\/maps\/search\/\?api=1&query=-34\.5185839099628%2C-58\.4854964873305/);
        await page.waitForTimeout(1500);
        expect(cspViolations, 'frame-src allows the OSM embed').toEqual([]);
    });

    test('the semáforo marks a gift and an unprotected space red, children amber', async ({ page, request }) => {
        const stamp = Date.now();
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, {
            data: {
                name: `E2E Semaforo ${stamp}`, email: `e2e-semaforo-${stamp}@example.com`, phone: `19${String(stamp).slice(-8)}`,
                address: '1 E2E Light St', intent: 'gift', children: '2', hasOutdoor: 'yes', isSafe: 'no', housingType: 'house',
            },
        });
        expect(res.ok()).toBeTruthy();
        const { submissionId } = await res.json();

        await page.goto(`/form-results/${submissionId}`);
        await dismissCountryBanner(page);
        const answers = page.getByRole('button', { name: /Complete answers|Respuestas completas|Respostas completas/ });
        if ((await answers.getAttribute('aria-expanded')) === 'false') await answers.click();

        const dot = (label: RegExp, signal: string) =>
            page.locator('div.flex.items-baseline', { hasText: label }).locator(`[data-signal="${signal}"]`);
        await expect(dot(/Children in household|Niños en el hogar|Crianças/, 'caution')).toBeVisible();
        await expect(dot(/Protected spaces|Secure spaces|Espacios protegidos|Espaços protegidos/, 'risk')).toBeVisible();
        await expect(dot(/Intent|Intención|Intenção/, 'risk')).toBeVisible();
        // Colour is never the only signal: each dot is labelled.
        await expect(dot(/Intent|Intención|Intenção/, 'risk')).toHaveAttribute('aria-label', /Attention|Atención|Atenção/);
        // Questions outside the semáforo get no dot.
        await expect(page.locator('div.flex.items-baseline', { hasText: /Home type|Tipo de vivienda|Tipo de moradia/ }).locator('[data-signal]')).toHaveCount(0);
    });

    test('household people: only the fully named one reaches the profile, children is recomputed, the request is recorded at submit', async ({ request }) => {
        const stamp = Date.now();
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, { data: {
            name: `E2E Hogar ${stamp}`, email: `e2e-hogar-${stamp}@example.com`, phone: `22${String(stamp).slice(-8)}`,
            address: '1 Hogar St', intent: 'self', housingType: 'house',
            householdPeople: [
                { relationship: 'child', age: 3, firstName: 'Tomás', lastName: 'López' },
                { relationship: 'child', age: 11 },
                { relationship: 'partner', age: 38, firstName: 'Laura' },
                { relationship: 'boss', age: 50, firstName: 'Bad', lastName: 'Row' },
            ],
            livesAlone: false, children: 'none', // a lying count — the server recomputes it
        } });
        expect(res.ok(), await res.text()).toBeTruthy();
        const { submissionId } = await res.json();

        const row = one(`SELECT auto_adopter_id, answers_json FROM form_submissions WHERE id = '${submissionId}'`);
        const answers = JSON.parse(String(row.answers_json));
        expect(answers.children).toBe('2');
        expect(answers.householdPeople).toHaveLength(3); // the unknown relationship is dropped

        const prof = one(`SELECT household_members FROM adopters WHERE id = '${row.auto_adopter_id}'`);
        const members = JSON.parse(String(prof.household_members));
        expect(members.map((m: { name: string }) => m.name)).toEqual(['Tomás López']);
        expect(members[0]).toMatchObject({ relationship: 'child', age: 3, addedBy: 'form-submission' });
        expect(members[0].ageAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        // Every form is linked from its profile: the request exists from submit time.
        expect(rows(`SELECT id FROM adoptions WHERE adopter_id = '${row.auto_adopter_id}' AND source_url = 'form:${submissionId}'`)).toHaveLength(1);
    });

    test('household people: the form screen shows each person with a dot; the profile shows the age and links back', async ({ page, request }) => {
        const stamp = Date.now();
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, { data: {
            name: `E2E HogarUI ${stamp}`, email: `e2e-hogarui-${stamp}@example.com`, phone: `23${String(stamp).slice(-8)}`,
            address: '2 Hogar St', intent: 'self', housingType: 'house',
            householdPeople: [
                { relationship: 'child', age: 3, firstName: 'Tomás', lastName: 'López' },
                { relationship: 'child', age: 11 },
                { relationship: 'partner', age: 38, firstName: 'Laura' },
            ],
            livesAlone: false,
        } });
        expect(res.ok(), await res.text()).toBeTruthy();
        const { submissionId } = await res.json();
        const row = one(`SELECT auto_adopter_id FROM form_submissions WHERE id = '${submissionId}'`);

        await page.goto(`/form-results/${submissionId}`);
        await dismissCountryBanner(page);
        const answers = page.getByRole('button', { name: /Complete answers|Respuestas completas|Respostas completas/ });
        if ((await answers.getAttribute('aria-expanded')) === 'false') await answers.click();
        const people = page.getByTestId('household-people');
        await expect(people.locator('[data-signal="risk"]')).toHaveCount(1);    // 3
        await expect(people.locator('[data-signal="caution"]')).toHaveCount(1); // 11
        await expect(people.locator('[data-signal="ok"]')).toHaveCount(1);      // 38
        await expect(people).toContainText('Tomás López');
        // The derived count is not shown twice next to the list.
        await expect(page.locator('div.flex.items-baseline', { hasText: /Children in household|Niños en el hogar/ })).toHaveCount(0);

        await page.goto(`/adopter/${row.auto_adopter_id}`);
        await dismissCountryBanner(page);
        await expect(page.getByText('Tomás López').first()).toBeVisible();
        await expect(page.getByText(/3 years old|3 años|3 anos/).first()).toBeVisible();
        await expect(page.locator(`a[href="/form-results/${submissionId}"]`).first()).toBeVisible();
    });

    test("gift: only the fully named recipient reaches the giver's profile; the recipient's housemates stay on the form", async ({ request }) => {
        const stamp = Date.now();
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, { data: {
            name: `E2E Regalo ${stamp}`, email: `e2e-regalo-${stamp}@example.com`, phone: `25${String(stamp).slice(-8)}`, address: '1 Gift St',
            intent: 'gift', giftRecipient: { relationship: 'child', firstName: 'Laura', lastName: 'Pérez', phone: '11 5555 1234' },
            householdPeople: [{ relationship: 'partner', age: 30, firstName: 'Marcos', lastName: 'Gómez' }], livesAlone: false,
        } });
        expect(res.ok(), await res.text()).toBeTruthy();
        const { submissionId } = await res.json();
        const row = one(`SELECT auto_adopter_id, answers_json FROM form_submissions WHERE id = '${submissionId}'`);
        expect(JSON.parse(String(row.answers_json)).giftRecipient).toMatchObject({ firstName: 'Laura', lastName: 'Pérez' });
        const members = JSON.parse(String(one(`SELECT household_members FROM adopters WHERE id = '${row.auto_adopter_id}'`).household_members));
        expect(members.map((m: { name: string }) => m.name)).toEqual(['Laura Pérez']);
        expect(members[0]).toMatchObject({ relationship: 'child', giftRecipient: true });
        expect(JSON.stringify(members[0].contactEntries)).toContain('11 5555 1234');
    });

    test('gift with a first-name-only recipient: nothing on the profile', async ({ request }) => {
        const stamp = Date.now();
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, { data: {
            name: `E2E Regalo2 ${stamp}`, email: `e2e-regalo2-${stamp}@example.com`, phone: `26${String(stamp).slice(-8)}`, address: '2 Gift St',
            intent: 'gift', giftRecipient: { relationship: 'sibling', firstName: 'Ana' },
        } });
        expect(res.ok(), await res.text()).toBeTruthy();
        const { submissionId } = await res.json();
        const row = one(`SELECT auto_adopter_id, answers_json FROM form_submissions WHERE id = '${submissionId}'`);
        expect(JSON.parse(String(row.answers_json)).giftRecipient).toMatchObject({ firstName: 'Ana' });
        const prof = one(`SELECT household_members FROM adopters WHERE id = '${row.auto_adopter_id}'`);
        expect(isNull(prof.household_members) || JSON.parse(String(prof.household_members)).length === 0).toBe(true);
    });

    test('a fresh submission with no look-alikes reads as a new profile, not as "linked"', async ({ page, request }) => {
        const stamp = Date.now();
        const name = `E2E Formlink Solo ${stamp}`;
        const id = await submitForm(request, { name, email: `e2e-formlink-solo-${stamp}@example.com`, phone: `12${String(stamp).slice(-8)}` });

        await page.goto(`/form-results/${id}`);
        const banner = page.getByTestId('form-status-banner');
        await expect(banner).toHaveAttribute('data-state', 'new_profile', { timeout: 30_000 });
        await expect(banner).toContainText(name);
        await expect(banner.getByRole('link', { name: /View new profile|Ver perfil nuevo|Ver perfil novo/ })).toBeVisible();
    });
});
