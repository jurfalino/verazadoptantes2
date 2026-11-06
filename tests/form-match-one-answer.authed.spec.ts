import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1, isDbNull, rows } from './db';

/**
 * A form match is an ordinary possible-duplicate pair (spec
 * .agents/plans/2026-11-05-form-matches-are-duplicates.md): the form screen
 * shows the form profile's OPEN PAIRS, its «No es esta persona» answers the
 * pair for everyone, and an answer given anywhere else clears the form.
 *
 * The same person applies twice (unique email/phone per run): the second
 * form's auto-created profile pairs with the first's. Runs under `authed`
 * (the admin owns forms sent to ADMIN_USER_ID). Own rows only.
 */
const ADMIN_USER_ID = 'test-admin-id';
const ADMIN_EMAIL = 'gatitosolivos@gmail.com';
const USER_EMAIL = 'testuser@example.com';

async function submitForm(request: APIRequestContext, data: { name: string; email: string; phone: string }): Promise<string> {
    const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, { data: { ...data, address: '1 E2E One Answer St', intent: 'self' } });
    const body = await res.text();
    expect(res.ok(), `submit failed: ${body}`).toBeTruthy();
    return JSON.parse(body).submissionId as string;
}

/** Two applications from one person; returns the second form and both profiles. */
async function samePersonTwice(request: APIRequestContext, tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const email = `e2e-oneanswer-${tag}-${stamp}@example.com`;
    const phone = `11${stamp.slice(-8)}`;
    const firstName = `E2E One Answer First ${tag} ${stamp}`;
    const first = await submitForm(request, { name: firstName, email, phone });
    const second = await submitForm(request, { name: `E2E One Answer Again ${tag} ${stamp}`, email, phone });
    const existingId = String(rows(`SELECT auto_adopter_id AS id FROM form_submissions WHERE id = '${first}'`)[0].id);
    const formProfileId = String(rows(`SELECT auto_adopter_id AS id FROM form_submissions WHERE id = '${second}'`)[0].id);
    return { submissionId: second, existingId, formProfileId, firstName };
}

const pairSql = (a: string, b: string) =>
    `FROM duplicate_candidates WHERE (adopter1_id = '${a}' AND adopter2_id = '${b}') OR (adopter1_id = '${b}' AND adopter2_id = '${a}')`;

async function openForm(page: Page, submissionId: string) {
    await page.goto(`/form-results/${submissionId}`);
    await dismissCountryBanner(page);
    await expect(page.getByTestId('form-status-banner')).toBeVisible({ timeout: 30_000 });
}

test.describe('form match = one shared answer', () => {
    test('«No es esta persona» on the form is saved for the pair', async ({ page, request }) => {
        test.setTimeout(120_000);
        const f = await samePersonTwice(request, 'not-this');
        await openForm(page, f.submissionId);
        await expect(page.getByTestId('form-status-banner')).toHaveAttribute('data-state', 'review_matches');
        await page.getByTestId('form-match-not-this').first().click();
        await expect(page.getByTestId('form-status-banner')).toHaveAttribute('data-state', 'new_profile', { timeout: 30_000 });
        await page.reload();
        await expect(page.getByTestId('form-status-banner')).toHaveAttribute('data-state', 'new_profile', { timeout: 30_000 });
        expect(rows(`SELECT status ${pairSql(f.formProfileId, f.existingId)}`)[0]?.status).toBe('dismissed');
        // Someone DID match — answering «no» doesn't make "no previous records" true.
        await expect(page.getByTestId('form-status-banner')).not.toContainText(/found no previous records|No encontramos registros previos|Não encontramos registros anteriores/);
    });

    test('«Mantener separados» given elsewhere clears the form', async ({ page, request }) => {
        test.setTimeout(120_000);
        const f = await samePersonTwice(request, 'kept');
        execD1(`UPDATE duplicate_candidates SET status = 'dismissed', resolved_by = '${ADMIN_EMAIL}', resolved_at = strftime('%s','now') WHERE id IN (SELECT id ${pairSql(f.formProfileId, f.existingId)})`);
        await openForm(page, f.submissionId);
        await expect(page.getByTestId('form-status-banner')).toHaveAttribute('data-state', 'new_profile');
        await expect(page.locator('article').filter({ hasText: f.firstName })).toHaveCount(0);
    });

    test('answered elsewhere while the tab is open: «Es la misma persona» is refused, with an Error ID', async ({ page, request }) => {
        test.setTimeout(120_000);
        const f = await samePersonTwice(request, 'stale');
        await openForm(page, f.submissionId);
        const card = page.locator('article').filter({ hasText: f.firstName });
        await expect(card).toBeVisible();
        execD1(`UPDATE duplicate_candidates SET status = 'dismissed', resolved_by = '${ADMIN_EMAIL}', resolved_at = strftime('%s','now') WHERE id IN (SELECT id ${pairSql(f.formProfileId, f.existingId)})`);
        await card.getByRole('button', { name: /^(Same person|Es la misma persona|É a mesma pessoa)$/ }).click();
        await page.getByRole('dialog').getByRole('button', { name: /Yes, same person|Sí, es la misma persona|Sim, é a mesma pessoa/ }).click();
        await expect(page.getByText(/Error ID/).first()).toBeVisible({ timeout: 30_000 });
        // Nothing merged: both profiles still live.
        expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${f.formProfileId}'`)[0].deleted_at)).toBe(true);
    });

    test('a teammate answers too: «No es esta persona» is offered and saved (step 2, the team acts as one)', async ({ browser, request }) => {
        test.setTimeout(120_000);
        const f = await samePersonTwice(request, 'mate');
        const orgId = `test-oneanswer-org-${Date.now()}`;
        execD1(`INSERT INTO organizations (id, name, created_by) VALUES ('${orgId}', 'One Answer ${orgId}', '${ADMIN_EMAIL}')`);
        execD1(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('${orgId}-a', '${orgId}', '${ADMIN_EMAIL}', 'owner'), ('${orgId}-b', '${orgId}', '${USER_EMAIL}', 'member')`);
        const ctx = await browser.newContext({ storageState: '.auth/user.json' });
        try {
            const page = await ctx.newPage();
            await openForm(page, f.submissionId);
            const card = page.locator('article').filter({ hasText: f.firstName });
            await expect(card).toBeVisible();
            await card.getByTestId('form-match-not-this').click();
            await expect(card).toHaveCount(0, { timeout: 30_000 });
            expect(rows(`SELECT status, resolved_by ${pairSql(f.formProfileId, f.existingId)}`)[0]).toMatchObject({ status: 'dismissed', resolved_by: USER_EMAIL });
        } finally {
            await ctx.close();
            execD1(`DELETE FROM org_members WHERE org_id = '${orgId}'`);
            execD1(`DELETE FROM organizations WHERE id = '${orgId}'`);
        }
    });
});
