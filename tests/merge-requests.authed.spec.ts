import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Merge requests end to end, the admin session as the requester:
 *
 *   «Combinar perfiles» on a pair whose absorbed (newer) side belongs to
 *   another rescuer files a request instead of merging → the owner gets a
 *   `merge_request` notification → the requester cancels it → asks again →
 *   an admin approves it on /admin/merge-requests → the newer profile is
 *   absorbed and its old link lands on the survivor.
 *
 * Plus /settings «Avisos por email»: the requests row is always on (no switch)
 * and the API row shows only to someone holding a live API key.
 *
 * Own fixture rows (test-mergereq-fixture-*, stamped per run), never seed
 * adopters. Selectors are data-testids: Chromium renders the English locale.
 */

const ADMIN_EMAIL = 'gatitosolivos@gmail.com';
const OWNER_EMAIL = 'testuser@example.com';

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

async function openPendingCard(page: Page, name: string) {
    await page.goto('/my-adopters');
    await dismissCountryBanner(page);
    const toggle = page.locator('button[aria-controls="pending-dedup-list"]');
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const card = page.locator('#pending-dedup-list > div').filter({ hasText: name });
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    return card;
}

test('a request goes to the other owner, can be cancelled, and an admin approval merges it', async ({ page }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const A = `test-mergereq-fixture-a-${stamp}`; // the admin's, older → survives
    const B = `test-mergereq-fixture-b-${stamp}`; // testuser's, newer → absorbed
    const CAND = `test-mergereq-fixture-cand-${stamp}`;
    const NAME = `Mergereq Fixture ${stamp}`;
    const tail = String(stamp).slice(-4);

    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, token_hash, created_at, updated_at) VALUES ('${A}', '${NAME}', 'Tel: 11 5100-${tail}', 'AR', '5', '${ADMIN_EMAIL}', NULL, NULL, strftime('%s','now','-30 days'), strftime('%s','now'))`);
    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, token_hash, created_at, updated_at) VALUES ('${B}', '${NAME}', 'Tel: 11 5200-${tail}', 'AR', '5', '${OWNER_EMAIL}', NULL, NULL, strftime('%s','now'), strftime('%s','now'))`);
    // high + 100 + detected now: the feed hides low pairs and pages by score
    // then detection time, so this lands on page 1.
    execD1(`INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at, resolved_at, resolved_by) VALUES ('${CAND}', '${B}', '${A}', '["name_full"]', '{}', 100, 'high', 'pending', strftime('%s','now'), NULL, NULL)`);

    const pendingRequestIds = () => rows(
        `SELECT id FROM merge_requests WHERE primary_id = '${A}' AND secondary_id = '${B}' AND status = 'pending'`,
    ).map(r => String(r.id));

    // ── The other owner's (newer) card names its creator; ours does not.
    let card = await openPendingCard(page, NAME);
    await expect(card.getByTestId('dedup-created-by')).toHaveCount(1);
    await expect(card.getByTestId('dedup-created-by')).toContainText(/Test User|testuser/);

    // ── Combinar → a request, not a merge.
    await card.getByTestId('dedup-merge').click();
    await expect(page.getByText(/Request sent to|Pedido enviado a|Pedido enviado para/).first()).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId('dedup-request-status')).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId('dedup-cancel-request')).toBeVisible();
    await expect(card.getByTestId('dedup-merge')).toHaveCount(0);

    await expect.poll(() => pendingRequestIds().length, { timeout: 30_000 }).toBe(1);
    const firstId = pendingRequestIds()[0];
    const req = rows(`SELECT requester_email, owner_email, candidate_id FROM merge_requests WHERE id = '${firstId}'`)[0];
    expect(req).toMatchObject({ requester_email: ADMIN_EMAIL, owner_email: OWNER_EMAIL, candidate_id: CAND });
    for (const id of [A, B]) {
        expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${id}'`)[0]?.deleted_at), `${id} not merged yet`).toBe(true);
    }
    await expect.poll(() => rows(
        `SELECT COUNT(*) AS n FROM notifications WHERE user_id = '${OWNER_EMAIL}' AND type = 'merge_request' AND metadata LIKE '%${firstId}%'`,
    )[0]?.n, { timeout: 30_000 }).toBe(1);

    // ── Cancelar pedido → cancelled, Combinar is back.
    await card.getByTestId('dedup-cancel-request').click();
    await expect(card.getByTestId('dedup-merge')).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId('dedup-request-status')).toHaveCount(0);
    await expect.poll(() => rows(`SELECT status FROM merge_requests WHERE id = '${firstId}'`)[0]?.status, { timeout: 30_000 })
        .toBe('cancelled');

    // ── Ask again: a fresh pending request.
    card = await openPendingCard(page, NAME);
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
    await row.getByTestId('merge-request-approve').click();
    await expect(row).toHaveCount(0, { timeout: 30_000 });

    await expect.poll(() => rows(`SELECT token_hash FROM adopters WHERE id = '${B}'`)[0]?.token_hash, { timeout: 30_000 })
        .toBe('MERGED');
    expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${B}'`)[0]?.deleted_at), 'B is absorbed').toBe(false);
    expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${A}'`)[0]?.deleted_at), 'A survives').toBe(true);
    expect(rows(`SELECT status FROM merge_requests WHERE id = '${secondId}'`)[0]?.status).toBe('admin_approved');

    // ── The absorbed profile's old link lands on the survivor.
    await page.goto(`/adopter/${B}`);
    await expect(page).toHaveURL(new RegExp(`/adopter/${A}(\\?|$)`), { timeout: 30_000 });
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
