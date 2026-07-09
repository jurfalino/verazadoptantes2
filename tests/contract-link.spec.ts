import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Test-isolated fixture adopter — created here, mutated only by this test.
 * We deliberately do NOT merge into seed adopters (María / Roberto / etc.) because
 * other test specs assert on those adopters' contactInfo / phone counts; a merge
 * would append duplicate contact data and break unrelated tests downstream.
 */
const FIXTURE_ADOPTER_ID = 'test-contract-fixture-target';
const FIXTURE_ADOPTER_NAME = 'ContractFixturePerson Sintética';

/**
 * Execute a single SQL statement against the local D1 dev DB via wrangler.
 * Used here to seed an "available" animal fixture and assert orphan soft-deletion
 * after the merge — neither operation has a public app endpoint we can hit from a
 * browser context. Slow (~5s per call) but acceptable for the small number of
 * setup/assertion calls this test makes.
 */
function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}

/** Parse `[{ results: [...] }]`-style wrangler JSON output. */
function parseD1Rows(output: string): Array<Record<string, unknown>> {
    try {
        const wrapped = JSON.parse(output);
        const first = Array.isArray(wrapped) ? wrapped[0] : wrapped;
        return first?.results ?? [];
    } catch {
        return [];
    }
}

test.describe('Contract-results merge — "Es la misma persona"', () => {
    test('signing a contract for a fuzzy-matched person and confirming the merge attaches the adoption to the existing profile and soft-deletes the orphan', async ({ browser }) => {
        // Unique animal id per run so the test is idempotent (the fixture row stays
        // in DB after the test as residual data; that's fine for a dev/CI environment).
        const animalId = `test-animal-contract-${Date.now()}`;

        // 1a. Seed an "available" animal record owned by the admin user. The contract
        // submit endpoint requires this row to exist (and to have adopter_id IS NULL).
        // Normalized model: an "available" animal is an animals row with no active
        // placement (adopter_id IS NULL via the adoptions compat view). The contract
        // submit then opens an adoption placement on it.
        execD1(
            `INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) ` +
            `VALUES ('${animalId}', 'Test Pet for Contract', 'dog', 'E2E fixture', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now'))`,
        );

        // 1b. Reset the fixture adopter to a clean state. INSERT OR REPLACE ensures
        // idempotency across runs — prior runs may have appended contract data to
        // the fixture's contactInfo, this restores it. Also clears deleted_at so a
        // prior failed run that orphaned the fixture itself doesn't break this run.
        execD1(
            `INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, token_hash, created_at, updated_at) ` +
            `VALUES ('${FIXTURE_ADOPTER_ID}', '${FIXTURE_ADOPTER_NAME}', 'E2E fixture contact', 'AR', '5', 'gatitosolivos@gmail.com', NULL, NULL, strftime('%s','now'), strftime('%s','now'))`,
        );

        // 1c. Tokens for fuzzy matching. The matcher's prefix-LIKE on name_word tokens
        // (findAdopters.ts:239) requires these to be present. Stable IDs + INSERT OR
        // REPLACE keeps the table clean across runs.
        execD1(`INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES ('test-tok-fc-1', '${FIXTURE_ADOPTER_ID}', 'name_word', 'contractfixtureperson')`);
        execD1(`INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES ('test-tok-fc-2', '${FIXTURE_ADOPTER_ID}', 'name_word', 'sintetica')`);

        // Context A: admin (rescuer who registered the animal). Receives the
        // contract-result notification when the matcher fires.
        const contextA = await browser.newContext({ storageState: '.auth/admin.json' });
        const pageA = await contextA.newPage();
        await pageA.goto('/');
        await dismissCountryBanner(pageA);

        // Context B: anonymous Vite-app submitting the contract.
        const contextB = await browser.newContext();

        // 2. POST the contract with data designed to fuzzy-match ONLY the test fixture
        // (no phone/email/dni — name-only matching is enough since the fixture has
        // unique name_word tokens not shared with any seed adopter). This keeps the
        // merge isolated to FIXTURE_ADOPTER_ID and avoids polluting seed adopters'
        // contactInfo (which other test specs assert on).
        // The route requires a `screenshot` data URL — we pass a minimal 1×1 transparent
        // PNG so the R2 upload step succeeds; the document content is irrelevant.
        const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        const submitResponse = await contextB.request.post(`/api/contract/${animalId}/submit`, {
            data: {
                name: 'ContractFixturePerson',
                lastName: 'Sintética',
                screenshot: TINY_PNG,
            },
        });
        const submitBody = await submitResponse.text();
        expect(submitResponse.ok(), `Contract submit failed: ${submitBody}`).toBeTruthy();
        const submitResult = JSON.parse(submitBody);
        expect(submitResult.success).toBe(true);
        const orphanAdopterId: string = submitResult.adopterId;
        expect(orphanAdopterId).toBeTruthy();

        // 3. Poll the DB for the contract-result notification. The matcher runs
        // fire-and-forget after the submit response, so we have to wait for it.
        // Polling DB is more reliable than clicking through the bell UI which has
        // its own rendering / timing quirks.
        let notificationId: string | undefined;
        await expect(async () => {
            const rows = parseD1Rows(execD1(
                `SELECT id FROM notifications WHERE user_id = 'gatitosolivos@gmail.com' AND type = 'contract_result' AND metadata LIKE '%${orphanAdopterId}%' ORDER BY created_at DESC LIMIT 1`,
            ));
            expect(rows.length, 'Expected a contract_result notification for the orphan adopter').toBe(1);
            notificationId = rows[0]?.id as string;
            expect(notificationId).toBeTruthy();
        }).toPass({ timeout: 60000, intervals: [2000, 3000, 5000] });

        // 4. Navigate to the contract-results page and confirm the fixture is shown as a match.
        await pageA.goto(`/contract-results/${notificationId!}`);
        await dismissCountryBanner(pageA);
        await expect(pageA.getByText(FIXTURE_ADOPTER_NAME).first()).toBeVisible({ timeout: 30000 });

        // 5. Click "Es la misma persona" — opens the confirmation modal.
        const sameButton = pageA.getByRole('button', { name: /Es la misma persona|Same person/i }).first();
        await expect(sameButton).toBeVisible({ timeout: 30000 });
        await sameButton.click();

        // 6. Confirm in modal.
        const confirmButton = pageA.getByRole('button', { name: /Confirmar atribución|Confirm attachment/i });
        await expect(confirmButton).toBeVisible({ timeout: 10000 });
        await confirmButton.click();

        // 7. Page should redirect to the fixture adopter profile (the merge target).
        await expect(pageA).toHaveURL(new RegExp(`/adopter/${FIXTURE_ADOPTER_ID}`), { timeout: 30000 });

        // 8. The fixture's profile should now show the contract's adoption record.
        await expect(pageA.getByText('Test Pet for Contract').first()).toBeVisible({ timeout: 30000 });

        // 9. DB-level assertion: the orphan adopter is soft-deleted (has deleted_at set).
        const orphanRows = parseD1Rows(execD1(`SELECT deleted_at FROM adopters WHERE id = '${orphanAdopterId}'`));
        expect(orphanRows.length, 'Orphan adopter row should exist (soft-deleted, not hard-deleted)').toBe(1);
        expect(orphanRows[0]?.deleted_at, 'Orphan adopter should be soft-deleted').not.toBeNull();

        // 10. The animal's adoption record should now point at the fixture, not the orphan.
        const adoptionRows = parseD1Rows(execD1(`SELECT adopter_id FROM adoptions WHERE id = '${animalId}'`));
        expect(adoptionRows[0]?.adopter_id).toBe(FIXTURE_ADOPTER_ID);

        // 11. The orphan's duplicate_tokens should be cleaned up.
        const tokenRows = parseD1Rows(execD1(`SELECT COUNT(*) as cnt FROM duplicate_tokens WHERE adopter_id = '${orphanAdopterId}'`));
        expect(Number(tokenRows[0]?.cnt ?? -1), 'Orphan duplicate_tokens should have been deleted').toBe(0);
    });
});
