import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { execD1, parseD1Rows } from './db';

/**
 * /contract-results asks "same person?" from the new profile's OPEN PAIRS (spec
 * .agents/plans/2026-11-05-form-matches-are-duplicates.md), and «No es esta
 * persona» answers the pair for everyone. Own fixture rows only (setup copied
 * from contract-link.spec.ts, with a unique name per run).
 */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('contract: «No es esta persona» is saved for the pair and the card stays gone', async ({ browser }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const word = `oneanswerc${String(stamp).slice(-7)}`;
    const fixtureId = `test-contract-oneanswer-fixture-${stamp}`;
    const fixtureName = `${word} Sintetica`;
    const animalId = `test-animal-contract-oneanswer-${stamp}`;
    execD1(`INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) VALUES ('${animalId}', 'Test Pet One Answer', 'dog', 'E2E fixture', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now'))`);
    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, token_hash, created_at, updated_at) VALUES ('${fixtureId}', '${fixtureName}', 'E2E fixture contact', 'AR', '5', 'gatitosolivos@gmail.com', NULL, NULL, strftime('%s','now'), strftime('%s','now'))`);
    execD1(`INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES ('test-tok-oa-${stamp}-1', '${fixtureId}', 'name_word', '${word}')`);
    execD1(`INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES ('test-tok-oa-${stamp}-2', '${fixtureId}', 'name_word', 'sintetica')`);

    const ctxA = await browser.newContext({ storageState: '.auth/admin.json' });
    const ctxB = await browser.newContext();
    try {
        const res = await ctxB.request.post(`/api/contract/${animalId}/submit`, { data: { name: word, lastName: 'Sintética', screenshot: TINY_PNG } });
        const body = await res.text();
        expect(res.ok(), body).toBeTruthy();
        const orphanId: string = JSON.parse(body).adopterId;

        let notificationId = '';
        await expect(async () => {
            const r = parseD1Rows(execD1(`SELECT id FROM notifications WHERE user_id = 'gatitosolivos@gmail.com' AND type = 'contract_result' AND metadata LIKE '%${orphanId}%' ORDER BY created_at DESC LIMIT 1`));
            expect(r.length).toBe(1);
            notificationId = String(r[0].id);
        }).toPass({ timeout: 60_000, intervals: [2000, 3000, 5000] });

        const page = await ctxA.newPage();
        await page.goto(`/contract-results/${notificationId}`);
        await dismissCountryBanner(page);
        await expect(page.getByText(fixtureName).first()).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('contract-match-not-this').first().click();
        await expect(async () => {
            const r = parseD1Rows(execD1(`SELECT status FROM duplicate_candidates WHERE (adopter1_id = '${orphanId}' AND adopter2_id = '${fixtureId}') OR (adopter1_id = '${fixtureId}' AND adopter2_id = '${orphanId}')`));
            expect(r[0]?.status).toBe('dismissed');
        }).toPass({ timeout: 30_000 });
        await page.reload();
        await expect(page.getByTestId('contract-match-not-this')).toHaveCount(0, { timeout: 30_000 });
    } finally {
        await ctxA.close();
        await ctxB.close();
    }
});
