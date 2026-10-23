import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Third-party API v1, part 3 (split from public-api-docs.authed.spec.ts on
 * 2026-10-18: with the approval flow, that leg's dev server restarted on memory
 * and the admin pages' requests failed). /developers — self-service keys and
 * access by admin approval — in its own CI leg (@leg-apidev).
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

test.describe('public API v1 — /developers and access approval', { tag: '@leg-apidev' }, () => {
    let api: APIRequestContext;

    test.beforeAll(async ({ baseURL }) => {
        flagOn();
        api = await pwRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    });
    test.afterAll(async () => {
        flagOff();
        await api?.dispose();
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

    test('API keys before approval: a key at once at 25/10 (shared by all own keys) → admin approves → 100/50 → deny keeps 25/10 → block revokes', async ({ page, browser }) => {
        const USER = 'testuser@example.com';
        // A clean slate for the regular test user, so a rerun behaves like the first run.
        execD1(`DELETE FROM api_access WHERE user_email = '${USER}'`);
        execD1(`DELETE FROM api_terms_acceptances WHERE user_email = '${USER}'`);
        execD1(`UPDATE api_keys SET revoked_at = strftime('%s','now') WHERE owner_email = '${USER}' AND revoked_at IS NULL`);
        execD1(`DELETE FROM api_keys WHERE owner_email = '${USER}' AND created_by = owner_email`);
        // Compile the admin routes this test opens first: on CI's dev server (often just restarted
        // on memory) a first compile alone can outlast an assertion's 30 s.
        await Promise.all([
            page.request.get('/api/admin/api-overview'),
            page.request.get('/api/admin/api-people?status=requested'),
            page.request.get(`/api/admin/api-people/${encodeURIComponent(USER)}`),
        ]);
        const ctx = await browser.newContext({ storageState: '.auth/user.json' });
        const user = await ctx.newPage();
        const me = async (secretOf: string) => (await (await api.get('/api/v1/me', { headers: { authorization: `Bearer ${secretOf}` } })).json()) as { caps: { exact: number; fuzzy: number } };
        try {
            // Terms first; then the key works at once, at the starting limits, and files the request.
            expect((await user.request.post('/api/my-api/keys', { data: { name: 'x' } })).status()).toBe(403);
            expect((await user.request.post('/api/my-api/terms')).status()).toBe(200);
            await user.goto('/developers');
            await user.getByTestId('developers-key-name').fill(`Formulario ${TAG}`, { timeout: 30000 });
            await user.getByTestId('developers-key-purpose').fill('Revisar adoptantes antes de entregar');
            await user.getByTestId('developers-create').click();
            const firstSecret = (await user.getByTestId('developers-secret-value').textContent({ timeout: 30000 }))!.trim();
            await expect(user.getByTestId('developers-secret-limited')).toBeVisible();
            expect((await me(firstSecret)).caps).toEqual({ exact: 25, fuzzy: 10 });
            await user.reload();
            await expect(user.getByTestId('developers-access-pending')).toBeVisible({ timeout: 30000 });
            const mine = (await (await user.request.get('/api/my-api/keys')).json()) as { keys: Array<{ id: string; name: string }> };
            const a = { id: mine.keys.find(k => k.name === `Formulario ${TAG}`)!.id, secret: firstSecret };

            // A second key shares the same starting allowance: 10 fuzzy a day across both.
            const k2 = await user.request.post('/api/my-api/keys', { data: { name: `B ${TAG}` } });
            expect(k2.status()).toBe(201);
            const b = await k2.json() as { id: string; secret: string; requested?: boolean };
            expect(b.requested).toBeFalsy(); // the first key already asked
            const fuzzy = (secretOf: string) => api.post('/api/v1/search', {
                data: { mode: 'fuzzy', person: { fullName: `Nadie ${TAG}` } }, headers: { authorization: `Bearer ${secretOf}` },
            });
            for (let i = 0; i < 10; i++) expect((await fuzzy(i % 2 ? b.secret : a.secret)).status()).toBe(200);
            const over = await fuzzy(a.secret);
            expect(over.status()).toBe(429);
            const overErr = (await over.json()).error;
            expect(overErr.code).toBe('daily_cap_reached');
            expect(overErr.message).toMatch(/approves your access request/);

            // The admin sees the request (from the first key) and approves it: the limits go up.
            await page.goto('/admin/api?tab=overview');
            await expect(page.getByTestId('api-overview-pending')).toBeVisible({ timeout: 30000 });
            await page.getByTestId('api-overview-pending').click();
            const row = page.getByTestId('api-person-row').filter({ hasText: USER });
            await expect(row).toContainText(`Formulario ${TAG}`, { timeout: 30000 });
            await row.click();
            await expect(page.getByTestId('api-person')).toContainText('Revisar adoptantes', { timeout: 60000 });
            await expect(page.getByTestId('api-person-limits-hint')).toBeVisible();
            await page.getByTestId('api-access-approve').click();
            await expect(page.getByTestId('api-person').getByTestId('api-access-status').first()).toContainText(/Aprobado|Approved/, { timeout: 30000 });
            expect((await me(a.secret)).caps).toEqual({ exact: 100, fuzzy: 50 });
            expect((await fuzzy(a.secret)).status()).toBe(200);

            // A deny never turns the keys off: they go back to the starting limits.
            const decide = (decision: string) => page.request.post(`/api/admin/api-people/${encodeURIComponent(USER)}`, { data: { decision } });
            expect((await decide('deny')).status()).toBe(200);
            expect((await me(a.secret)).caps).toEqual({ exact: 25, fuzzy: 10 });
            expect((await user.request.post(`/api/my-api/keys/${a.id}`, { data: { action: 'regenerate' } })).status()).toBe(200);
            expect((await decide('approve')).status()).toBe(200);
            const fresh = (await (await user.request.get('/api/my-api/keys')).json()) as { keys: Array<{ id: string }> };
            expect(fresh.keys.length).toBeGreaterThan(0);

            // The admin sees who they searched (that view is audited).
            await page.reload();
            await expect(page.getByTestId('api-person-searched').first()).toContainText(`Nadie ${TAG}`, { timeout: 30000 });

            // Block: every key stops working; no new key from anyone.
            await page.getByTestId('api-access-block').click();
            await page.getByTestId('api-access-block-yes').click();
            await expect(page.getByTestId('api-person').getByTestId('api-access-status').first()).toContainText(/Bloqueado|Blocked/, { timeout: 30000 });
            for (const k of [a, b]) expect((await api.get('/api/v1/me', { headers: { authorization: `Bearer ${k.secret}` } })).status()).toBe(401);
            expect((await user.request.post('/api/my-api/keys', { data: { name: 'x' } })).status()).toBe(403);
            expect((await page.request.post('/api/admin/api-keys', { data: { ownerEmail: USER, name: 'x' } })).status()).toBe(409);
            await user.goto('/developers');
            await expect(user.getByTestId('developers-access-blocked')).toBeVisible({ timeout: 30000 });
        } finally {
            await page.request.post(`/api/admin/api-people/${encodeURIComponent(USER)}`, { data: { decision: 'unblock' } });
            await ctx.close();
        }
    });
});
