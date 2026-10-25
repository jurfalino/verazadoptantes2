import { test, expect, type Browser, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * «Pendientes de revisar», layout D, end to end (spec
 * docs/superpowers/specs/2026-10-25-pendientes-d-design.md):
 *
 *   - keeping the other rescuer's profile asks for confirmation, merges at
 *     once and leaves the absorbed side's owner access to the contact values
 *     their profile brought (D25, D40, D41, final review C1);
 *     the absorbed profile's old link lands on the survivor with a note (D32);
 *   - keeping your own asks the other owner («Pedir combinar») for the
 *     survivor you chose (D24); the owner declines, the requester sees
 *     «Rechazado», writes to them («Escribirle», D28) and takes the pair off
 *     their own list only («Quitar de la lista», D27);
 *   - different names that matched on a contact ask «¿Es la misma persona?»;
 *     «alguien de su hogar» links them as household members, no merge (D35).
 *
 * Admins' choices merge immediately (D24), so these flows run as non-admin
 * rescuers: per-test fixture users (pendd-*-<stamp>@example.com), each in its
 * own browser context with a NextAuth session cookie signed here — the same
 * way tests/auth.setup.ts signs the admin's. Contexts are driven one after
 * the other, never at the same time. Own rows (test-pendd-fixture-*), never
 * seed adopters. Selectors are data-testids: Chromium renders English.
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

/** Same as src/domain/dedupPair.ts pairKey. */
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface Rescuer { email: string; name: string; page: Page; close: () => Promise<void> }

/** A non-admin rescuer: user + profile rows (terms accepted, country confirmed) and a signed-in context. */
async function rescuer(browser: Browser, tag: string, stamp: number): Promise<Rescuer> {
    const id = `test-pendd-fixture-user-${tag}-${stamp}`;
    const email = `pendd-${tag}-${stamp}@example.com`;
    const name = `Pendd ${tag.toUpperCase()} ${stamp}`;
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

test.describe('Pendientes de revisar (layout D)', () => {
    test('keeping the other rescuer\'s profile: confirm, merged, access to the survivor, and the old link\'s note', async ({ browser }) => {
        test.setTimeout(180_000);
        const stamp = Date.now();
        const tail = String(stamp).slice(-3);
        const me = await rescuer(browser, 'k1', stamp);
        const OTHER = `pendd-k2-${stamp}@example.com`; // no session needed: never acts
        const THEIRS = `test-pendd-fixture-theirs-${stamp}`; // older → the default survivor
        const MINE = `test-pendd-fixture-mine-${stamp}`;     // newer → absorbed
        const CAND = `test-pendd-fixture-cand-k-${stamp}`;
        const NAME = `Pendd Keep ${stamp}`;
        seedAdopter(THEIRS, NAME, OTHER, 30, tail);
        seedAdopter(MINE, NAME, me.email, 0, tail);
        seedCandidate(CAND, MINE, THEIRS);

        try {
            const page = me.page;
            const row = await openRow(page, NAME);
            await expect(row).toHaveAttribute('data-group', 'pair');
            // The older profile (theirs) is kept by default; keeping it needs no consent (D41).
            await expect(row.getByTestId('dedup-keep-existing')).toHaveAttribute('aria-checked', 'true');
            const merge = row.getByTestId('dedup-merge');
            await expect(merge).toHaveText(/^(Merge profiles|Combinar perfiles|Combinar perfis)$/);
            await merge.click();

            // Her adopter moves to the other rescuer's list: that is confirmed first (D25).
            const dialog = page.getByTestId('dedup-confirm-dialog');
            await expect(dialog).toBeVisible({ timeout: 15_000 });
            expect(rows(`SELECT token_hash FROM adopters WHERE id = '${MINE}'`)[0]?.token_hash ?? null, 'nothing merges before the confirm').not.toBe('MERGED');
            await dialog.getByTestId('dedup-confirm').click();
            await expect(row).toHaveCount(0, { timeout: 30_000 });

            await expect.poll(() => rows(`SELECT token_hash FROM adopters WHERE id = '${MINE}'`)[0]?.token_hash, { timeout: 30_000 })
                .toBe('MERGED');
            expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${MINE}'`)[0]?.deleted_at), 'hers is absorbed').toBe(false);
            expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${THEIRS}'`)[0]?.deleted_at), 'theirs survives').toBe(true);
            // D40: she keeps seeing what her profile brought (its one phone) —
            // not the whole survivor: the other rescuer never agreed (final review C1).
            const grants = rows(`SELECT scope, origin, revoked_at FROM pii_access_grants WHERE adopter_id = '${THEIRS}' AND grantee_email = '${me.email}'`);
            expect(grants).toHaveLength(1);
            expect(grants[0]).toMatchObject({ scope: 'entry', origin: 'merge' });
            expect(isDbNull(grants[0].revoked_at)).toBe(true);
            // …and the other owner hears their profile absorbed hers.
            await expect.poll(() => Number(rows(
                `SELECT COUNT(*) AS n FROM notifications WHERE user_id = '${OTHER}' AND type = 'adopter_merged' AND metadata LIKE '%${MINE}%'`,
            )[0]?.n ?? 0), { timeout: 30_000 }).toBe(1);

            // D32: her old link lands on the survivor and says why.
            await page.goto(`/adopter/${MINE}`);
            await expect(page).toHaveURL(new RegExp(`/adopter/${THEIRS}\\?(.*&)?merged=${MINE}(&|$)`), { timeout: 30_000 });
            await expect(page.getByTestId('merged-profile-note')).toBeVisible({ timeout: 30_000 });
        } finally {
            await me.close();
        }
    });

    test('keeping your own asks the owner; they decline; the requester writes to them and hides the pair from her list only', async ({ browser }) => {
        test.setTimeout(240_000);
        const stamp = Date.now();
        const tail = String(stamp).slice(-3);
        const requester = await rescuer(browser, 'r1', stamp);
        const owner = await rescuer(browser, 'r2', stamp);
        const THEIRS = `test-pendd-fixture-owner-${stamp}`; // the owner's, older
        const MINE = `test-pendd-fixture-req-${stamp}`;     // the requester's, newer — her chosen survivor
        const CAND = `test-pendd-fixture-cand-r-${stamp}`;
        const NAME = `Pendd Request ${stamp}`;
        seedAdopter(THEIRS, NAME, owner.email, 30, tail);
        seedAdopter(MINE, NAME, requester.email, 0, tail);
        seedCandidate(CAND, MINE, THEIRS);
        // A second pair of hers (both her own) keeps the section on screen once the first is hidden.
        const ANCHOR_A = `test-pendd-fixture-anchor-a-${stamp}`;
        const ANCHOR_B = `test-pendd-fixture-anchor-b-${stamp}`;
        const ANCHOR = `Pendd Anchor ${stamp}`;
        seedAdopter(ANCHOR_A, ANCHOR, requester.email, 20, String(Number(tail) + 1).padStart(3, '0').slice(-3));
        seedAdopter(ANCHOR_B, ANCHOR, requester.email, 1, String(Number(tail) + 2).padStart(3, '0').slice(-3));
        seedCandidate(`test-pendd-fixture-cand-anchor-${stamp}`, ANCHOR_B, ANCHOR_A);

        const requestRows = () => rows(
            `SELECT id, primary_id, secondary_id, requester_email, owner_email, candidate_id, status FROM merge_requests WHERE candidate_id = '${CAND}'`,
        );

        try {
            // ── The requester keeps hers → «Pedir combinar» → a request for that survivor.
            const page = requester.page;
            let row = await openRow(page, NAME);
            await row.getByTestId('dedup-keep-new').click();
            await expect(row.getByTestId('dedup-keep-new')).toHaveAttribute('aria-checked', 'true');
            const merge = row.getByTestId('dedup-merge');
            await expect(merge).toHaveText(/^(Request merge|Pedir combinar|Pedir para combinar)$/);
            await merge.click();
            await expect(page.getByText(/Request sent to|Pedido enviado a|Pedido enviado para/).first()).toBeVisible({ timeout: 30_000 });
            await expect(row).toHaveAttribute('data-group', 'sent', { timeout: 30_000 });
            await expect(row.getByTestId('dedup-cancel-request')).toBeVisible();

            await expect.poll(() => requestRows().length, { timeout: 30_000 }).toBe(1);
            const req = requestRows()[0];
            expect(req).toMatchObject({
                primary_id: MINE, secondary_id: THEIRS,
                requester_email: requester.email, owner_email: owner.email, status: 'pending',
            });
            const requestId = String(req.id);
            for (const id of [MINE, THEIRS]) {
                expect(isDbNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${id}'`)[0]?.deleted_at), `${id} not merged`).toBe(true);
            }

            // ── The owner: the row needing an answer opens by itself; «Rechazar».
            const ownerPage = owner.page;
            await ownerPage.goto('/my-adopters');
            await dismissCountryBanner(ownerPage);
            const received = ownerPage.getByTestId('dedup-row').filter({ has: ownerPage.getByTestId('dedup-decline-request') });
            await expect(received).toHaveCount(1, { timeout: 30_000 });
            await expect(received).toHaveAttribute('data-group', 'received');
            await received.getByTestId('dedup-decline-request').click();
            await expect.poll(() => requestRows()[0]?.status, { timeout: 30_000 }).toBe('declined');
            // D27: an owner's decline keeps the pair on the owner's list too.
            const ownerRow = ownerPage.getByTestId('dedup-row').filter({ hasText: NAME });
            await expect(ownerRow).toHaveAttribute('data-group', 'declined', { timeout: 30_000 });

            // ── The requester sees «Rechazado».
            row = await openRow(page, NAME); // a full load (a hash-only goto would keep the stale list)
            await expect(row).toHaveAttribute('data-group', 'declined');
            await expect(row.getByTestId('dedup-request-status')).toHaveText(/^(Declined by|Rechazado por|Recusado por) /);
            // D43: asking again is off; keeping theirs is on offer.
            await expect(row.getByTestId('dedup-merge')).toHaveText(/^(Merge keeping|Combinar conservando el de|Combinar mantendo o de) /);

            // ── «Escribirle»: a pair_message to the owner, replies going to the requester.
            await row.getByTestId('dedup-write').click();
            const write = page.getByTestId('dedup-write-dialog');
            await expect(write).toBeVisible({ timeout: 15_000 });
            await write.getByTestId('dedup-write-text').fill(`Hola, son la misma persona (${stamp})`);
            await write.getByTestId('dedup-write-send').click();
            await expect(write).toHaveCount(0, { timeout: 30_000 });
            await expect.poll(() => rows(
                `SELECT metadata FROM notifications WHERE user_id = '${owner.email}' AND type = 'pair_message' AND metadata LIKE '%${requestId}%'`,
            ).length, { timeout: 30_000 }).toBe(1);
            const message = rows(`SELECT metadata, body, url FROM notifications WHERE user_id = '${owner.email}' AND type = 'pair_message' AND metadata LIKE '%${requestId}%'`)[0];
            const meta = JSON.parse(String(message.metadata));
            expect(meta).toMatchObject({ requestId, replyTo: requester.email });
            expect(String(message.url)).toBe('/my-adopters#pendientes');

            // ── «Quitar de la lista»: gone from her list, and only hers.
            await row.getByTestId('dedup-hide').click();
            await expect(row).toHaveCount(0, { timeout: 30_000 });
            expect(rows(`SELECT pair_key FROM pending_pair_hidden WHERE viewer_email = '${requester.email}'`).map(r => r.pair_key))
                .toEqual([pairKey(MINE, THEIRS)]);
            await openRow(page, ANCHOR); // the list loaded…
            await expect(page.getByTestId('dedup-row').filter({ hasText: NAME })).toHaveCount(0); // …without the hidden pair

            await ownerPage.reload();
            await dismissCountryBanner(ownerPage);
            const toggle = ownerPage.locator('button[aria-controls="pending-dedup-list"]');
            await expect(toggle).toBeVisible({ timeout: 30_000 });
            if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
            await expect(ownerPage.getByTestId('dedup-row').filter({ hasText: NAME })).toHaveAttribute('data-group', 'declined', { timeout: 30_000 });
            expect(rows(`SELECT COUNT(*) AS n FROM pending_pair_hidden WHERE viewer_email = '${owner.email}'`)[0]?.n).toBe(0);
        } finally {
            await requester.close();
            await owner.close();
        }
    });

    test('different names that share a phone: «alguien de su hogar» links them, nothing is merged', async ({ browser }) => {
        test.setTimeout(180_000);
        const stamp = Date.now();
        const tail = String(stamp).slice(-3);
        const me = await rescuer(browser, 'h1', stamp);
        const OTHER = `pendd-h2-${stamp}@example.com`;
        const MINE = `test-pendd-fixture-hh-mine-${stamp}`;   // older, hers
        const THEIRS = `test-pendd-fixture-hh-other-${stamp}`; // newer, another rescuer's
        const CAND = `test-pendd-fixture-cand-hh-${stamp}`;
        const NAME_MINE = `Pendd Andrea ${stamp}`;
        const NAME_THEIRS = `Pendd Bruno ${stamp}`;
        seedAdopter(MINE, NAME_MINE, me.email, 30, tail);
        seedAdopter(THEIRS, NAME_THEIRS, OTHER, 0, tail);
        // A contact match, not a name match: «¿Es la misma persona?» is asked (D35).
        seedCandidate(CAND, THEIRS, MINE, '["phone"]');

        try {
            const page = me.page;
            const row = await openRow(page, NAME_MINE);
            await row.getByTestId('dedup-merge').click();
            const ask = page.getByTestId('dedup-identity-dialog');
            await expect(ask).toBeVisible({ timeout: 15_000 });
            await expect(ask.getByTestId('dedup-identity-same')).toBeVisible();
            await ask.getByTestId('dedup-identity-household').click();
            await expect(row).toHaveCount(0, { timeout: 30_000 });

            // Her profile lists the other person, linked to their profile; theirs is untouched.
            await expect.poll(() => {
                const raw = rows(`SELECT household_members FROM adopters WHERE id = '${MINE}'`)[0]?.household_members;
                if (isDbNull(raw)) return [];
                return (JSON.parse(String(raw)) as Array<{ name?: string; profileId?: string }>).map(m => ({ name: m.name, profileId: m.profileId }));
            }, { timeout: 30_000 }).toEqual([{ name: NAME_THEIRS, profileId: THEIRS }]);
            expect(isDbNull(rows(`SELECT household_members FROM adopters WHERE id = '${THEIRS}'`)[0]?.household_members), 'the other rescuer\'s profile is never edited').toBe(true);
            for (const id of [MINE, THEIRS]) {
                const a = rows(`SELECT deleted_at, token_hash FROM adopters WHERE id = '${id}'`)[0];
                expect(isDbNull(a?.deleted_at), `${id} not merged`).toBe(true);
                expect(a?.token_hash ?? null).not.toBe('MERGED');
            }
            expect(rows(`SELECT status FROM duplicate_candidates WHERE id = '${CAND}'`)[0]?.status).not.toBe('pending');
            expect(rows(`SELECT COUNT(*) AS n FROM merge_requests WHERE candidate_id = '${CAND}'`)[0]?.n).toBe(0);
        } finally {
            await me.close();
        }
    });
});
