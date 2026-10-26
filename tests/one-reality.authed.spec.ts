import { test, expect, type Browser, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * One shared reality, end to end (spec
 * docs/superpowers/specs/2026-10-25-pendientes-d-design.md, addendum
 * 2026-10-26, D48–D52): a fact about two profiles is the same for everyone,
 * and when rescuers disagree the admins decide.
 *
 *   - D49: after the owner rejected a request, the requester keeping the
 *     owner's profile no longer merges — «Pedir revisión a un administrador»
 *     files a dispute; the admins see ONE row for the pair («Disputa», both
 *     positions) and decline it; it stays gone after a reload.
 *   - D50 + D52: a rescuer combines in «Pendientes» keeping the other's
 *     profile → the row becomes «✓ Combinados … · Ver perfil» until the page
 *     reloads; the kept profile's owner opens the notice
 *     (`/adopter/{survivor}?dispute={auditId}`), says «No es la misma
 *     persona»; an admin «Deshacer combinación» → both profiles live again.
 *     (The merge's own actor may not dispute it — decideMergeDisputeRaise —
 *     so the one who raises is the other side: here the survivor's owner, who
 *     is the one notified.)
 *   - D48: «No convive» by the linked profile's owner removes the member from
 *     the host's household and the link, on both profiles, with history on both.
 *
 * Non-admin rescuers are per-test fixture users (onereal-*-<stamp>@example.com),
 * each in its own browser context with a NextAuth session cookie signed here
 * (the pattern of tests/pendientes-d.authed.spec.ts). The admin is the authed
 * project's own session (`page`). Own rows (test-onereal-fixture-*), never seed
 * adopters. Selectors are data-testids: Chromium renders English.
 */

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

interface Rescuer { email: string; name: string; page: Page; close: () => Promise<void> }

/** A non-admin rescuer: user + profile rows (terms accepted, country confirmed) and a signed-in context. */
async function rescuer(browser: Browser, tag: string, stamp: number): Promise<Rescuer> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
        throw new Error('AUTH_SECRET is not set: the rescuers\' session cookies are signed with it. Put it in .env.local (playwright.config loads it) or export it.');
    }
    const id = `test-onereal-fixture-user-${tag}-${stamp}`;
    const email = `onereal-${tag}-${stamp}@example.com`;
    const name = `Onereal ${tag.toUpperCase()} ${stamp}`;
    execD1(`INSERT OR REPLACE INTO user (id, name, email, emailVerified, image) VALUES ('${id}', '${name}', '${email}', strftime('%s','now'), NULL)`);
    execD1(`INSERT OR REPLACE INTO user_profiles (user_id, country, country_confirmed, terms_version, terms_accepted_at) VALUES ('${id}', 'AR', 1, 1, strftime('%s','now'))`);
    const { encode } = await import('next-auth/jwt');
    const token = await encode({
        secret,
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

function seedAdopter(id: string, name: string, owner: string, daysAgo: number, tail: string) {
    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, token_hash, created_at, updated_at) VALUES ('${id}', '${name}', 'Tel: 11 5${tail}-${tail}', 'AR', '5', '${owner}', NULL, NULL, strftime('%s','now','-${daysAgo} days'), strftime('%s','now'))`);
}

function seedCandidate(id: string, newerId: string, olderId: string, matchTypes = '["name_full"]') {
    execD1(`INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at, resolved_at, resolved_by) VALUES ('${id}', '${newerId}', '${olderId}', '${matchTypes}', '{}', 100, 'high', 'pending', strftime('%s','now'), NULL, NULL)`);
}

/** Open «Pendientes de revisar» and the row whose names include `name`. */
async function openRow(page: Page, name: string, url = '/my-adopters') {
    await page.goto(url);
    await dismissCountryBanner(page);
    const toggle = page.locator('button[aria-controls="pending-dedup-list"]');
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const row = page.getByTestId('dedup-row').filter({ hasText: name });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    // Open, the names move into the comparison blocks; the row keeps its testid.
    const header = row.locator('button[aria-expanded]').first();
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    return row;
}

const isLive = (id: string) => {
    const a = rows(`SELECT deleted_at, token_hash FROM adopters WHERE id = '${id}'`)[0];
    return !!a && isDbNull(a.deleted_at) && a.token_hash !== 'MERGED';
};

test.describe('One shared reality (D48–D52)', () => {
    test('a rejected pair: keeping theirs asks the admins; one «Disputa» row for the pair; an admin decline settles it', async ({ page, browser }) => {
        test.setTimeout(300_000);
        const stamp = Date.now();
        const tail = String(stamp).slice(-3);
        const requester = await rescuer(browser, 'd1', stamp);
        const owner = await rescuer(browser, 'd2', stamp);
        const THEIRS = `test-onereal-fixture-dsp-owner-${stamp}`; // the owner's, older
        const MINE = `test-onereal-fixture-dsp-req-${stamp}`;     // the requester's, newer
        const CAND = `test-onereal-fixture-cand-dsp-${stamp}`;
        const NAME = `Onereal Dispute ${stamp}`;
        seedAdopter(THEIRS, NAME, owner.email, 30, tail);
        seedAdopter(MINE, NAME, requester.email, 0, tail);
        seedCandidate(CAND, MINE, THEIRS);

        const pairRequests = () => rows(
            `SELECT id, primary_id, secondary_id, requester_email, owner_email, status, dispute FROM merge_requests WHERE (primary_id = '${MINE}' AND secondary_id = '${THEIRS}') OR (primary_id = '${THEIRS}' AND secondary_id = '${MINE}')`,
        );

        try {
            // ── The requester keeps hers → «Pedir combinar» → the owner declines.
            const rp = requester.page;
            let row = await openRow(rp, NAME);
            await row.getByTestId('dedup-keep-new').click();
            await expect(row.getByTestId('dedup-merge')).toHaveText(/^(Request merge|Pedir combinar|Pedir para combinar)$/);
            await row.getByTestId('dedup-merge').click();
            await expect(row).toHaveAttribute('data-group', 'sent', { timeout: 30_000 });
            await expect.poll(() => pairRequests().length, { timeout: 30_000 }).toBe(1);

            const op = owner.page;
            await op.goto('/my-adopters');
            await dismissCountryBanner(op);
            const received = op.getByTestId('dedup-row').filter({ hasText: NAME });
            await expect(received).toHaveAttribute('data-group', 'received', { timeout: 30_000 });
            await received.getByTestId('dedup-decline-request').click();
            await expect.poll(() => pairRequests()[0]?.status, { timeout: 30_000 }).toBe('declined');

            // ── D49: keeping theirs no longer merges — it asks the admins.
            row = await openRow(rp, NAME);
            await expect(row).toHaveAttribute('data-group', 'declined');
            const review = row.getByTestId('dedup-merge');
            await expect(review).toHaveText(/^(Ask an administrator to review|Pedir revisión a un administrador|Pedir revisão a um administrador)$/);
            await review.click();
            // No «pasará a la lista de …» confirmation: nothing moves until an admin decides.
            await expect(rp.getByTestId('dedup-confirm-dialog')).toHaveCount(0);
            await expect(row).toHaveAttribute('data-group', 'sent', { timeout: 30_000 });

            await expect.poll(() => pairRequests().filter(r => Number(r.dispute) === 1).length, { timeout: 30_000 }).toBe(1);
            const dispute = pairRequests().find(r => Number(r.dispute) === 1)!;
            expect(dispute).toMatchObject({ primary_id: THEIRS, secondary_id: MINE, requester_email: requester.email, status: 'pending' });
            expect(isDbNull(dispute.owner_email), 'a dispute goes to the admins, not to the owner').toBe(true);
            expect(isLive(MINE) && isLive(THEIRS), 'nothing merged').toBe(true);

            // ── The admins: ONE row for the pair, a «Disputa» with both positions.
            await page.goto('/admin/merge-requests');
            await dismissCountryBanner(page);
            const adminRow = page.getByTestId('merge-request-row').filter({ hasText: NAME });
            await expect(adminRow).toHaveCount(1, { timeout: 30_000 });
            await expect(adminRow).toHaveAttribute('data-dispute', '1');
            await expect(adminRow.getByTestId('merge-request-rejected')).toContainText(owner.email);
            await adminRow.getByTestId('merge-request-decline').click();
            await expect(adminRow).toHaveCount(0, { timeout: 30_000 });

            // Settled for the whole pair: nothing of it comes back after a reload («Aprobar igual» included).
            await expect.poll(() => pairRequests().map(r => r.status).sort(), { timeout: 30_000 })
                .toEqual(['admin_declined', 'admin_declined']);
            await page.reload();
            await expect(page.getByRole('heading', { level: 1 }).last()).toBeVisible({ timeout: 30_000 });
            await expect(page.getByTestId('merge-request-row').filter({ hasText: NAME })).toHaveCount(0);
            expect(isLive(MINE) && isLive(THEIRS), 'still two profiles').toBe(true);
        } finally {
            await requester.close();
            await owner.close();
        }
    });

    test('combined in «Pendientes»: «✓ Combinados · Ver perfil»; the kept profile\'s owner disputes it; an admin undoes it', async ({ page, browser }) => {
        test.setTimeout(300_000);
        const stamp = Date.now();
        const tail = String(stamp).slice(-3);
        const actor = await rescuer(browser, 'm1', stamp);    // combines, keeping the other's profile
        const keeper = await rescuer(browser, 'm2', stamp);   // owns the kept profile: notified, disputes
        const THEIRS = `test-onereal-fixture-mrg-kept-${stamp}`;     // older → kept
        const MINE = `test-onereal-fixture-mrg-absorbed-${stamp}`;   // newer → absorbed
        const CAND = `test-onereal-fixture-cand-mrg-${stamp}`;
        const NAME = `Onereal Merge ${stamp}`;
        seedAdopter(THEIRS, NAME, keeper.email, 30, tail);
        seedAdopter(MINE, NAME, actor.email, 0, tail);
        seedCandidate(CAND, MINE, THEIRS);

        try {
            // ── D52: combining keeps the row, as its confirmation, with «Ver perfil».
            const ap = actor.page;
            const row = await openRow(ap, NAME);
            await expect(row.getByTestId('dedup-keep-existing')).toHaveAttribute('aria-checked', 'true');
            await row.getByTestId('dedup-merge').click();
            const confirm = ap.getByTestId('dedup-confirm-dialog');
            await expect(confirm).toBeVisible({ timeout: 15_000 });
            await confirm.getByTestId('dedup-confirm').click();

            const merged = ap.getByTestId('dedup-merged-row').filter({ hasText: NAME });
            await expect(merged).toHaveCount(1, { timeout: 30_000 });
            await expect(merged.getByTestId('dedup-merged-view')).toHaveAttribute('href', `/adopter/${encodeURIComponent(THEIRS)}`);
            await expect(row).toHaveCount(0);
            await expect.poll(() => rows(`SELECT token_hash FROM adopters WHERE id = '${MINE}'`)[0]?.token_hash, { timeout: 30_000 }).toBe('MERGED');
            // Until the page reloads.
            await ap.reload();
            await dismissCountryBanner(ap);
            await expect(ap.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
            await expect(ap.getByTestId('dedup-merged-row')).toHaveCount(0);
            await expect(ap.getByTestId('dedup-row').filter({ hasText: NAME })).toHaveCount(0);

            // ── D50: the kept profile's owner hears of it; the notice opens «¿No es la misma persona?».
            const noticeUrl = () => rows(
                `SELECT url FROM notifications WHERE user_id = '${keeper.email}' AND type = 'adopter_merged' AND metadata LIKE '%${MINE}%'`,
            )[0]?.url;
            await expect.poll(noticeUrl, { timeout: 30_000 }).toMatch(new RegExp(`^/adopter/${THEIRS}\\?dispute=`));
            const url = String(noticeUrl());
            const auditId = decodeURIComponent(url.split('?dispute=')[1]);

            const kp = keeper.page;
            await kp.goto(url);
            await dismissCountryBanner(kp);
            const prompt = kp.getByTestId('merge-dispute-prompt');
            await expect(prompt).toBeVisible({ timeout: 30_000 });
            await prompt.getByTestId('merge-dispute-raise').click();
            await expect(prompt.getByTestId('merge-dispute-raise')).toHaveCount(0, { timeout: 30_000 });
            await expect(prompt).toBeVisible(); // now saying the admins were told

            const disputes = () => rows(`SELECT id, survivor_id, absorbed_id, raised_by, status FROM merge_disputes WHERE audit_id = '${auditId}'`);
            await expect.poll(() => disputes().length, { timeout: 30_000 }).toBe(1);
            expect(disputes()[0]).toMatchObject({ survivor_id: THEIRS, absorbed_id: MINE, raised_by: keeper.email, status: 'open' });
            expect(isLive(MINE), 'nothing changes until an admin decides').toBe(false);

            // ── The admins: «Disputas» → «Deshacer combinación».
            await page.goto('/admin/merge-requests');
            await dismissCountryBanner(page);
            const disputeRow = page.getByTestId('merge-dispute-row').filter({ hasText: NAME });
            await expect(disputeRow).toHaveCount(1, { timeout: 30_000 });
            await disputeRow.getByTestId('merge-dispute-undo').click();
            await expect(disputeRow).toHaveCount(0, { timeout: 60_000 });

            // Both profiles are back, and both rescuers hear the outcome.
            await expect.poll(() => isLive(MINE) && isLive(THEIRS), { timeout: 30_000 }).toBe(true);
            expect(disputes()[0]?.status).toBe('undone');
            for (const who of [actor.email, keeper.email]) {
                await expect.poll(() => Number(rows(
                    `SELECT COUNT(*) AS n FROM notifications WHERE user_id = '${who}' AND type = 'merge_dispute_resolved' AND metadata LIKE '%${auditId}%'`,
                )[0]?.n ?? 0), { timeout: 30_000 }).toBe(1);
            }
            // The absorbed profile's link is its own profile again, not a redirect to the kept one.
            await ap.goto(`/adopter/${MINE}`);
            await expect(ap.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
            expect(new URL(ap.url()).pathname).toBe(`/adopter/${MINE}`);
        } finally {
            await actor.close();
            await keeper.close();
        }
    });

    test('«No convive» by the linked profile\'s owner removes the member and the link on both profiles, with history on both', async ({ browser }) => {
        test.setTimeout(300_000);
        const stamp = Date.now();
        const tail = String(stamp).slice(-3);
        const host = await rescuer(browser, 'h1', stamp);    // owns the host profile; links the other as a conviviente
        const linked = await rescuer(browser, 'h2', stamp);  // owns the linked profile; says «No convive»
        const HOST = `test-onereal-fixture-hh-host-${stamp}`;      // older
        const LINKED = `test-onereal-fixture-hh-linked-${stamp}`;  // newer
        const CAND = `test-onereal-fixture-cand-hh-${stamp}`;
        const HOST_NAME = `Onereal Andrea ${stamp}`;
        const LINKED_NAME = `Onereal Bruno ${stamp}`;
        seedAdopter(HOST, HOST_NAME, host.email, 30, tail);
        seedAdopter(LINKED, LINKED_NAME, linked.email, 0, tail);
        // A contact match between different names: «¿Es la misma persona?» → «alguien de su hogar» (D35).
        seedCandidate(CAND, LINKED, HOST, '["phone"]');

        const members = () => {
            const raw = rows(`SELECT household_members FROM adopters WHERE id = '${HOST}'`)[0]?.household_members;
            if (isDbNull(raw)) return [];
            return (JSON.parse(String(raw)) as Array<{ name?: string; profileId?: string }>).map(m => ({ name: m.name, profileId: m.profileId }));
        };
        const links = () => rows(`SELECT id FROM household_links WHERE host_adopter_id = '${HOST}' AND linked_adopter_id = '${LINKED}'`);

        try {
            // ── The host's owner links the other person as someone of the household.
            const hp = host.page;
            const row = await openRow(hp, HOST_NAME);
            await row.getByTestId('dedup-merge').click();
            const ask = hp.getByTestId('dedup-identity-dialog');
            await expect(ask).toBeVisible({ timeout: 15_000 });
            await ask.getByTestId('dedup-identity-household').click();
            await expect(row).toHaveCount(0, { timeout: 30_000 });
            await expect.poll(members, { timeout: 30_000 }).toEqual([{ name: LINKED_NAME, profileId: LINKED }]);
            await expect.poll(() => links().length, { timeout: 30_000 }).toBe(1);

            // Both profiles show it: the host's household links to the other profile…
            await hp.goto(`/adopter/${HOST}`);
            await dismissCountryBanner(hp);
            const memberLink = hp.locator(`[data-testid="household-member-profile-link"][href="/adopter/${encodeURIComponent(LINKED)}"]`);
            await expect(memberLink).toHaveCount(1, { timeout: 30_000 });

            // …and the linked profile shows «Convive con» the host, where its owner says «No convive».
            const lp = linked.page;
            await lp.goto(`/adopter/${LINKED}`);
            await dismissCountryBanner(lp);
            const livesWith = lp.getByTestId('lives-with-row').filter({ hasText: HOST_NAME });
            await expect(livesWith).toHaveCount(1, { timeout: 30_000 });
            await livesWith.getByTestId('hh-not-living-together').click();
            const dialog = lp.getByRole('dialog');
            await expect(dialog).toBeVisible({ timeout: 15_000 });
            await dialog.getByRole('button').last().click(); // the confirm (Cancel comes first)
            await expect(livesWith).toHaveCount(0, { timeout: 30_000 });

            // ── Corrected for everyone: the member is gone from the host, the link from both.
            await expect.poll(members, { timeout: 30_000 }).toEqual([]);
            expect(links()).toHaveLength(0);
            expect(rows(`SELECT corrected_by FROM household_link_corrections WHERE host_adopter_id = '${HOST}' AND linked_adopter_id = '${LINKED}'`))
                .toEqual([{ corrected_by: linked.email }]);
            // History on both profiles, by whoever corrected it.
            expect(rows(`SELECT changed_by FROM adopter_history WHERE adopter_id = '${HOST}' AND changes LIKE '%not_living_together%'`))
                .toEqual([{ changed_by: linked.email }]);
            expect(rows(`SELECT changed_by FROM adopter_history WHERE adopter_id = '${LINKED}' AND changes LIKE '%household_not_living_together%'`))
                .toEqual([{ changed_by: linked.email }]);
            // The host's owner is told.
            await expect.poll(() => Number(rows(
                `SELECT COUNT(*) AS n FROM notifications WHERE user_id = '${host.email}' AND type = 'household_link_removed'`,
            )[0]?.n ?? 0), { timeout: 30_000 }).toBe(1);

            // The host's own page no longer lists the person.
            await hp.reload();
            await dismissCountryBanner(hp);
            await expect(hp.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
            await expect(memberLink).toHaveCount(0);
            for (const id of [HOST, LINKED]) expect(isLive(id), `${id} untouched otherwise`).toBe(true);
        } finally {
            await host.close();
            await linked.close();
        }
    });
});
