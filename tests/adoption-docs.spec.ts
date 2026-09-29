import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * API-level E2E for the custom adoption form + contract feature (Task 11).
 *
 * Reuses the wrangler-exec pattern from contract-link.spec.ts (no public
 * endpoint reads form_submissions / signed_contracts / adoption_doc_settings /
 * contract_versions directly) and the plain API-request pattern from
 * forms.spec.ts (POST /api/form/{userId}/submit as the Vite SPA does).
 *
 * Almost everything here is a pure API call. The one UI check (the
 * form-results page of test 1) uses bilingual regexes, so it is
 * locale-agnostic.
 */

/** Execute a single SQL statement against the local D1 dev DB via wrangler. */
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

/**
 * `wrangler d1 execute --local --json` serializes a SQL NULL as the literal
 * string "null" (verified empirically against this worktree's wrangler
 * version), not JSON null. Treat both as "the column is NULL" so assertions
 * read like the SQL they're checking.
 */
function isD1Null(v: unknown): boolean {
    return v === null || v === 'null';
}

// Seeded in tests/seed.sql: user.id -> email, used directly as the {userId}
// path param the contract-app's /api/form/{userId}/submit expects. No UI
// extraction needed at the API level (that round-trip is already covered by
// forms.spec.ts's "Share form link" test).
const ADMIN_USER_ID = 'test-admin-id';
// A second seeded account (tests/seed.sql) with no adoption_doc_settings row
// ever written for it by any spec — used as the "no settings" control so
// this file's own settings-row fixtures (test 5) can never taint it.
const NO_SETTINGS_USER_ID = 'test-user-id';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test.describe('Custom adoption form + contract — API-level', () => {

    test('an unasked question (specialNeeds hidden) is stored as NULL, not "no"', async ({ request, browser }) => {
        const name = `E2E Unasked ${Date.now()}`;
        const email = `e2e-unasked-${Date.now()}@example.com`;

        // No `specialNeeds` key at all — the contract-app never rendered that
        // step, so shownSteps (sent by a current build) omits it.
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, {
            data: {
                legal: true,
                name,
                email,
                phone: '555-0111',
                address: '1 E2E Ave',
                intent: 'self',
                shownSteps: ['legal', 'intent', 'identity-name', 'identity-email', 'identity-phone', 'identity-address'],
            },
        });
        const body = await res.text();
        expect(res.ok(), `submit failed: ${body}`).toBeTruthy();
        const { submissionId } = JSON.parse(body);
        expect(submissionId).toBeTruthy();

        const rows = parseD1Rows(execD1(
            `SELECT special_needs, shown_steps, answers_json FROM form_submissions WHERE id = '${submissionId}'`,
        ));
        expect(rows.length).toBe(1);
        expect(isD1Null(rows[0].special_needs), `special_needs must be NULL for a step never shown, not 0 (got ${JSON.stringify(rows[0].special_needs)})`).toBe(true);
        const shownSteps = JSON.parse(rows[0].shown_steps as string);
        expect(shownSteps).toContain('intent');
        expect(shownSteps).not.toContain('specialNeeds');
        // shownSteps has its own column — it is not an "answer".
        const answers = JSON.parse(rows[0].answers_json as string);
        expect(answers).not.toHaveProperty('shownSteps');
        expect(answers.intent).toBe('self');

        // The rescuer's results page shows no special-needs row at all for
        // the unasked question (not a "No"). Anchor on the answered intent
        // row first, so the negative check runs against a rendered panel.
        const rescuer = await browser.newContext({ storageState: '.auth/admin.json' });
        try {
            const page = await rescuer.newPage();
            await page.goto(`/form-results/${submissionId}`);
            await expect(page.getByText(name).first()).toBeVisible({ timeout: 30000 });
            await expect(page.getByText(/Para sí mismo|For themselves|Para si mesmo/).first()).toBeVisible({ timeout: 30000 });
            await expect(page.getByText(/necesidades especiales|special.needs|necessidades especiais/i)).toHaveCount(0);
        } finally {
            await rescuer.close();
        }
    });

    test('old client behaviour unchanged: no shownSteps, no animalId, specialNeeds answered = 1', async ({ request }) => {
        const name = `E2E OldClient ${Date.now()}`;
        const email = `e2e-oldclient-${Date.now()}@example.com`;

        // Mirrors a pre-Task-11 contract-app build: no shownSteps key, no
        // animalId, and an explicit specialNeeds answer.
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, {
            data: {
                name,
                email,
                phone: '555-0112',
                address: '2 E2E Ave',
                specialNeeds: true,
            },
        });
        const body = await res.text();
        expect(res.ok(), `submit failed: ${body}`).toBeTruthy();
        const { submissionId } = JSON.parse(body);
        expect(submissionId).toBeTruthy();

        const rows = parseD1Rows(execD1(
            `SELECT special_needs, shown_steps FROM form_submissions WHERE id = '${submissionId}'`,
        ));
        expect(rows.length).toBe(1);
        // D1/SQLite returns integer columns as numbers via wrangler's --json.
        expect(Number(rows[0].special_needs)).toBe(1);
        expect(isD1Null(rows[0].shown_steps), 'an old client sends no shownSteps at all').toBe(true);
    });

    test('GET /api/form/{userId} returns formConfig: null for a user with no adoption_doc_settings row', async ({ request }) => {
        const res = await request.get(`/api/form/${NO_SETTINGS_USER_ID}`);
        const body = await res.text();
        expect(res.ok(), `GET failed: ${body}`).toBeTruthy();
        const json = JSON.parse(body);
        expect(json.valid).toBe(true);
        expect(json.formConfig).toBeNull();
    });

    test('contract signing records the signed version (standardVersion + via=open)', async ({ request }) => {
        const animalId = `test-animal-docs-e2e-contract-${Date.now()}`;

        // Seed an "available" animal owned by the admin — same fixture shape
        // contract-link.spec.ts uses (no active placement => adopterId IS NULL
        // via the `adoptions` compat view, which /api/contract/{id}/submit requires).
        execD1(
            `INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) ` +
            `VALUES ('${animalId}', 'Test Pet Docs E2E', 'dog', 'E2E fixture', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now'))`,
        );

        const res = await request.post(`/api/contract/${animalId}/submit`, {
            data: {
                name: 'AdoptionDocsE2E',
                lastName: `Signer${Date.now()}`,
                email: `e2e-signer-${Date.now()}@example.com`,
                phone: '555-0113',
                screenshot: TINY_PNG,
                standardVersion: 'test1234',
                locale: 'es',
            },
        });
        const body = await res.text();
        expect(res.ok(), `contract submit failed: ${body}`).toBeTruthy();
        const result = JSON.parse(body);
        expect(result.success).toBe(true);

        const rows = parseD1Rows(execD1(
            `SELECT standard_version, via, contract_version_id FROM signed_contracts WHERE animal_id = '${animalId}'`,
        ));
        expect(rows.length, 'expected exactly one signed_contracts row for this animal').toBe(1);
        expect(rows[0].standard_version).toBe('test1234');
        expect(rows[0].via).toBe('open');
        expect(isD1Null(rows[0].contract_version_id)).toBe(true);
    });

    test('flag on + a saved settings row resolves customContract on GET /api/contract/{id}', async ({ request }) => {
        // Guard: getFeatureFlag checks process.env first, then app_config
        // (tests/seed.sql seeds ENABLE_CUSTOM_ADOPTION_DOCS='true'). Confirm the
        // flag is actually reachable in THIS DB before asserting resolution
        // behaviour that depends on it — skip with a clear reason instead of
        // failing on an environment gap unrelated to the feature.
        const flagRows = parseD1Rows(execD1(
            `SELECT value FROM app_config WHERE key = 'ENABLE_CUSTOM_ADOPTION_DOCS'`,
        ));
        const flagOn = flagRows.length > 0 && (flagRows[0].value === 'true' || flagRows[0].value === '1');
        test.skip(!flagOn, 'ENABLE_CUSTOM_ADOPTION_DOCS not reachable via app_config in this local E2E DB — skipping resolution test.');

        const rescuerEmail = 'test-adoption-docs-fixture@example.com';
        const animalId = `test-animal-docs-e2e-resolve-${Date.now()}`;
        const versionId = 'v-e2e';
        const sectionsJson = JSON.stringify({ '2': { type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'E2E' }] }] } });

        // Fixture rescuer owns this animal — no `user` row required:
        // resolveDocsForRescuer only needs the email string (see
        // src/lib/adoptionDocsRepo.ts / src/domain/adoptionDocs.ts:resolveDocsOwner).
        execD1(
            `INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) ` +
            `VALUES ('${animalId}', 'Test Pet Docs Resolve E2E', 'cat', 'E2E fixture', '${rescuerEmail}', strftime('%s','now'), strftime('%s','now'))`,
        );
        execD1(
            `INSERT OR REPLACE INTO contract_versions (id, owner_type, owner_id, sections_json, content_hash, created_at, created_by, first_signed_at, replaced_at) ` +
            `VALUES ('${versionId}', 'user', '${rescuerEmail}', '${sectionsJson.replace(/'/g, "''")}', 'test-hash-e2e', strftime('%s','now'), 'e2e', NULL, NULL)`,
        );
        execD1(
            `INSERT OR REPLACE INTO adoption_doc_settings (id, owner_type, owner_id, hidden_steps, contract_version_id, updated_at, updated_by) ` +
            `VALUES ('test-settings-docs-e2e', 'user', '${rescuerEmail}', NULL, '${versionId}', strftime('%s','now'), 'e2e')`,
        );

        const res = await request.get(`/api/contract/${animalId}`);
        const body = await res.text();
        expect(res.ok(), `GET /api/contract/${animalId} failed: ${body}`).toBeTruthy();
        const json = JSON.parse(body);
        expect(json.customContract).not.toBeNull();
        expect(json.customContract.versionId).toBe(versionId);
    });

    test('group source: an org member\'s animals use the group\'s form + contract; leaving the group falls back', async ({ request }) => {
        const flagRows = parseD1Rows(execD1(
            `SELECT value FROM app_config WHERE key = 'ENABLE_CUSTOM_ADOPTION_DOCS'`,
        ));
        const flagOn = flagRows.length > 0 && (flagRows[0].value === 'true' || flagRows[0].value === '1');
        test.skip(!flagOn, 'ENABLE_CUSTOM_ADOPTION_DOCS not reachable via app_config in this local E2E DB — skipping resolution test.');

        const run = Date.now();
        const userId = `test-docs-org-user-${run}`;
        const email = `test-docs-org-${run}@example.com`;
        const orgId = `test-docs-org-${run}`;
        const memberId = `test-docs-org-member-${run}`;
        const versionId = `test-docs-org-v-${run}`;
        const settingsId = `test-docs-org-settings-${run}`;
        const animalId = `test-animal-docs-org-${run}`;
        const signedAnimalId = `test-animal-docs-org-signed-${run}`;
        const foreignAnimalId = `test-animal-docs-org-foreign-${run}`;
        const sectionsJson = JSON.stringify({ '3': { type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'Org E2E' }] }] } });
        const insertAnimal = (id: string, addedBy: string) => execD1(
            `INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) ` +
            `VALUES ('${id}', 'Test Pet Docs Org E2E', 'dog', 'E2E fixture', '${addedBy}', strftime('%s','now'), strftime('%s','now'))`,
        );

        // A real rescuer account whose profile reads from the group, a member
        // of that group, and the group's settings row + contract version.
        execD1(`INSERT OR REPLACE INTO user (id, name, email) VALUES ('${userId}', 'Docs Org E2E', '${email}')`);
        execD1(`INSERT OR REPLACE INTO user_profiles (user_id, adoption_docs_source) VALUES ('${userId}', 'org:${orgId}')`);
        execD1(`INSERT OR REPLACE INTO organizations (id, name, created_by) VALUES ('${orgId}', 'Docs Org E2E ${run}', '${email}')`);
        execD1(`INSERT OR REPLACE INTO org_members (id, org_id, user_email) VALUES ('${memberId}', '${orgId}', '${email}')`);
        execD1(
            `INSERT OR REPLACE INTO contract_versions (id, owner_type, owner_id, sections_json, content_hash, created_at, created_by, first_signed_at, replaced_at) ` +
            `VALUES ('${versionId}', 'org', '${orgId}', '${sectionsJson.replace(/'/g, "''")}', 'test-hash-org-${run}', strftime('%s','now'), 'e2e', NULL, NULL)`,
        );
        execD1(
            `INSERT OR REPLACE INTO adoption_doc_settings (id, owner_type, owner_id, hidden_steps, contract_version_id, updated_at, updated_by) ` +
            `VALUES ('${settingsId}', 'org', '${orgId}', '["selfie"]', '${versionId}', strftime('%s','now'), 'e2e')`,
        );
        insertAnimal(animalId, email);
        insertAnimal(signedAnimalId, email);
        insertAnimal(foreignAnimalId, 'gatitosolivos@gmail.com');

        // 1. Public contract + form resolve to the GROUP's settings.
        const contractRes = await request.get(`/api/contract/${animalId}`);
        const contractBody = await contractRes.text();
        expect(contractRes.ok(), `GET /api/contract/${animalId} failed: ${contractBody}`).toBeTruthy();
        expect(JSON.parse(contractBody).customContract?.versionId).toBe(versionId);

        const formRes = await request.get(`/api/form/${userId}`);
        const formBody = await formRes.text();
        expect(formRes.ok(), `GET /api/form/${userId} failed: ${formBody}`).toBeTruthy();
        expect(JSON.parse(formBody).formConfig?.hiddenSteps).toEqual(['selfie']);

        const sign = (id: string, lastName: string) => request.post(`/api/contract/${id}/submit`, {
            data: {
                name: 'AdoptionDocsOrgE2E', lastName: `${lastName}${run}`,
                email: `e2e-org-signer-${lastName.toLowerCase()}-${run}@example.com`, phone: '555-0114',
                screenshot: TINY_PNG, contractVersionId: versionId, standardVersion: 'std12345', locale: 'es',
            },
        });
        const signedRow = (id: string) => parseD1Rows(execD1(
            `SELECT contract_version_id, standard_version, content_hash FROM signed_contracts WHERE animal_id = '${id}'`,
        ));
        const versionFirstSigned = () => parseD1Rows(execD1(
            `SELECT first_signed_at FROM contract_versions WHERE id = '${versionId}'`,
        ))[0]?.first_signed_at;

        // 2. Signed on ANOTHER rescuer's animal: recorded as sent, but not
        //    counted — no content hash, the version is not stamped as signed.
        const foreign = await sign(foreignAnimalId, 'Foreign');
        expect(foreign.ok(), `foreign submit failed: ${await foreign.text()}`).toBeTruthy();
        const foreignRows = signedRow(foreignAnimalId);
        expect(foreignRows.length).toBe(1);
        expect(foreignRows[0].contract_version_id).toBe(versionId);
        expect(foreignRows[0].standard_version).toBe('std12345');
        expect(isD1Null(foreignRows[0].content_hash)).toBe(true);
        expect(isD1Null(versionFirstSigned()), 'a signature on someone else\'s animal must not stamp the version').toBe(true);

        // 3. Signed on the member's own animal: hash recorded (membership
        //    branch of the ownership rule), version stamped, and the standard
        //    version stored alongside the custom one.
        const own = await sign(signedAnimalId, 'Own');
        expect(own.ok(), `own submit failed: ${await own.text()}`).toBeTruthy();
        const ownRows = signedRow(signedAnimalId);
        expect(ownRows.length).toBe(1);
        expect(ownRows[0].contract_version_id).toBe(versionId);
        expect(ownRows[0].standard_version).toBe('std12345');
        expect(ownRows[0].content_hash).toBe(`test-hash-org-${run}`);
        expect(isD1Null(versionFirstSigned())).toBe(false);

        // 4. Leaving the group falls back to the user's own (here: none →
        //    standard) form and contract.
        execD1(`DELETE FROM org_members WHERE id = '${memberId}'`);

        const afterContract = await request.get(`/api/contract/${animalId}`);
        const afterContractBody = await afterContract.text();
        expect(afterContract.ok(), `GET after leaving failed: ${afterContractBody}`).toBeTruthy();
        expect(JSON.parse(afterContractBody).customContract).toBeNull();

        const afterForm = await request.get(`/api/form/${userId}`);
        const afterFormBody = await afterForm.text();
        expect(afterForm.ok(), `GET form after leaving failed: ${afterFormBody}`).toBeTruthy();
        expect(JSON.parse(afterFormBody).formConfig).toBeNull();
    });
});
