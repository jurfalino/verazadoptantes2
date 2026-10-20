import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Layout of the form answers on /form-results (Reel 06 re-recording): a long
 * label («Compromiso de castración/esterilización:») squeezed its short value
 * to one letter wide — «No» broke into «N / o» — and values started at a
 * different x on every row. The label column now has its own track and wraps;
 * values share one column; an email breaks after «@» / «.», never mid-word.
 *
 * Measured, not eyeballed, at 390 and 1280, in Spanish (the default locale and
 * the longest labels). Runs under `authed`: the admin owns forms sent to
 * test-admin-id. Its own submission per run; removed at the end.
 */

const ADMIN_USER_ID = 'test-admin-id';
const LONG_LABEL = 'Compromiso de castración/esterilización:';
const EMAIL = 'diego.ruiz@ejemplo.com.ar';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}

type RowBox = { label: string; labelW: number; valueX: number; valueW: number; valueH: number; lineH: number };

/** Every answer row in the "Respuestas completas" section: label text + the value cell's box. */
async function measureRows(page: Page): Promise<RowBox[]> {
    return page.evaluate(() => {
        const out: RowBox[] = [];
        const labels = Array.from(document.querySelectorAll('span.font-semibold.text-stone-600'))
            .filter(el => /:\s*$/.test(el.textContent || ''));
        for (const label of labels) {
            const value = label.nextElementSibling as HTMLElement | null;
            if (!value) continue;
            const lb = label.getBoundingClientRect();
            const vb = value.getBoundingClientRect();
            const lineH = parseFloat(getComputedStyle(value).lineHeight) || 16;
            out.push({ label: (label.textContent || '').trim(), labelW: Math.round(lb.width), valueX: Math.round(vb.left), valueW: Math.round(vb.width), valueH: Math.round(vb.height), lineH: Math.round(lineH) });
        }
        return out;
    });
}

/** Screenshot of one element, scrolled clear of the sticky nav. */
async function crop(page: Page, el: ReturnType<Page['locator']>, path: string) {
    await el.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -96));
    const box = await el.boundingBox();
    if (box) await page.screenshot({ path, clip: box });
}

for (const width of [390, 1280]) {
    test(`form answers at ${width}px: long labels wrap, short values stay whole, values line up`, async ({ page, request }) => {
        test.setTimeout(120_000);
        const stamp = Date.now();
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, {
            data: {
                name: `Layout Diego ${stamp}`, email: EMAIL, phone: `+54911${String(stamp).slice(-8)}`,
                address: 'Av. Siempre Viva 742, Rosario', intent: 'self',
                willingToSterilize: 'no', species: 'cat', lifeStage: 'adult', vetCommitment: true,
                motivation: 'Quiero darle un hogar tranquilo a un gato adulto que necesite compañía.',
                ageRange: '36-45', legal: true,
            },
        });
        const body = await res.text();
        expect(res.ok(), body).toBeTruthy();
        const { submissionId } = JSON.parse(body) as { submissionId: string };
        try {
            await page.addInitScript(() => { try { localStorage.setItem('app-locale', 'es'); } catch { /* private mode */ } });
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`/form-results/${submissionId}`);
            await dismissCountryBanner(page);
            await expect(page.getByText(LONG_LABEL)).toBeVisible({ timeout: 30_000 });

            const rows = await measureRows(page);
            const page_ = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
            console.log(`LAYOUT ${width}`, JSON.stringify({ page: page_, rows }));
            // A crop of the answers for the record (test-results/ is not tracked).
            await crop(page, page.getByText(LONG_LABEL).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]'), `test-results/answer-layout-${width}.png`);
            await crop(page, page.getByText(EMAIL).first().locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]'), `test-results/answer-layout-adopter-${width}.png`);

            // No horizontal page scroll.
            expect(page_.scrollW).toBeLessThanOrEqual(page_.clientW);
            // The long label's value has room, and «No» sits on one line.
            const sterilize = rows.find(r => r.label === LONG_LABEL)!;
            expect(sterilize, 'long-label row').toBeTruthy();
            expect(sterilize.valueW).toBeGreaterThanOrEqual(width < 640 ? 120 : 200);
            expect(sterilize.valueH).toBeLessThanOrEqual(sterilize.lineH * 1.5);
            // One value column: every value starts at the same x (±1px).
            const xs = [...new Set(rows.map(r => r.valueX))];
            expect(Math.max(...xs) - Math.min(...xs), `value x: ${xs.join(', ')}`).toBeLessThanOrEqual(1);
            // The email breaks only after «@» or «.» (break opportunities in the DOM).
            const emailCell = page.locator('[data-answer-kind="email"]').first();
            await expect(emailCell).toContainText(EMAIL);
            expect(await emailCell.locator('wbr').count()).toBeGreaterThan(0);
            // …and never inside the domain: the text after the last <wbr> is the whole domain.
            expect(await emailCell.evaluate(el => (el.lastChild?.textContent ?? ''))).toBe('ejemplo.com.ar');
        } finally {
            // The submission auto-created a profile: remove both.
            const w = JSON.parse(execD1(`SELECT auto_adopter_id AS a FROM form_submissions WHERE id = '${submissionId}'`));
            const auto = ((Array.isArray(w) ? w[0] : w)?.results ?? [])[0]?.a as string | undefined;
            execD1(`DELETE FROM form_submissions WHERE id = '${submissionId}'`);
            if (auto && auto !== 'null') {
                execD1(`DELETE FROM duplicate_tokens WHERE adopter_id = '${auto}'`);
                execD1(`DELETE FROM adopter_history WHERE adopter_id = '${auto}'`);
                execD1(`DELETE FROM adopters WHERE id = '${auto}'`);
            }
        }
    });
}

// The applicant panel (animal page → interesadas → a person → «Todas las
// respuestas») renders the same rows in a 32rem drawer: the label track follows
// the CARD's width (container query), not the viewport's.
for (const width of [390, 1280]) {
    test(`applicant panel answers at ${width}px use the same aligned columns`, async ({ page, request }) => {
        test.setTimeout(120_000);
        const stamp = Date.now();
        const animalId = `test-animal-answers-${stamp}`;
        execD1(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('${animalId}', 'Panel${stamp}', 'cat', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now'))`);
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, {
            data: {
                name: `Panel Diego ${stamp}`, email: EMAIL, phone: `+54911${String(stamp).slice(-8)}`, intent: 'self', animalId,
                willingToSterilize: 'no', species: 'cat', vetCommitment: true, legal: true,
            },
        });
        const body = await res.text();
        expect(res.ok(), body).toBeTruthy();
        const { submissionId } = JSON.parse(body) as { submissionId: string };
        try {
            await page.addInitScript(() => { try { localStorage.setItem('app-locale', 'es'); } catch { /* private mode */ } });
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`/my-animals/${animalId}`);
            await dismissCountryBanner(page);
            await page.getByText(/1 persona interesada/).click({ timeout: 30_000 });
            await page.getByText(`Panel Diego ${stamp}`).first().click();
            await page.getByText(/Todas las respuestas/).click();
            await expect(page.getByText(LONG_LABEL)).toBeVisible({ timeout: 15_000 });
            const rows = await measureRows(page);
            console.log(`PANEL ${width}`, JSON.stringify(rows));
            const sterilize = rows.find(r => r.label === LONG_LABEL)!;
            expect(sterilize.valueW).toBeGreaterThanOrEqual(120);
            expect(sterilize.valueH).toBeLessThanOrEqual(sterilize.lineH * 1.5);
            const xs = [...new Set(rows.map(r => r.valueX))];
            expect(Math.max(...xs) - Math.min(...xs), `value x: ${xs.join(', ')}`).toBeLessThanOrEqual(1);
            await crop(page, page.getByText(LONG_LABEL).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]'), `test-results/answer-layout-panel-${width}.png`);
        } finally {
            const w = JSON.parse(execD1(`SELECT auto_adopter_id AS a FROM form_submissions WHERE id = '${submissionId}'`));
            const auto = ((Array.isArray(w) ? w[0] : w)?.results ?? [])[0]?.a as string | undefined;
            execD1(`DELETE FROM form_submissions WHERE id = '${submissionId}'`);
            if (auto && auto !== 'null') {
                execD1(`DELETE FROM duplicate_tokens WHERE adopter_id = '${auto}'`);
                execD1(`DELETE FROM adopter_history WHERE adopter_id = '${auto}'`);
                execD1(`DELETE FROM adopters WHERE id = '${auto}'`);
            }
            execD1(`DELETE FROM animals WHERE id = '${animalId}'`);
        }
    });
}

