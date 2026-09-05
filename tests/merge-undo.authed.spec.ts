import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Mass-merge + undo round-trip (v2.55.x). Exercises the dangerous server path
 * end-to-end through the real authed HTTP endpoints, asserting DB state via
 * wrangler between steps:
 *
 *   merge A←[B,C]  →  B/C soft-deleted, names carried as aliases, the B↔C
 *                     "ghost" pair resolved alongside A↔B
 *   unmerge (reverse order)  →  everything restored, candidates pending again
 *
 * Test-isolated fixtures (test-massmerge-fixture-*) per the destructive-op
 * convention — never seed adopters, INSERT OR REPLACE for idempotency across
 * runs. No activity records are seeded: record re-pointing is covered by ids
 * captured/restored symmetrically, and the adopter/candidate/alias round-trip
 * is the highest-risk surface.
 */

const A = 'test-massmerge-fixture-a';
const B = 'test-massmerge-fixture-b';
const C = 'test-massmerge-fixture-c';
const NAME_A = 'MassMergeFixture Alpha';
const NAME_B = 'MassMergeFixture Beta';
const NAME_C = 'MassMergeFixture Gamma';
const CAND_AB = 'test-cand-massmerge-ab';
const CAND_BC = 'test-cand-massmerge-bc';

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

/** Wrangler's --json renders SQL NULL as the string "null" in CI — normalize. */
function isDbNull(v: unknown): boolean {
    return v === null || v === undefined || v === 'null';
}

function seedAdopter(id: string, name: string, contact: string, entriesJson: string | null = null, createdAtExpr = `strftime('%s','now')`) {
    const entries = entriesJson === null ? 'NULL' : `'${entriesJson}'`;
    execD1(
        `INSERT OR REPLACE INTO adopters (id, name, contact_info, contact_entries, country, status, added_by, deleted_at, token_hash, created_at, updated_at) ` +
        `VALUES ('${id}', '${name}', '${contact}', ${entries}, 'AR', '5', 'gatitosolivos@gmail.com', NULL, NULL, ${createdAtExpr}, strftime('%s','now'))`,
    );
}

function seedCandidate(candId: string, id1: string, id2: string) {
    execD1(
        `INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at, resolved_at, resolved_by) ` +
        `VALUES ('${candId}', '${id1}', '${id2}', '["name_full"]', '{}', 50, 'high', 'pending', strftime('%s','now'), NULL, NULL)`,
    );
}

test.describe('Duplicate mass-merge and undo', () => {
    test('mass-merge absorbs B and C into A (aliases, ghost pair) and undo restores everything', async ({ page }) => {
        // ── Seed: three clean fixture adopters + two pending pairs (A↔B, B↔C).
        // B↔C is the "ghost" case: it names B, which the first merge absorbs.
        seedAdopter(A, NAME_A, 'alpha-contact-original');
        seedAdopter(B, NAME_B, 'beta-contact 1111-2222');
        seedAdopter(C, NAME_C, 'gamma-contact 3333-4444');
        seedCandidate(CAND_AB, A, B);
        seedCandidate(CAND_BC, B, C);

        // ── Mass-merge B and C into A through the real endpoint (admin session).
        const mergeRes = await page.request.post('/api/admin/duplicates/merge', {
            data: { primaryId: A, secondaryIds: [B, C] },
        });
        expect(mergeRes.ok()).toBeTruthy();
        const mergeData = await mergeRes.json() as {
            success: boolean; mergedCount: number;
            results: Array<{ secondaryId: string; success: boolean; auditId?: string; error?: string }>;
        };
        expect(mergeData.success).toBeTruthy();
        expect(mergeData.mergedCount).toBe(2);
        const auditIds = mergeData.results.map(r => r.auditId!);
        expect(auditIds).toHaveLength(2);

        // ── Post-merge DB state.
        const merged = parseD1Rows(execD1(
            `SELECT id, deleted_at, token_hash FROM adopters WHERE id IN ('${B}', '${C}')`,
        ));
        expect(merged).toHaveLength(2);
        for (const row of merged) {
            expect(isDbNull(row.deleted_at), `${row.id} should be soft-deleted`).toBe(false);
            expect(row.token_hash).toBe('MERGED');
        }

        const survivor = parseD1Rows(execD1(
            `SELECT contact_info, contact_entries, deleted_at FROM adopters WHERE id = '${A}'`,
        ))[0];
        expect(isDbNull(survivor.deleted_at), 'survivor must stay live').toBe(true);
        // Absorbed contact blobs appended; absorbed names carried as aliases.
        expect(String(survivor.contact_info)).toContain('beta-contact');
        expect(String(survivor.contact_info)).toContain('gamma-contact');
        expect(String(survivor.contact_entries)).toContain(NAME_B);
        expect(String(survivor.contact_entries)).toContain(NAME_C);

        // Both pairs resolved — including B↔C, which no longer names two live
        // profiles (the ghost-pair regression this suite exists to pin down).
        const cands = parseD1Rows(execD1(
            `SELECT id, status FROM duplicate_candidates WHERE id IN ('${CAND_AB}', '${CAND_BC}')`,
        ));
        expect(cands).toHaveLength(2);
        for (const row of cands) {
            expect(row.status, `${row.id} should be resolved by the merge`).toBe('merged');
        }

        // ── Undo, newest-first (server refuses older-first for same survivor).
        const undoRes = await page.request.post('/api/admin/duplicates/unmerge', {
            data: { auditIds: [...auditIds].reverse() },
        });
        expect(undoRes.ok()).toBeTruthy();
        const undoData = await undoRes.json() as { success: boolean; undoneCount: number };
        expect(undoData.success).toBeTruthy();
        expect(undoData.undoneCount).toBe(2);

        // ── Post-undo DB state: everything back to the seeded values.
        const revived = parseD1Rows(execD1(
            `SELECT id, deleted_at FROM adopters WHERE id IN ('${B}', '${C}')`,
        ));
        expect(revived).toHaveLength(2);
        for (const row of revived) {
            expect(isDbNull(row.deleted_at), `${row.id} should be revived by undo`).toBe(true);
        }

        const restored = parseD1Rows(execD1(
            `SELECT contact_info, contact_entries FROM adopters WHERE id = '${A}'`,
        ))[0];
        expect(restored.contact_info).toBe('alpha-contact-original');
        // The auto-aliases came with the merge; undo must take them back out.
        expect(String(restored.contact_entries ?? '')).not.toContain(NAME_B);
        expect(String(restored.contact_entries ?? '')).not.toContain(NAME_C);

        const restoredCands = parseD1Rows(execD1(
            `SELECT id, status, resolved_by FROM duplicate_candidates WHERE id IN ('${CAND_AB}', '${CAND_BC}')`,
        ));
        for (const row of restoredCands) {
            expect(row.status, `${row.id} should be pending again`).toBe('pending');
            expect(isDbNull(row.resolved_by), `${row.id} resolved_by should clear`).toBe(true);
        }

        // Double-undo is refused (all-failed → non-2xx).
        const doubleUndo = await page.request.post('/api/admin/duplicates/unmerge', {
            data: { auditIds: [auditIds[1]] },
        });
        expect(doubleUndo.ok()).toBeFalsy();
    });

    test('batch pair-merge resolves each pair independently: auto-survivor by data then age, overlapping pair skips', async ({ page }) => {
        // Independent pairs P↔Q (P has more contact entries) and R↔S (equal
        // data, R older), plus Q↔E which overlaps the first pair — merging
        // P↔Q absorbs Q, so Q↔E must come back as a skip, not an error.
        const P = 'test-pairmerge-fixture-p';
        const Q = 'test-pairmerge-fixture-q';
        const R = 'test-pairmerge-fixture-r';
        const S = 'test-pairmerge-fixture-s';
        const E = 'test-pairmerge-fixture-e';
        const CAND_PQ = 'test-cand-pairmerge-pq';
        const CAND_RS = 'test-cand-pairmerge-rs';
        const CAND_QE = 'test-cand-pairmerge-qe';

        seedAdopter(P, 'PairMergeFixture Uno', 'p-contact', '[{"type":"phone","value":"555111"},{"type":"email","value":"p@fixture.test"}]');
        seedAdopter(Q, 'PairMergeFixture Dos', 'q-contact');
        seedAdopter(R, 'PairMergeFixture Tres', 'r-contact', null, `strftime('%s','now') - 5000`);
        seedAdopter(S, 'PairMergeFixture Cuatro', 's-contact');
        seedAdopter(E, 'PairMergeFixture Cinco', 'e-contact');
        seedCandidate(CAND_PQ, P, Q);
        seedCandidate(CAND_RS, R, S);
        seedCandidate(CAND_QE, Q, E);

        const res = await page.request.post('/api/admin/duplicates/merge', {
            data: { candidateIds: [CAND_PQ, CAND_RS, CAND_QE] },
        });
        expect(res.ok()).toBeTruthy();
        const data = await res.json() as {
            success: boolean; mergedCount: number; skippedCount: number;
            results: Array<{ candidateId: string; success: boolean; skipped?: boolean; auditId?: string }>;
        };
        expect(data.success).toBeTruthy();
        expect(data.mergedCount).toBe(2);
        expect(data.skippedCount).toBe(1);
        expect(data.results.find(r => r.candidateId === CAND_QE)?.skipped).toBeTruthy();

        // Survivors: P (more contact entries) and R (older). Losers absorbed.
        const rows = parseD1Rows(execD1(
            `SELECT id, deleted_at FROM adopters WHERE id IN ('${P}', '${Q}', '${R}', '${S}', '${E}') ORDER BY id`,
        ));
        const deletedById = new Map(rows.map(r => [r.id, !isDbNull(r.deleted_at)]));
        expect(deletedById.get(P), 'P survives (more entries)').toBe(false);
        expect(deletedById.get(Q), 'Q absorbed into P').toBe(true);
        expect(deletedById.get(R), 'R survives (older)').toBe(false);
        expect(deletedById.get(S), 'S absorbed into R').toBe(true);
        expect(deletedById.get(E), 'E untouched by the skipped pair').toBe(false);

        // The overlapping pair was auto-resolved by the P↔Q merge's cleanup.
        const qe = parseD1Rows(execD1(
            `SELECT status FROM duplicate_candidates WHERE id = '${CAND_QE}'`,
        ))[0];
        expect(qe.status).toBe('merged');
    });

    test('search is accent-insensitive end-to-end: unaccented query puts the accented record in the MAIN list', async ({ page }) => {
        // Regression for the v2.55.8 normalization boundary: recall (token
        // index) was accent-insensitive but the coverage demotion compared raw
        // text, so "sebastian vazquez" recalled "Sebastián Vázquez" and then
        // buried it under "Ampliar la búsqueda". Main-list visibility WITHOUT
        // expanding the weak tier is the assertion.
        const ACC = 'test-accent-fixture-1';
        const ACC_NAME = 'AccentFixture Vázquez Ramírez';
        seedAdopter(ACC, ACC_NAME, 'accent-fixture-contact');
        // Name tokens exactly as tokenizeAdopter writes them (NFD-stripped) —
        // SQL-seeded fixtures never pass through the app's tokenizer.
        const toks: Array<[string, string, string]> = [
            ['test-tok-accent-1', 'name_word', 'accentfixture'],
            ['test-tok-accent-2', 'name_word', 'vazquez'],
            ['test-tok-accent-3', 'name_word', 'ramirez'],
            ['test-tok-accent-4', 'name_full', 'accentfixture vazquez ramirez'],
        ];
        for (const [id, type, value] of toks) {
            execD1(`INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES ('${id}', '${ACC}', '${type}', '${value}')`);
        }

        await page.goto('/');
        await dismissCountryBanner(page);
        await page.fill('input#search', 'accentfixture vazquez');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();
        await expect(page.getByText(/found \d+ match|resultados encontrados/i)).toBeVisible({ timeout: 30000 });
        // Visible WITHOUT clicking "Ampliar la búsqueda" ⇒ main list, full coverage.
        await expect(page.getByText(ACC_NAME).first()).toBeVisible({ timeout: 30000 });
    });

    test('searching a household member name surfaces the titular record in the MAIN list', async ({ page }) => {
        // Regression for the recall/score source mismatch (v2.55.9): household
        // member and onBehalfOf names emit recall tokens, but the scorer never
        // read those fields — the record surfaced with no score, no match chip
        // and no snippet, demoted to the weak tier. A perfect relative-name
        // match must land in the main list, scored via the family branch.
        const HH = 'test-household-fixture-1';
        const HH_NAME = 'HouseholdFixture Titular';
        seedAdopter(HH, HH_NAME, 'household-fixture-contact');
        execD1(
            `UPDATE adopters SET household_members = '[{"id":"hm-test-0001","name":"RelativeFixture Ondina","relationship":"partner","contactEntries":[]}]' WHERE id = '${HH}'`,
        );
        // Tokens as extractTokens writes them: household names → name_words.
        const toks: Array<[string, string]> = [
            ['test-tok-hh-1', 'relativefixture'],
            ['test-tok-hh-2', 'ondina'],
        ];
        for (const [id, value] of toks) {
            execD1(`INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES ('${id}', '${HH}', 'name_word', '${value}')`);
        }

        await page.goto('/');
        await dismissCountryBanner(page);
        await page.fill('input#search', 'relativefixture ondina');
        await page.getByRole('button', { name: /search records|buscar registros/i }).click();
        await expect(page.getByText(/found \d+ match|resultados encontrados/i)).toBeVisible({ timeout: 30000 });
        // The titular's card in the MAIN list (no expander click) ...
        await expect(page.getByText(HH_NAME).first()).toBeVisible({ timeout: 30000 });
        // ... and the card explains WHY: family-circle match, relative visible.
        await expect(page.getByText(/RelativeFixture Ondina/).first()).toBeVisible({ timeout: 30000 });
    });
});
