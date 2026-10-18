import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Third-party API v1, part 2 (split from public-api.authed.spec.ts on
 * 2026-10-17: the whole flow no longer fits one dev server in CI). The admin
 * pages, the documented scenarios (example people + replay), /developers and
 * the docs page — with its own key, in its own CI leg (@leg-apidocs).
 *
 * ENABLE_PUBLIC_API is off in the seed; this file and public-api.authed.spec.ts
 * turn it on for themselves (each serial, each in its own CI leg).
 */
function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const flagOn = () => execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PUBLIC_API', 'true', strftime('%s','now'), 'e2e')`);
const flagOff = () => execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PUBLIC_API'`);

const STAMP = String(Date.now());
const TAG = STAMP.split('').map(d => 'abcdefghij'[Number(d)]).join('');
const ADMIN_EMAIL = 'gatitosolivos@gmail.com';

test.describe.configure({ mode: 'serial' });

test.describe('public API v1 — admin, docs, /developers', { tag: '@leg-apidocs' }, () => {
    let secret = '';
    let keyId = '';
    let api: APIRequestContext;

    test.beforeAll(async ({ baseURL }) => {
        flagOn();
        api = await pwRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    });
    test.afterAll(async () => {
        flagOff();
        await api?.dispose();
    });

    const auth = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${secret}`, ...extra });

    test('admin issues a key; the secret is shown once and works for /me', async ({ page }) => {
        const res = await page.request.post('/api/admin/api-keys', { data: { ownerEmail: ADMIN_EMAIL, name: `E2E ${TAG}` } });
        expect(res.status()).toBe(201);
        const issued = await res.json();
        expect(issued.secret).toMatch(/^ba_test_[A-Za-z0-9]{43}$/);
        secret = issued.secret;
        keyId = issued.id;

        const none = await api.get('/api/v1/me');
        expect(none.status()).toBe(401);
        expect((await none.json()).error.message).toMatch(/no API key/);
        const unknown = await api.get('/api/v1/me', { headers: { authorization: 'Bearer ba_test_notarealkeynotarealkeynotarealkey12345' } });
        expect(unknown.status()).toBe(401);
        expect((await unknown.json()).error.message).toBe('unknown or revoked API key');
        // A production key here (off production) is named as such.
        expect((await (await api.get('/api/v1/me', { headers: { authorization: 'Bearer ba_live_notarealkeynotarealkeynotarealkey12345' } })).json()).error.message).toMatch(/production key/);
        const me = await api.get('/api/v1/me', { headers: auth() });
        expect(me.status()).toBe(200);
        const body = await me.json();
        expect(body.rescuer.email).toBe(ADMIN_EMAIL);
        expect(body.key.scopes).toEqual(['search', 'search:fuzzy', 'record:write']);
        expect(me.headers()['x-request-id']).toBe(body.requestId);
    });

    test('the documented scenarios: with the demo people loaded, every documented call returns its documented answer', async ({ page, baseURL }) => {
        const seeded = await page.request.post('/api/admin/api-demo');
        expect(seeded.status()).toBe(200);
        expect((await seeded.json()).profiles).toBeGreaterThan(10);
        // Loading twice resets, never duplicates.
        expect((await page.request.post('/api/admin/api-demo')).status()).toBe(200);
        // What the docs page serves: built with THIS environment's alert thresholds; off production every call is a dry run.
        const spec = await (await api.get('/api/v1/openapi.json')).json();
        const op = spec.paths['/api/v1/search'].post;
        const requests = op.requestBody.content['application/json'].examples as Record<string, { value: Record<string, unknown> }>;
        const answers = op.responses['200'].content['application/json'].examples as Record<string, { value: Record<string, unknown> }>;
        const keys = Object.keys(answers).filter(k => k.startsWith('scenario_'));
        expect(keys.length).toBeGreaterThanOrEqual(11);
        for (const key of keys) {
            const res = await api.post('/api/v1/search', { data: requests[key].value, headers: auth({ 'x-dry-run': '1' }) });
            expect(res.status(), key).toBe(200);
            const got = await res.json();
            expect({ ...got, requestId: 'x' }, key).toEqual({ ...answers[key].value, requestId: 'x' });
        }
        void baseURL;
    });

    test('admin: «Regenerar» shows a new secret once; the old one stops working, the key keeps its history', async ({ page }) => {
        const oldSecret = secret;
        expect((await api.get('/api/v1/me', { headers: auth() })).status()).toBe(200);
        await page.goto('/admin/api');
        const row = page.getByTestId('api-keys').locator('li').filter({ hasText: `E2E ${TAG}` });
        await row.getByRole('button', { name: /^(Regenerar|Regenerate)$/ }).click();
        await row.getByRole('button', { name: /Sí, regenerar|Yes, regenerate|Sim, regenerar/ }).click();
        const box = page.getByTestId('api-new-secret');
        await expect(box).toContainText(/Clave nueva|New key|Chave nova/, { timeout: 30000 });
        const fresh = (await box.locator('code').textContent())?.trim() ?? '';
        expect(fresh).toMatch(/^ba_test_[A-Za-z0-9]{43}$/);
        expect(fresh).not.toBe(oldSecret);

        expect((await api.get('/api/v1/me', { headers: { authorization: `Bearer ${oldSecret}` } })).status()).toBe(401);
        secret = fresh;
        const me = await api.get('/api/v1/me', { headers: auth() });
        expect(me.status()).toBe(200);
        // Same key row: its transactions are still listed under it.
        const tx = await page.request.get(`/api/admin/api-requests?keyId=${keyId}`);
        expect(((await tx.json()).rows as unknown[]).length).toBeGreaterThan(5);
    });

    test('admin: the rescuer email suggests matching users; picking one fills the field', async ({ page }) => {
        await page.goto('/admin/api');
        const email = page.getByTestId('api-owner-email');
        await email.fill('gatitos');
        const options = page.getByTestId('api-owner-options');
        await expect(options).toContainText(ADMIN_EMAIL, { timeout: 30000 });
        await options.getByRole('button').filter({ hasText: ADMIN_EMAIL }).first().click();
        await expect(email).toHaveValue(ADMIN_EMAIL);
        // The key name says what it is for.
        await expect(page.locator('#api-key-name-hint')).toBeVisible();
    });

    test('/developers: sign in, accept the terms, create your own key (shown once), use it, revoke it', async ({ page, browser, baseURL }) => {
        // Signed out: the page explains and asks to sign in.
        const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const anonPage = await anon.newPage();
        await anonPage.goto(`${baseURL}/developers`);
        await expect(anonPage.getByTestId('developers-sign-in')).toBeVisible({ timeout: 30000 });
        await anon.close();

        // A clean slate for this account, so a rerun behaves like the first run.
        execD1(`DELETE FROM api_terms_acceptances WHERE user_email = '${ADMIN_EMAIL}'`);
        execD1(`UPDATE api_keys SET revoked_at = strftime('%s','now') WHERE owner_email = '${ADMIN_EMAIL}' AND created_by = owner_email AND revoked_at IS NULL`);
        await page.goto('/developers');
        await expect(page.getByTestId('developers-page')).toBeVisible({ timeout: 30000 });
        // The page loads the person's keys and usage first (slow on CI's dev server).
        await expect(page.getByTestId('developers-env')).toContainText(/staging/, { timeout: 30000 });
        // No key before the terms.
        expect((await page.request.post('/api/my-api/keys', { data: { name: 'x' } })).status()).toBe(403);
        await page.getByTestId('developers-terms-check').check({ timeout: 30000 });
        await page.getByTestId('developers-terms-accept').click();
        await page.getByTestId('developers-key-name').fill(`Mi formulario ${TAG}`, { timeout: 30000 });
        await page.getByTestId('developers-create').click();
        const shown = (await page.getByTestId('developers-secret-value').textContent({ timeout: 30000 }))!.trim();
        expect(shown).toMatch(/^ba_test_/);
        // It works, with the self-service limits.
        const me = await (await api.get('/api/v1/me', { headers: { authorization: `Bearer ${shown}` } })).json();
        expect(me.caps).toEqual({ exact: 100, fuzzy: 50 });
        // Shown once: after a reload only the prefix is there.
        await page.reload();
        await expect(page.getByTestId('developers-key').filter({ hasText: `Mi formulario ${TAG}` })).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('developers-secret')).toHaveCount(0);
        // Revoke from the page: it stops working.
        await page.getByTestId('developers-key').filter({ hasText: `Mi formulario ${TAG}` }).getByTestId('developers-revoke').click();
        await page.getByTestId('developers-confirm').click();
        await expect(page.getByTestId('developers-key').filter({ hasText: `Mi formulario ${TAG}` })).toContainText(/Revocada|Revoked|Revogada/, { timeout: 30000 });
        expect((await api.get('/api/v1/me', { headers: { authorization: `Bearer ${shown}` } })).status()).toBe(401);
    });

    test('docs and spec are served; a revoked key stops working', async ({ page }) => {
        const spec = await api.get('/api/v1/openapi.json');
        expect((await spec.json()).paths['/api/v1/search']).toBeTruthy();
        const docs = await api.get('/api/v1/docs');
        expect(docs.headers()['content-type']).toContain('text/html');
        expect(docs.headers()['content-security-policy']).toContain("connect-src 'self'");
        // The pinned, integrity-checked explorer actually renders under that CSP.
        await page.goto('/api/v1/docs');
        await expect(page.getByText('BuenAdoptante API').first()).toBeVisible({ timeout: 30000 });

        await page.request.patch(`/api/admin/api-keys/${keyId}`, { data: { revoke: true } });
        expect((await api.get('/api/v1/me', { headers: auth() })).status()).toBe(401);
    });

    test('flag off → every endpoint answers 404 api_disabled', async () => {
        flagOff();
        const res = await api.get('/api/v1/me', { headers: auth() });
        expect(res.status()).toBe(404);
        expect((await res.json()).error.code).toBe('api_disabled');
        flagOn();
    });
});
