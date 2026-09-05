import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

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

function seedAdopter(id: string, name: string, contact: string) {
    execD1(
        `INSERT OR REPLACE INTO adopters (id, name, contact_info, contact_entries, country, status, added_by, deleted_at, token_hash, created_at, updated_at) ` +
        `VALUES ('${id}', '${name}', '${contact}', NULL, 'AR', '5', 'gatitosolivos@gmail.com', NULL, NULL, strftime('%s','now'), strftime('%s','now'))`,
    );
}

test.describe('Duplicate mass-merge and undo', () => {
    test('mass-merge absorbs B and C into A (aliases, ghost pair) and undo restores everything', async ({ page }) => {
        // ── Seed: three clean fixture adopters + two pending pairs (A↔B, B↔C).
        // B↔C is the "ghost" case: it names B, which the first merge absorbs.
        seedAdopter(A, NAME_A, 'alpha-contact-original');
        seedAdopter(B, NAME_B, 'beta-contact 1111-2222');
        seedAdopter(C, NAME_C, 'gamma-contact 3333-4444');
        for (const [candId, id1, id2] of [[CAND_AB, A, B], [CAND_BC, B, C]] as const) {
            execD1(
                `INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at, resolved_at, resolved_by) ` +
                `VALUES ('${candId}', '${id1}', '${id2}', '["name_full"]', '{}', 50, 'high', 'pending', strftime('%s','now'), NULL, NULL)`,
            );
        }

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
            expect(row.deleted_at, `${row.id} should be soft-deleted`).not.toBeNull();
            expect(row.token_hash).toBe('MERGED');
        }

        const survivor = parseD1Rows(execD1(
            `SELECT contact_info, contact_entries, deleted_at FROM adopters WHERE id = '${A}'`,
        ))[0];
        expect(survivor.deleted_at).toBeNull();
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
            expect(row.deleted_at, `${row.id} should be revived by undo`).toBeNull();
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
            expect(row.resolved_by).toBeNull();
        }

        // Double-undo is refused (all-failed → non-2xx).
        const doubleUndo = await page.request.post('/api/admin/duplicates/unmerge', {
            data: { auditIds: [auditIds[1]] },
        });
        expect(doubleUndo.ok()).toBeFalsy();
    });
});
