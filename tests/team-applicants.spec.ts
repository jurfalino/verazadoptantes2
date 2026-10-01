import { test, expect, type Browser, type BrowserContext } from '@playwright/test';

/**
 * 2026-09-30 product decision: applicants (form submissions) of a team
 * animal are visible to the WHOLE team, not only to whoever's form link the
 * person used. Scope = the animal OWNER's team (owner + org-mates), so a row
 * whose form-link owner is outside that team — a forged
 * `/form?u=<stranger>&animal=<ours>` — never shows or counts.
 *
 * Fixtures (tests/seed.sql, "TEAM APPLICANTS FIXTURES"):
 *   test-animal-fixture-apl  «Lupa», owned by the admin (gatitosolivos@…)
 *   …-apl-owner   applicant via the owner's link
 *   …-apl-mate    applicant via the teammate's link (mixed-case user_id)
 *   …-apl-outsider applicant via an outsider's link — must stay hidden
 *   …-apl-link    owner-link submission, no animal, reserved for linking
 *
 * The positive teammate checks run as Vero (e2e-teammate@example.com), a
 * plain org-mate with NO admin role — the admin persona would pass through
 * its admin bypass and prove nothing about the org-mate rule.
 */

const ANIMAL_ID = 'test-animal-fixture-apl';
const OWNER_APPLICANT = 'Postulante Duenafixture';
const MATE_APPLICANT = 'Postulante Equipofixture';
const OUTSIDER_APPLICANT = 'Postulante Forasterafixture';
const MATCH_NAME = 'Zulema Coincidefixture';
const FORBIDDEN = /No tenés permiso|permission/i;
/** The applicants disclosure header — collapsed by default; the count is the
 *  first assertion that the scope is exactly owner-link + teammate-link. */
const TWO_APPLICANTS = /^\W*2 (interested applicants|personas interesadas|pessoas interessadas)/i;

const TEAMMATE = { email: 'e2e-teammate@example.com', name: 'Vero E2E', sub: 'test-teammate-id' };

/** A signed session for the teammate, built exactly like tests/auth.setup.ts. */
async function teammateContext(browser: Browser): Promise<BrowserContext> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET is required to sign the teammate session (see .env.local).');
    const { encode } = await import('next-auth/jwt');
    const token = await encode({
        secret,
        token: { email: TEAMMATE.email, name: TEAMMATE.name, sub: TEAMMATE.sub, sessionVersion: 3 },
        salt: 'authjs.session-token',
    });
    const context = await browser.newContext();
    await context.addCookies([{
        name: 'authjs.session-token', value: token,
        domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax',
    }]);
    await context.addInitScript((email: string) => {
        try {
            localStorage.setItem(`country_confirmed_${email}`, '1');
            localStorage.setItem('playwright_test_mode', '1');
        } catch { /* storage unavailable — the banner may show; tests anchor on content */ }
    }, TEAMMATE.email);
    return context;
}

test.describe('Team applicants: org-mates see the applicants of team animals', () => {

    test('a teammate (not the form-link owner) sees the applicants block and the card count', async ({ browser }) => {
        const ctx = await teammateContext(browser);
        try {
            const page = await ctx.newPage();
            await page.goto(`/my-animals/${ANIMAL_ID}`);
            await expect(page.getByTestId('animal-name')).toHaveText('Lupa', { timeout: 30000 });

            const block = page.locator('#applicants');
            await expect(block).toBeVisible({ timeout: 30000 });
            await block.getByRole('button', { name: TWO_APPLICANTS }).click();
            await expect(block.getByText(OWNER_APPLICANT)).toBeVisible();
            await expect(block.getByText(MATE_APPLICANT)).toBeVisible();
            // Negative: the outsider-link row targets the same animal but is out of scope.
            await expect(block.getByText(OUTSIDER_APPLICANT)).toHaveCount(0);

            await page.goto('/my-animals?view=available');
            const chip = page.getByTestId(`applicants-count-${ANIMAL_ID}`);
            await expect(chip).toBeVisible({ timeout: 30000 });
            await expect(chip).toHaveText(/^\s*2\s+(interesadas|interested|interessad)/i);
        } finally {
            await ctx.close();
        }
    });

    test('the owner also sees applicants who came through a teammate\'s link', async ({ browser }) => {
        const ctx = await browser.newContext({ storageState: '.auth/admin.json' });
        try {
            const page = await ctx.newPage();
            await page.goto(`/my-animals/${ANIMAL_ID}`);
            const block = page.locator('#applicants');
            await expect(block).toBeVisible({ timeout: 30000 });
            await block.getByRole('button', { name: TWO_APPLICANTS }).click();
            await expect(block.getByText(MATE_APPLICANT)).toBeVisible();
            await expect(block.getByText(OWNER_APPLICANT)).toBeVisible();
            await expect(block.getByText(OUTSIDER_APPLICANT)).toHaveCount(0);

            // The card count and the page use one scope: 2, never 3.
            const list = await (await page.request.get('/api/my-animals?view=available')).json() as Array<{ id: string; applicants?: unknown[] }>;
            const lupa = list.find(a => a.id === ANIMAL_ID);
            expect(lupa, 'Lupa must be in the owner\'s available list').toBeTruthy();
            expect(lupa!.applicants ?? []).toHaveLength(2);
        } finally {
            await ctx.close();
        }
    });

    test('a teammate can open /form-results for another member\'s form link, with the match data', async ({ browser }) => {
        const ctx = await teammateContext(browser);
        try {
            const page = await ctx.newPage();
            await page.goto('/form-results/test-sub-fixture-apl-owner');
            await expect(page.getByText(OWNER_APPLICANT).first()).toBeVisible({ timeout: 30000 });
            await expect(page.getByText(FORBIDDEN)).toHaveCount(0);
            // The duplicate-match data lives on the form-link owner's notification;
            // the teammate sees the same matched profile the owner does.
            await expect(page.getByText(MATCH_NAME).first()).toBeVisible({ timeout: 30000 });

            // «Crear adoptante» prefill works for the teammate too.
            await page.goto('/adopter/create?fromForm=test-sub-fixture-apl-owner');
            await expect(page.getByPlaceholder(/name|nombre/i).first()).toHaveValue(OWNER_APPLICANT, { timeout: 30000 });
        } finally {
            await ctx.close();
        }
    });

    test('a teammate can link another member\'s submission to the matched profile', async ({ browser }) => {
        const ctx = await teammateContext(browser);
        try {
            const page = await ctx.newPage();
            await page.goto('/form-results/test-sub-fixture-apl-link');
            await expect(page.getByText(MATCH_NAME).first()).toBeVisible({ timeout: 30000 });
            await page.getByRole('button', { name: /Link to this profile|Vincular a este perfil/i }).first().click();
            // Success navigates to the profile; a refused link toasts and stays.
            await expect(page).toHaveURL(/\/adopter\/test-adopter-fixture-apl-match/, { timeout: 30000 });

            // And the submission now reads as linked.
            await page.goto('/form-results/test-sub-fixture-apl-link');
            await expect(page.getByRole('link', { name: /View linked adopter profile|Ver perfil del adoptante vinculado|Ver perfil do adotante vinculado/i }).first())
                .toBeVisible({ timeout: 30000 });
        } finally {
            await ctx.close();
        }
    });

    test('an outsider\'s submission stays forbidden for the teammate', async ({ browser }) => {
        const ctx = await teammateContext(browser);
        try {
            const page = await ctx.newPage();
            await page.goto('/form-results/test-sub-fixture-apl-outsider');
            await expect(page.getByText(FORBIDDEN)).toBeVisible({ timeout: 30000 });
            await expect(page.getByText(OUTSIDER_APPLICANT)).toHaveCount(0);

            await page.goto('/adopter/create?fromForm=test-sub-fixture-apl-outsider');
            await expect(page.getByPlaceholder(/name|nombre/i).first()).toBeVisible({ timeout: 30000 });
            await expect(page.getByPlaceholder(/name|nombre/i).first()).not.toHaveValue(OUTSIDER_APPLICANT);
        } finally {
            await ctx.close();
        }
    });
});
