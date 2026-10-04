import { test, expect, type APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * The form-results match card must not show another rescuer's protected
 * profile raw. Before the fix, rescuer B could submit their own public form
 * with a name/phone that matched rescuer A's adopter and read A's full contact
 * and street on the «Perfil existente» card (and in the RSC payload).
 *
 * Rescuer A = the admin (owns forms sent to ADMIN_USER_ID); rescuer B = the
 * non-admin test user (in no org — never A's teammate). PII gating is switched
 * on for this spec, as it is in production (the e2e seed leaves it off).
 * Own rows only (unique values per run), never seed adopters.
 */

const ADMIN_USER_ID = 'test-admin-id';
const USER_ID = 'test-user-id';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}

function one(sql: string): Record<string, unknown> {
    const wrapped = JSON.parse(execD1(sql));
    const results = (Array.isArray(wrapped) ? wrapped[0] : wrapped)?.results;
    expect(results, sql).toHaveLength(1);
    return results[0];
}

async function submitForm(
    request: APIRequestContext,
    userId: string,
    data: { name: string; email: string; phone: string; address: string; animalId?: string },
): Promise<string> {
    const res = await request.post(`/api/form/${userId}/submit`, { data: { ...data, intent: 'self' } });
    const body = await res.text();
    expect(res.ok(), `submit failed: ${body}`).toBeTruthy();
    const { submissionId } = JSON.parse(body);
    expect(submissionId).toBeTruthy();
    return submissionId as string;
}

test.describe('form-results: match card masks another rescuer\'s protected profile', () => {
    test.beforeAll(() => {
        execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PII_ACCESS_GATING', 'true', strftime('%s','now'), 'e2e')`);
    });

    test.afterAll(() => {
        execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PII_ACCESS_GATING'`);
    });

    test('shows the phone B\'s applicant typed, never A\'s other email or street', async ({ browser, request }) => {
        test.setTimeout(120_000);
        const stamp = Date.now();
        const phone = `11${String(stamp).slice(-8)}`;
        const aEmail = `e2e-mask-private-${stamp}@example.com`;
        const aStreet = `Calle Secreta ${String(stamp).slice(-4)}`;
        const aName = `E2E Mask Titular ${stamp}`;

        // Rescuer A's adopter: auto-created (and tokenized) by A's own form.
        const aSubmission = await submitForm(request, ADMIN_USER_ID, {
            name: aName, email: aEmail, phone, address: `${aStreet}, Flores`,
        });
        const aId = String(one(`SELECT auto_adopter_id FROM form_submissions WHERE id = '${aSubmission}'`).auto_adopter_id);

        // Rescuer B's form: same phone, different email and street.
        const bSubmission = await submitForm(request, USER_ID, {
            name: `E2E Mask Otra ${stamp}`, email: `e2e-mask-b-${stamp}@example.com`, phone, address: '9 Otra Calle, Caballito',
        });

        const ctx = await browser.newContext({ storageState: '.auth/user.json' });
        const page = await ctx.newPage();
        await page.goto(`/form-results/${bSubmission}`);
        await dismissCountryBanner(page);

        const comparison = page.locator(`#comparison-${aId}`);
        await expect(comparison).toBeVisible({ timeout: 30_000 });
        const cardText = (await comparison.innerText()).replace(/\D/g, '');
        // The phone B's applicant typed: shown in full (they already know it).
        expect(cardText).toContain(phone);
        // A's other data: not on the card…
        await expect(comparison).not.toContainText(aEmail);
        await expect(comparison).not.toContainText('Secreta');
        // …and not anywhere in the page, RSC payload included.
        const html = await page.content();
        expect(html).not.toContain(aEmail);
        expect(html).not.toContain(aStreet);
        await ctx.close();
    });

    test('contract to an applicant whose profile is A\'s: pre-fills only what she typed, signing keeps A\'s data; a non-applicant token is refused', async ({ browser, request }) => {
        test.setTimeout(180_000);
        const stamp = Date.now();
        const phone = `12${String(stamp).slice(-8)}`;
        const aEmail = `e2e-invite-private-${stamp}@example.com`;
        const aStreet = `Calle Reservada ${String(stamp).slice(-4)}`;
        const aName = `E2E Invite Titular ${stamp}`;
        const bEmail = `e2e-invite-b-${stamp}@example.com`;
        const USER_EMAIL = 'testuser@example.com';
        const animalId = `test-invite-fixture-animal-${stamp}`;
        const otherAnimalId = `test-invite-fixture-animal-other-${stamp}`;
        for (const id of [animalId, otherAnimalId]) {
            execD1(`INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) VALUES ('${id}', 'E2E Invite Pet', 'cat', 'E2E fixture', '${USER_EMAIL}', strftime('%s','now'), strftime('%s','now'))`);
        }

        // A's adopter (admin's own form), then B's applicant for B's animal.
        const aSubmission = await submitForm(request, ADMIN_USER_ID, { name: aName, email: aEmail, phone, address: `${aStreet}, Flores` });
        const aId = String(one(`SELECT auto_adopter_id FROM form_submissions WHERE id = '${aSubmission}'`).auto_adopter_id);
        const bSubmission = await submitForm(request, USER_ID, {
            name: `E2E Invite Postulante ${stamp}`, email: bEmail, phone, address: '9 Otra Calle, Caballito', animalId,
        });

        // «Es la misma persona» on B's form-results: B's applicant becomes A's adopter.
        const ctx = await browser.newContext({ storageState: '.auth/user.json' });
        const page = await ctx.newPage();
        await page.goto(`/form-results/${bSubmission}`);
        await dismissCountryBanner(page);
        const card = page.locator('article').filter({ has: page.locator(`#comparison-${aId}`) });
        await card.getByRole('button', { name: /^(Same person|Es la misma persona|É a mesma pessoa)$/ }).click();
        await page.getByRole('dialog').getByRole('button', { name: /Yes, same person|Sí, es la misma persona|Sim, é a mesma pessoa/ }).click();
        await expect(page).toHaveURL(new RegExp(`/adopter/${aId}`), { timeout: 30_000 });
        await ctx.close();
        expect(one(`SELECT linked_adopter_id FROM form_submissions WHERE id = '${bSubmission}'`).linked_adopter_id).toBe(aId);

        // Invitations as B would issue them (the action is UI-only): one for the
        // applicant, one for A's adopter on an animal she never applied for.
        const token = `test-invite-token-${stamp}`;
        const strayToken = `test-invite-token-stray-${stamp}`;
        execD1(`INSERT INTO contract_invitations (token, animal_id, adopter_id, created_by, created_at, used_at, expires_at) VALUES ('${token}', '${animalId}', '${aId}', '${USER_EMAIL}', strftime('%s','now'), NULL, strftime('%s','now','+1 day'))`);
        execD1(`INSERT INTO contract_invitations (token, animal_id, adopter_id, created_by, created_at, used_at, expires_at) VALUES ('${strayToken}', '${otherAnimalId}', '${aId}', '${USER_EMAIL}', strftime('%s','now'), NULL, strftime('%s','now','+1 day'))`);

        const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const stray = await anon.request.get(`/api/contract/by-token/${strayToken}`);
        expect(stray.status()).toBe(410);
        const strayBody = await stray.text();
        expect(strayBody).toContain('not_allowed');
        expect(strayBody).not.toContain(aEmail);

        const res = await anon.request.get(`/api/contract/by-token/${token}`);
        const raw = await res.text();
        expect(res.ok(), raw).toBeTruthy();
        expect(raw).not.toContain(aEmail);
        expect(raw).not.toContain('Reservada');
        const { prefill } = JSON.parse(raw);
        expect(String(prefill.phone).replace(/\D/g, '')).toContain(phone);
        // The merge carried her typed email onto A's profile — that one she knows.
        expect(prefill.email).toBe(bEmail);
        // Addresses never pre-fill from a profile she can't fully see.
        expect(prefill.address).toBe('');

        // Signing adds what was signed and keeps everything A had.
        const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        const sign = await anon.request.post(`/api/contract/${animalId}/submit`, {
            data: { name: 'Otra', lastName: 'Firmante', email: bEmail, phone, address: '9 Otra Calle, Caballito', dni: '', socialNetworks: '', token, screenshot: TINY_PNG },
        });
        expect(sign.ok(), await sign.text()).toBeTruthy();
        await anon.close();
        const after = one(`SELECT name, contact_entries, address_info FROM adopters WHERE id = '${aId}'`);
        expect(after.name).toBe(aName);
        expect(String(after.contact_entries)).toContain(aEmail);
        expect(String(after.contact_entries)).toContain(bEmail);
        expect(String(after.address_info)).toContain('Reservada');
    });

    test('the public form refuses a malformed email', async ({ request }) => {
        const res = await request.post(`/api/form/${USER_ID}/submit`, {
            data: { name: `E2E Mask Bad Email ${Date.now()}`, email: 'x', phone: '1100000000', address: '1 Calle', intent: 'self' },
        });
        expect(res.status()).toBe(400);
    });
});
