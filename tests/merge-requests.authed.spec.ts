import { test, expect, type Browser, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Merge requests end to end (layout D, spec 2026-10-25-pendientes-d):
 *
 *   - #pendientes (the request notifications' link) opens the section; an
 *     admin's «Combinar perfiles» on another rescuer's newer profile merges it
 *     straight away — admins choose freely, no request (D24) — and the
 *     absorbed profile's old link lands on the survivor with a note (D32);
 *   - a rescuer's «Pedir combinar» files a request with the owner (a
 *     `merge_request` notification) → she cancels it → asks again → an admin
 *     approves it on /admin/merge-requests → merged.
 *
 * Plus /settings «Avisos por email»: the requests row is always on (no switch)
 * and the API row shows only to someone holding a live API key.
 *
 * The rescuer is a per-test fixture user (mergereq-*-<stamp>@example.com) in
 * her own browser context, with a NextAuth session cookie signed here the way
 * tests/auth.setup.ts signs the admin's. Own fixture rows
 * (test-mergereq-fixture-*, stamped per run), never seed adopters. Selectors
 * are data-testids: Chromium renders the English locale.
 */

const ADMIN_EMAIL = 'gatitosolivos@gmail.com';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}

function parseD1Rows(output: string): Array<Record<string, unknown>> {
    try {
        const wrapped = JSON.parse(output);
        const first = Array.isArray(wrapped) ? wrapped[0] : wrapped;
        return first?.results ?? [];
    } catch {
        return [];
    }
}

const rows = (sql: string) => parseD1Rows(execD1(sql));

/** Wrangler's --json renders SQL NULL as the string "null" in CI — normalize. */
const isDbNull = (v: unknown) => v === null || v === undefined || v === 'null';

/** A non-admin rescuer: user + profile rows (terms accepted, country confirmed) and a signed-in context. */
async function rescuer(browser: Browser, tag: string, stamp: number) {
    const id = `test-mergereq-fixture-user-${tag}-${stamp}`;
    const email = `mergereq-${tag}-${stamp}@example.com`;
    const name = `Mergereq ${tag.toUpperCase()} ${stamp}`;
    execD1(`INSERT OR REPLACE INTO user (id, name, email, emailVerified, image) VALUES ('${id}', '${name}', '${email}', strftime('%s','now'), NULL)`);
    execD1(`INSERT OR REPLACE INTO user_profiles (user_id, country, country_confirmed, terms_version, terms_accepted_at) VALUES ('${id}', 'AR', 1, 1, strftime('%s','now'))`);
    const { encode } = await import('next-auth/jwt');
    const token = await encode({
        secret: process.env.AUTH_SECRET!,
        token: { email, name, sub: id, sessionVersion: 3 },
        salt: 'authjs.session-token',
    });
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await ctx.addCookies([{ name: 'authjs.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await ctx.addInitScript((e) => {
        localStorage.setItem(`country_confirmed_${e}`, '1');
        localStorage.setItem('playwright_test_mode', '1');
    }, email);
    const page = await ctx.newPage();
    return { email, name, page, close: () => ctx.close() };
}

function seedPair(ids: { older: string; newer: string; cand: string }, name: string, owners: { older: string; newer: string }, tail: string) {
    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, token_hash, created_at, updated_at) VALUES ('${ids.older}', '${name}', 'Tel: 11 5100-${tail}', 'AR', '5', '${owners.older}', NULL, NULL, strftime('%s','now','-30 days'), strftime('%s','now'))`);
    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, token_hash, created_at, updated_at) VALUES ('${ids.newer}', '${name}', 'Tel: 11 5200-${tail}', 'AR', '5', '${owners.newer}', NULL, NULL, strftime('%s','now'), strftime('%s','now'))`);
    // high + 100 + detected now: the feed hides low pairs and pages by score
    // then detection time, so this lands on page 1.
    execD1(`INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at, resolved_at, resolved_by) VALUES ('${ids.cand}', '${ids.newer}', '${ids.older}', '["name_full"]', '{}', 100, 'high', 'pending', strftime('%s','now'), NULL, NULL)`);
}

async function openPendingCard(page: Page, name: string) {
    await page.goto('/my-adopters');
    await dismissCountryBanner(page);
    const toggle = page.locator('button[aria-controls="pending-dedup-list"]');
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const card = page.getByTestId('dedup-row').filter({ hasText: name });
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    // Layout D: rows open one at a time; the header is the first expandable button.
    const header = card.locator('button[aria-expanded]').first();
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    return card;
}

test('#pendientes opens the section; an admin\'s «Combinar perfiles» merges another rescuer\'s profile at once', async ({ page }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const A = `test-mergereq-fixture-a-${stamp}`; // the admin's, older → survives
    const B = `test-mergereq-fixture-b-${stamp}`; // another rescuer's, newer → absorbed
    const CAND = `test-mergereq-fixture-cand-${stamp}`;
    const NAME = `Mergereq Admin ${stamp}`;
    const OWNER = `mergereq-owner-${stamp}@example.com`;
    seedPair({ older: A, newer: B, cand: CAND }, NAME, { older: ADMIN_EMAIL, newer: OWNER }, String(stamp).slice(-4));

    // ── The request notification's link (#pendientes) opens the section by itself.
    await page.goto('/my-adopters#pendientes');
    await dismissCountryBanner(page);
    await expect(page.locator('button[aria-controls="pending-dedup-list"]')).toHaveAttribute('aria-expanded', 'true', { timeout: 30_000 });
    await expect(page.locator('#pendientes')).toBeVisible();

    // ── The other rescuer's (newer) block names its creator; the admin's does not.
    const card = await openPendingCard(page, NAME);
    await expect(card.getByTestId('dedup-created-by')).toHaveCount(1);
    await expect(card.getByTestId('dedup-created-by')).toContainText(`mergereq-owner-${stamp}`);
    // An admin's choice needs nobody's consent: the button merges, it doesn't ask.
    const merge = card.getByTestId('dedup-merge');
    await expect(merge).toHaveText(/^(Merge profiles|Combinar perfiles|Combinar perfis)$/);
    await merge.click();
    // The admin keeps his own profile: nothing moves to another list, so no confirmation.
    await expect(card).toHaveCount(0, { timeout: 30_000 });

    await expect.poll(() => rows(`SELECT token_hash FROM adopters WHERE id = '${B}'`)[0]?.token_hash, { timeout: 30_000 })
        .toBe('MERGED');
    expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${A}'`)[0]?.deleted_at), 'A survives').toBe(true);
    expect(rows(`SELECT COUNT(*) AS n FROM merge_requests WHERE candidate_id = '${CAND}'`)[0]?.n, 'no request filed').toBe(0);
    // The other rescuer hears that an admin joined the profiles.
    await expect.poll(() => Number(rows(
        `SELECT COUNT(*) AS n FROM notifications WHERE user_id = '${OWNER}' AND type = 'adopter_merged' AND metadata LIKE '%${A}%'`,
    )[0]?.n ?? 0), { timeout: 30_000 }).toBe(1);

    // ── The absorbed profile's old link lands on the survivor, with the merged note.
    await page.goto(`/adopter/${B}`);
    await expect(page).toHaveURL(new RegExp(`/adopter/${A}\\?(.*&)?merged=${B}(&|$)`), { timeout: 30_000 });
    await expect(page.getByTestId('merged-profile-note')).toBeVisible({ timeout: 30_000 });
});

test('a rescuer\'s request goes to the other owner, can be cancelled, and an admin approval merges it', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const stamp = Date.now();
    const A = `test-mergereq-fixture-ra-${stamp}`; // the rescuer's, older → survives
    const B = `test-mergereq-fixture-rb-${stamp}`; // the owner's, newer → absorbed
    const CAND = `test-mergereq-fixture-rcand-${stamp}`;
    const NAME = `Mergereq Request ${stamp}`;
    const OWNER = `mergereq-rowner-${stamp}@example.com`; // never acts: no session
    const requester = await rescuer(browser, 'req', stamp);
    seedPair({ older: A, newer: B, cand: CAND }, NAME, { older: requester.email, newer: OWNER }, String(stamp).slice(-4));

    const pendingRequestIds = () => rows(
        `SELECT id FROM merge_requests WHERE primary_id = '${A}' AND secondary_id = '${B}' AND status = 'pending'`,
    ).map(r => String(r.id));

    try {
        const rp = requester.page;
        // ── Keeping hers would absorb the owner's profile: the button asks.
        let card = await openPendingCard(rp, NAME);
        await expect(card.getByTestId('dedup-keep-existing')).toHaveAttribute('aria-checked', 'true');
        await expect(card.getByTestId('dedup-merge')).toHaveText(/^(Request merge|Pedir combinar|Pedir para combinar)$/);
        await card.getByTestId('dedup-merge').click();
        await expect(rp.getByText(/Request sent to|Pedido enviado a|Pedido enviado para/).first()).toBeVisible({ timeout: 30_000 });
        await expect(card).toHaveAttribute('data-group', 'sent', { timeout: 30_000 });
        await expect(card.getByTestId('dedup-request-status')).toBeVisible();
        await expect(card.getByTestId('dedup-cancel-request')).toBeVisible();
        await expect(card.getByTestId('dedup-merge')).toHaveCount(0);

        await expect.poll(() => pendingRequestIds().length, { timeout: 30_000 }).toBe(1);
        const firstId = pendingRequestIds()[0];
        const req = rows(`SELECT requester_email, owner_email, candidate_id FROM merge_requests WHERE id = '${firstId}'`)[0];
        expect(req).toMatchObject({ requester_email: requester.email, owner_email: OWNER, candidate_id: CAND });
        for (const id of [A, B]) {
            expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${id}'`)[0]?.deleted_at), `${id} not merged yet`).toBe(true);
        }
        await expect.poll(() => rows(
            `SELECT COUNT(*) AS n FROM notifications WHERE user_id = '${OWNER}' AND type = 'merge_request' AND metadata LIKE '%${firstId}%'`,
        )[0]?.n, { timeout: 30_000 }).toBe(1);

        // ── Cancelar pedido → cancelled, the row is a possible duplicate again.
        await card.getByTestId('dedup-cancel-request').click();
        await expect.poll(() => rows(`SELECT status FROM merge_requests WHERE id = '${firstId}'`)[0]?.status, { timeout: 30_000 })
            .toBe('cancelled');
        await expect(card).toHaveAttribute('data-group', 'pair', { timeout: 30_000 });

        // ── Ask again: a fresh pending request.
        card = await openPendingCard(rp, NAME);
        await expect(card.getByTestId('dedup-merge')).toHaveText(/^(Request merge|Pedir combinar|Pedir para combinar)$/);
        await card.getByTestId('dedup-merge').click();
        await expect(card.getByTestId('dedup-cancel-request')).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => pendingRequestIds().length, { timeout: 30_000 }).toBe(1);
        const secondId = pendingRequestIds()[0];
        expect(secondId).not.toBe(firstId);

        // ── An admin approves it → B absorbed into A.
        await page.goto('/admin/merge-requests');
        await dismissCountryBanner(page);
        const row = page.getByTestId('merge-request-row').filter({ hasText: NAME });
        await expect(row).toHaveCount(1, { timeout: 30_000 });
        // «Qué coincide y qué no» on the row; approving asks first, saying what it does (audit A4).
        await expect(row.getByTestId('match-compare')).toBeVisible();
        await expect(row.getByTestId('merge-request-side-keep')).toBeVisible();
        await row.getByTestId('merge-request-approve').click();
        const confirm = page.getByTestId('merge-request-confirm');
        await expect(confirm).toBeVisible();
        // Both sides told apart by owner (same-name pairs): an owner's address is in the sentence.
        await expect(confirm).toContainText('@');
        await confirm.getByTestId('merge-request-confirm-confirm').click();
        await expect(confirm).toHaveCount(0, { timeout: 30_000 });
        await expect(row).toHaveCount(0, { timeout: 30_000 });

        await expect.poll(() => rows(`SELECT token_hash FROM adopters WHERE id = '${B}'`)[0]?.token_hash, { timeout: 30_000 })
            .toBe('MERGED');
        expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${B}'`)[0]?.deleted_at), 'B is absorbed').toBe(false);
        expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${A}'`)[0]?.deleted_at), 'A survives').toBe(true);
        expect(rows(`SELECT status FROM merge_requests WHERE id = '${secondId}'`)[0]?.status).toBe('admin_approved');

        // ── The absorbed profile's old link lands on the survivor.
        await page.goto(`/adopter/${B}`);
        await expect(page).toHaveURL(new RegExp(`/adopter/${A}(\\?|$)`), { timeout: 30_000 });
    } finally {
        await requester.close();
    }
});

test('/settings «Avisos por email»: requests are always on; the API row follows a live API key', async ({ page }) => {
    test.setTimeout(120_000);
    // Other specs in this project create admin API keys, so the expectation
    // comes from the DB rather than assuming the seed's "no key".
    const hasLiveKey = Number(rows(
        `SELECT COUNT(*) AS n FROM api_keys WHERE owner_email = '${ADMIN_EMAIL}' AND revoked_at IS NULL`,
    )[0]?.n ?? 0) > 0;

    await page.goto('/settings');
    await dismissCountryBanner(page);
    const section = page.getByTestId('email-prefs-section');
    await expect(section).toBeVisible({ timeout: 30_000 });

    const requestsRow = section.getByTestId('email-pref-requests');
    await expect(requestsRow).toBeVisible();
    await expect(requestsRow).toContainText(/Always on|Siempre activo|Sempre ativo/);
    await expect(section.getByTestId('email-pref-toggle-requests')).toHaveCount(0);
    // Switchable categories do carry a switch.
    await expect(section.getByTestId('email-pref-toggle-forms')).toBeVisible();

    await expect(section.getByTestId('email-pref-api')).toHaveCount(hasLiveKey ? 1 : 0);
});
