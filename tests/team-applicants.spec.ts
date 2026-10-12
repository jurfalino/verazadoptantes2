import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { execSync } from 'child_process';

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
/** Cross-org viewer: shares org-x1 with the animal owner, nothing with the form-link owner. */
const XORG_VIEWER = { email: 'e2e-xorg-viewer@example.com', name: 'Vilma Xorg', sub: 'test-xorg-viewer-id' };

/** The matched adopter's PII (owned by 'test-seed', outside every test team). */
const MATCH_PHONE = '4555-0377';
const MATCH_STREET = 'Calle Fixturera 77';
const MATCH_EMAIL = 'zulema.fixture@example.com';
/** The matched adopter's Instagram (stored as a URL; the applicant's free-text
 *  guess is «@Zulema.FX», so this string only appears if the entry is revealed). */
const MATCH_SOCIAL = 'instagram.com/zulema.fx';

type Persona = { email: string; name: string; sub: string };

/** A signed session for a non-admin persona, built exactly like tests/auth.setup.ts. */
async function personaContext(browser: Browser, persona: Persona = TEAMMATE): Promise<BrowserContext> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET is required to sign the persona session (see .env.local).');
    const { encode } = await import('next-auth/jwt');
    const token = await encode({
        secret,
        token: { email: persona.email, name: persona.name, sub: persona.sub, sessionVersion: 3 },
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
    }, persona.email);
    return context;
}
const teammateContext = (browser: Browser) => personaContext(browser, TEAMMATE);

/** Everything the server sends for a page: the SSR HTML (with the inlined RSC
 *  payload) and the RSC flight response a client navigation would fetch. */
async function serverPayload(ctx: BrowserContext, path: string): Promise<string> {
    const html = await (await ctx.request.get(path)).text();
    const rsc = await (await ctx.request.get(path, { headers: { RSC: '1' } })).text();
    return `${html}\n${rsc}`;
}

/** Read the local D1 dev DB the dev server writes to (same helper as adoption-docs.spec.ts). */
function queryD1(sql: string): Array<Record<string, unknown>> {
    const out = execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const wrapped = JSON.parse(out);
    const first = Array.isArray(wrapped) ? wrapped[0] : wrapped;
    return first?.results ?? [];
}
const isD1Null = (v: unknown) => v === null || v === 'null';

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
            // the teammate sees the same matched profile the owner does. (What its
            // contact details show is covered with PII gating on, below.)
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
            // A stranger gets the friendly 404 (never confirms the submission exists).
            await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 30000 });
            await expect(page.getByText(OUTSIDER_APPLICANT)).toHaveCount(0);

            await page.goto('/adopter/create?fromForm=test-sub-fixture-apl-outsider');
            await expect(page.getByPlaceholder(/name|nombre/i).first()).toBeVisible({ timeout: 30000 });
            await expect(page.getByPlaceholder(/name|nombre/i).first()).not.toHaveValue(OUTSIDER_APPLICANT);
        } finally {
            await ctx.close();
        }
    });

    test('PII gating OFF: the match card shows what the profile shows — everything', async ({ browser }) => {
        const ctx = await teammateContext(browser);
        try {
            const page = await ctx.newPage();
            await page.goto('/form-results/test-sub-fixture-apl-owner');
            await expect(page.getByText(MATCH_NAME).first()).toBeVisible({ timeout: 30000 });
            await expect(page.getByText(MATCH_EMAIL).first()).toBeVisible();
            await expect(page.getByText(MATCH_STREET).first()).toBeVisible();

            // /contract-results follows the same rule.
            await page.goto('/contract-results/test-notif-fixture-contract-mate');
            await expect(page.getByText(MATCH_EMAIL).first()).toBeVisible({ timeout: 30000 });
        } finally {
            await ctx.close();
        }
    });

    // Staging's rule (5d3b365a / 1ca90822, maskMatchCardsForViewer): a match
    // card shows what the profile shows this viewer, plus the entries equal to
    // the phone / email this applicant typed (phone: same number, ≥ 8 digits).
    // Free text never unlocks anything.
    test.describe('PII gating ON: match cards follow the profile screen, revealing only what the applicant typed', () => {
        test.beforeAll(() => {
            queryD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PII_ACCESS_GATING', 'true', strftime('%s','now'), 'e2e-team-applicants')`);
        });
        test.afterAll(() => {
            queryD1(`DELETE FROM app_config WHERE key = 'ENABLE_PII_ACCESS_GATING'`);
        });

        test('teammate: the phone the applicant typed is revealed; the email and street stay masked', async ({ browser }) => {
            // The owner-link applicant typed «4555 0377»; the matched adopter has
            // «4555-0377» (same number) plus an email and a street the applicant
            // never typed. The adopter is another rescuer's, so its profile is
            // masked for Vero.
            const ctx = await teammateContext(browser);
            try {
                const page = await ctx.newPage();
                await page.goto('/form-results/test-sub-fixture-apl-owner');
                await expect(page.getByText(MATCH_NAME).first()).toBeVisible({ timeout: 30000 });
                await expect(page.getByText(MATCH_PHONE).first()).toBeVisible();
                await expect(page.getByText(MATCH_EMAIL)).toHaveCount(0);
                await expect(page.getByText(MATCH_STREET)).toHaveCount(0);
                // Not just hidden: never sent (SSR HTML, inlined RSC, RSC flight).
                const payload = await serverPayload(ctx, '/form-results/test-sub-fixture-apl-owner');
                expect(payload).toContain(MATCH_PHONE);
                expect(payload).not.toContain(MATCH_EMAIL);
                expect(payload).not.toContain(MATCH_STREET);
                // The applicant pasted «@Zulema.FX» into a free-text answer (and the
                // notification even lists `social`): free text is never an oracle.
                expect(payload).toContain('@Zulema.FX');
                expect(payload).not.toContain(MATCH_SOCIAL);
            } finally {
                await ctx.close();
            }
        });

        test('form-link owner: same treatment — the phone they typed is revealed, nothing else', async ({ browser }) => {
            // Vero's OWN link (test-sub-fixture-apl-mate): the applicant typed
            // «4555 0377», Zulema's number, so that entry unlocks; her email,
            // street and Instagram were never typed and stay masked.
            const ctx = await teammateContext(browser);
            try {
                const page = await ctx.newPage();
                await page.goto('/form-results/test-sub-fixture-apl-mate');
                await expect(page.getByText(MATCH_NAME).first()).toBeVisible({ timeout: 30000 });
                await expect(page.getByText(MATCH_PHONE).first()).toBeVisible();
                await expect(page.getByText(MATCH_EMAIL)).toHaveCount(0);
                await expect(page.getByText(MATCH_STREET)).toHaveCount(0);
                const payload = await serverPayload(ctx, '/form-results/test-sub-fixture-apl-mate');
                expect(payload).toContain(MATCH_NAME);
                expect(payload).toContain(MATCH_PHONE);
                expect(payload).not.toContain(MATCH_EMAIL);
                expect(payload).not.toContain(MATCH_STREET);
                expect(payload).not.toContain(MATCH_SOCIAL);
            } finally {
                await ctx.close();
            }
        });

        test('/contract-results: the recipient sees the profile rule + only the matched, typed phone', async ({ browser }) => {
            const ctx = await teammateContext(browser);
            try {
                const page = await ctx.newPage();
                await page.goto('/contract-results/test-notif-fixture-contract-mate');
                await expect(page.getByText(MATCH_NAME).first()).toBeVisible({ timeout: 30000 });
                await expect(page.getByText(MATCH_PHONE).first()).toBeVisible();
                await expect(page.getByText(MATCH_EMAIL)).toHaveCount(0);
                const payload = await serverPayload(ctx, '/contract-results/test-notif-fixture-contract-mate');
                expect(payload).toContain(MATCH_NAME);
                expect(payload).toContain(MATCH_PHONE);
                expect(payload).not.toContain(MATCH_EMAIL);
                expect(payload).not.toContain(MATCH_SOCIAL);
            } finally {
                await ctx.close();
            }
        });

        test('admin (form-link owner here): sees everything, as on the profile screen', async ({ browser }) => {
            // Positive control: the fixture really carries the email and street,
            // and an admin's profile view is unmasked.
            const ctx = await browser.newContext({ storageState: '.auth/admin.json' });
            try {
                const page = await ctx.newPage();
                await page.goto('/form-results/test-sub-fixture-apl-owner');
                await expect(page.getByText(MATCH_NAME).first()).toBeVisible({ timeout: 30000 });
                await expect(page.getByText(MATCH_PHONE).first()).toBeVisible();
                await expect(page.getByText(MATCH_EMAIL).first()).toBeVisible();
                await expect(page.getByText(MATCH_STREET).first()).toBeVisible();
                await expect(page.getByText(MATCH_SOCIAL).first()).toBeVisible();
            } finally {
                await ctx.close();
            }
        });
    });

    test('a teammate cannot link the outsider\'s submission (create-from-form flow)', async ({ browser }) => {
        const ctx = await teammateContext(browser);
        try {
            const page = await ctx.newPage();
            const name = `Vinculo Ajeno ${Date.now()}`;
            await page.goto('/adopter/create?fromForm=test-sub-fixture-apl-outsider');
            await page.getByPlaceholder(/name|nombre/i).first().fill(name);
            await page.getByTestId('adopter-form-submit').click();
            const createAnyway = page.getByRole('button', { name: /Create new profile anyway|Crear perfil nuevo/i });
            try {
                await createAnyway.waitFor({ state: 'visible', timeout: 3000 });
                await createAnyway.click();
            } catch { /* no duplicate modal */ }
            // The save (and the link attempt it awaits) is done once we land on the profile.
            await expect(page).not.toHaveURL(/\/create/, { timeout: 30000 });

            const [row] = queryD1(`SELECT linked_adopter_id, status FROM form_submissions WHERE id = 'test-sub-fixture-apl-outsider'`);
            expect(row, 'the outsider fixture row must exist').toBeTruthy();
            expect(isD1Null(row.linked_adopter_id), `outsider submission must stay unlinked (got ${JSON.stringify(row.linked_adopter_id)})`).toBe(true);
            expect(row.status).toBe('pending');
        } finally {
            await ctx.close();
        }
    });

    test('cross-org: a viewer in one of the owner\'s groups opens the applicant from the owner\'s OTHER group', async ({ browser }) => {
        // O shares org-x1 with V (the viewer) and org-x2 with T (the form-link
        // owner); V and T share nothing. Access must come from the ANIMAL
        // OWNER's team — V's own team does not contain T.
        const ctx = await personaContext(browser, XORG_VIEWER);
        try {
            const page = await ctx.newPage();

            // The animal page lists T's-link applicant (and not the outsider's)…
            await page.goto('/my-animals/test-animal-fixture-xorg');
            await expect(page.getByTestId('animal-name')).toHaveText('Brisa', { timeout: 30000 });
            const block = page.locator('#applicants');
            await block.getByRole('button', { name: /^\W*1 (interested applicant|persona interesada|pessoa interessada)/i }).click();
            await expect(block.getByText('Postulante Crucefixture')).toBeVisible();
            await expect(block.getByText('Postulante Ajenafixture')).toHaveCount(0);

            // …so /form-results for it opens too.
            await page.goto('/form-results/test-sub-fixture-xorg-mate');
            await expect(page.getByRole('heading', { name: /Form responses|Respuestas del formulario|Respostas do formulário/ })).toBeVisible({ timeout: 30000 });
            await expect(page.getByText('Postulante Crucefixture').first()).toBeVisible();
            await expect(page.getByText(FORBIDDEN)).toHaveCount(0);

            // The outsider-link row for the same animal stays forbidden (404).
            await page.goto('/form-results/test-sub-fixture-xorg-outsider');
            await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 30000 });
            await expect(page.getByText('Postulante Ajenafixture')).toHaveCount(0);
        } finally {
            await ctx.close();
        }
    });

    test('teammates\' bell names the animal when the form targeted one', async ({ request }) => {
        // Through the admin's form link, for the teammate's animal «Nube»
        // (not Lupa, whose applicant counts other tests assert). Vero is the
        // admin's org-mate, so she gets the fan-out copy.
        const name = `Valeria Fixturebell ${Date.now()}`;
        const res = await request.post('/api/form/test-admin-id/submit', {
            data: { name, email: `bell-${Date.now()}@example.com`, phone: `11${Date.now() % 100000000}`, address: `${Date.now()} Bell St`, animalId: 'test-animal-fixture-2' },
        });
        const body = await res.text();
        expect(res.ok(), `submit failed: ${body}`).toBeTruthy();
        const { submissionId } = JSON.parse(body) as { submissionId: string };

        // The fan-out runs after the response (runAfterResponse) — poll for it.
        await expect.poll(() => queryD1(
            `SELECT title FROM notifications WHERE user_id = '${TEAMMATE.email}' AND json_extract(metadata, '$.submissionId') = '${submissionId}'`,
        ).map(r => String(r.title)), { timeout: 30000, intervals: [1000] }).toHaveLength(1);
        const [{ title }] = queryD1(
            `SELECT title FROM notifications WHERE user_id = '${TEAMMATE.email}' AND json_extract(metadata, '$.submissionId') = '${submissionId}'`,
        );
        // The owner's wording, word for word (a match-count suffix appears when
        // earlier local runs left look-alike adopters behind).
        expect(String(title)).toMatch(new RegExp(`^${name} aplicó para Nube( — \\d+ coincidencias?)?$`));
        const [ownerRow] = queryD1(
            `SELECT title FROM notifications WHERE user_id = 'gatitosolivos@gmail.com' AND json_extract(metadata, '$.submissionId') = '${submissionId}'`,
        );
        expect(title).toBe(ownerRow.title);

        const [row] = queryD1(
            `SELECT json_extract(metadata, '$.selectedAnimalId') AS animalId, json_extract(metadata, '$.selectedAnimalName') AS animalName ` +
            `FROM notifications WHERE user_id = '${TEAMMATE.email}' AND json_extract(metadata, '$.submissionId') = '${submissionId}'`,
        );
        expect(row).toMatchObject({ animalId: 'test-animal-fixture-2', animalName: 'Nube' });
    });

    test('without an animal, teammates keep the generic title', async ({ request }) => {
        const name = `Generico Fixturebell ${Date.now()}`;
        const res = await request.post('/api/form/test-admin-id/submit', {
            data: { name, email: `bell-gen-${Date.now()}@example.com`, phone: `12${Date.now() % 100000000}`, address: `${Date.now()} Bell St` },
        });
        expect(res.ok()).toBeTruthy();
        const { submissionId } = await res.json() as { submissionId: string };
        await expect.poll(() => queryD1(
            `SELECT title FROM notifications WHERE user_id = '${TEAMMATE.email}' AND json_extract(metadata, '$.submissionId') = '${submissionId}'`,
        ).map(r => r.title), { timeout: 30000, intervals: [1000] }).toEqual(['Nueva respuesta al formulario']);
    });

    test('a forged ?animal= row never names another team\'s animal to teammates', async ({ request }) => {
        // Through the admin's link, for «Brisa» — owned by the xorg owner, who is
        // NOT in the admin's team. The admin's own copy is unchanged; Vero's
        // (the admin's org-mate) gets the generic title and no animal.
        const name = `Forjado Fixturebell ${Date.now()}`;
        const res = await request.post('/api/form/test-admin-id/submit', {
            data: { name, email: `forged-${Date.now()}@example.com`, phone: `13${Date.now() % 100000000}`, address: `${Date.now()} Forged St`, animalId: 'test-animal-fixture-xorg' },
        });
        expect(res.ok()).toBeTruthy();
        const { submissionId } = await res.json() as { submissionId: string };
        const teammateRow = () => queryD1(
            `SELECT title, json_extract(metadata, '$.selectedAnimalName') AS animalName, json_extract(metadata, '$.selectedAnimalId') AS animalId ` +
            `FROM notifications WHERE user_id = '${TEAMMATE.email}' AND json_extract(metadata, '$.submissionId') = '${submissionId}'`,
        );
        await expect.poll(() => teammateRow().length, { timeout: 30000, intervals: [1000] }).toBe(1);
        const [row] = teammateRow();
        expect(row.title).toBe('Nueva respuesta al formulario');
        expect(isD1Null(row.animalName)).toBe(true);
        expect(isD1Null(row.animalId)).toBe(true);
        expect(String(row.title)).not.toContain('Brisa');
    });
});
