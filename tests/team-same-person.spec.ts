import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { rows } from './db';

/**
 * Step 2 (Jon 2026-11-05: "the team acts as one"): a «¿misma persona?» pair where a
 * TEAMMATE loaded a side is the viewer's to answer — the profile bar offers
 * «Revisar», «Pendientes» lists it, «Mantener separados» settles it. Someone outside
 * the team sees the bar but cannot answer.
 *
 * Fixtures (tests/seed.sql, "STEP 2 — THE TEAM ANSWERS"): side A loaded by the admin,
 * side B by test-seed. Vero (e2e-teammate@example.com) is the admin's org-mate with
 * NO admin role — the admin persona would pass through its bypass and prove nothing.
 */

const SIDE_A = 'test-adopter-fixture-team-a';
const SIDE_B = 'test-adopter-fixture-team-b';
const PAIR = 'test-dup-fixture-team';
type Persona = { email: string; name: string; sub: string };
const VERO: Persona = { email: 'e2e-teammate@example.com', name: 'Vero E2E', sub: 'test-teammate-id' };
const OUTSIDER: Persona = { email: 'e2e-xorg-viewer@example.com', name: 'Vilma Xorg', sub: 'test-xorg-viewer-id' };

/** A signed session for a non-admin persona, built exactly like tests/auth.setup.ts. */
async function personaContext(browser: Browser, persona: Persona): Promise<BrowserContext> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET is required to sign the persona session (see .env.local).');
    const { encode } = await import('next-auth/jwt');
    const token = await encode({
        secret,
        token: { email: persona.email, name: persona.name, sub: persona.sub, sessionVersion: 3 },
        salt: 'authjs.session-token',
    });
    const context = await browser.newContext();
    await context.addCookies([{ name: 'authjs.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript((email: string) => {
        try {
            localStorage.setItem(`country_confirmed_${email}`, '1');
            localStorage.setItem('playwright_test_mode', '1');
        } catch { /* storage unavailable — tests anchor on content */ }
    }, persona.email);
    return context;
}

const status = () => rows(`SELECT status, resolved_by FROM duplicate_candidates WHERE id = '${PAIR}'`)[0];

test.describe.serial('step 2 — the team answers «¿misma persona?»', () => {
    test('outside the team: the bar informs, with no «Revisar»', async ({ browser }) => {
        test.setTimeout(90_000);
        const ctx = await personaContext(browser, OUTSIDER);
        try {
            const page = await ctx.newPage();
            await page.goto(`/adopter/${SIDE_A}`);
            await expect(page.getByTestId('profile-pending-dup')).toBeVisible({ timeout: 30_000 });
            await expect(page.getByTestId('profile-pending-dup-review')).toHaveCount(0);
        } finally { await ctx.close(); }
        expect(status()).toMatchObject({ status: 'pending' });
    });

    test("a teammate of the loader: «Revisar» → «Pendientes» → «Mantener separados» settles it", async ({ browser }) => {
        test.setTimeout(120_000);
        const ctx = await personaContext(browser, VERO);
        try {
            const page = await ctx.newPage();
            await page.goto(`/adopter/${SIDE_A}`);
            const review = page.getByTestId('profile-pending-dup-review');
            await expect(review).toBeVisible({ timeout: 30_000 });
            await review.click();
            await expect(page).toHaveURL(/\/my-adopters\?pair=/);
            const row = page.locator(`[data-testid="dedup-row"][data-candidate-id="${PAIR}"]`);
            await expect(row).toBeVisible({ timeout: 30_000 });
            await row.getByTestId('dedup-keep-separate').click();
            await expect(row).toHaveCount(0, { timeout: 30_000 });
            expect(status()).toMatchObject({ status: 'dismissed', resolved_by: VERO.email });
            // Gone everywhere: the profile no longer asks.
            await page.goto(`/adopter/${SIDE_B}`);
            await expect(page.getByRole('heading', { name: /Teodora Ekipofixture/ }).first()).toBeVisible({ timeout: 30_000 });
            await expect(page.getByTestId('profile-pending-dup')).toHaveCount(0);
        } finally { await ctx.close(); }
    });
});
