import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * The admin duplicate scan (Datos → Duplicados → Scan Now): stale profiles
 * are re-tokenized in atomic write groups and the candidate queue is rebuilt.
 *
 * A scan is global by nature (it rebuilds EVERY pending candidate), so this
 * spec puts the seed's two pending candidates back afterwards. Specs that run
 * after it in the same shard see the seed state, not the rebuilt queue.
 * Fixtures: test-scan-fixture-* (two profiles sharing a phone, never tokenized).
 */
function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function rows<T>(sql: string): T[] {
    return JSON.parse(execD1(sql))[0].results as T[];
}

const A = 'test-scan-fixture-1';
const B = 'test-scan-fixture-2';
const PHONE = '1155557788';

test.describe.configure({ mode: 'serial' });

test.describe('duplicate scan', () => {
    test.beforeAll(() => {
        for (const [id, name] of [[A, 'Escaneo Fixture Uno'], [B, 'Escaneo Fixture Dos']]) {
            // Tokenizer v7 indexes typed contact entries only, so the phone is a typed entry.
            execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, contact_entries, country, status, added_by, deleted_at, token_hash, created_at, updated_at) VALUES ('${id}', '${name}', 'Tel: ${PHONE}', '[{"id":"${id}-ph","type":"phone","value":"${PHONE}"}]', 'AR', '4', 'test-seed', NULL, NULL, strftime('%s','now'), strftime('%s','now'))`);
            execD1(`DELETE FROM duplicate_tokens WHERE adopter_id = '${id}'`);
        }
    });

    test.afterAll(() => {
        execD1(`DELETE FROM duplicate_tokens WHERE adopter_id IN ('${A}', '${B}')`);
        execD1(`DELETE FROM adopters WHERE id IN ('${A}', '${B}')`);
        // Back to the seed's candidate queue (tests/seed.sql).
        execD1(`DELETE FROM duplicate_candidates WHERE status IN ('pending', 'rebuilding')`);
        execD1(`INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at) VALUES ('test-dup-candidate-1', 'test-adopter-1', 'test-adopter-3', '["phone","name_word"]', '{"phone":"5555555","name_word":["garcia"]}', 4, 'medium', 'pending', strftime('%s','now'))`);
        execD1(`INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at) VALUES ('test-dup-candidate-2', 'test-adopter-4', 'test-adopter-2', '["name_word"]', '{"name_word":["fernandez"]}', 1, 'low', 'pending', strftime('%s','now'))`);
        execD1(`UPDATE app_config SET value = 'idle' WHERE key = 'duplicate_scan_status'`);
    });

    test('the scan re-tokenizes stale profiles in batches and pairs the ones sharing a phone', async ({ page }) => {
        test.setTimeout(180000);
        let done = false;
        for (let i = 0; i < 40 && !done; i++) {
            const res = await page.request.post('/api/admin/duplicates?limit=10');
            expect(res.status(), await res.text()).toBe(200);
            done = (await res.json()).done === true;
        }
        expect(done).toBe(true);

        const fixtures = rows<{ id: string; token_hash: string | null }>(`SELECT id, token_hash FROM adopters WHERE id IN ('${A}', '${B}')`);
        expect(fixtures.every(f => !!f.token_hash)).toBe(true);
        // Both carry the same phone token (whatever form the reader stores it in).
        const phoneTokens = rows<{ adopter_id: string; token_value: string }>(`SELECT adopter_id, token_value FROM duplicate_tokens WHERE token_type = 'phone' AND adopter_id IN ('${A}', '${B}')`);
        expect(phoneTokens.map(t => t.adopter_id).sort()).toEqual([A, B]);
        expect(new Set(phoneTokens.map(t => t.token_value)).size).toBe(1);
        const pair = rows<{ n: number }>(`SELECT count(*) AS n FROM duplicate_candidates WHERE status = 'pending' AND ((adopter1_id = '${A}' AND adopter2_id = '${B}') OR (adopter1_id = '${B}' AND adopter2_id = '${A}'))`);
        expect(pair[0].n).toBe(1);
    });

    test('Scan Now in the admin panel reports completion', async ({ page }) => {
        await page.goto('/admin/data-quality');
        await page.getByRole('button', { name: /Duplicados/ }).click();
        await page.getByRole('button', { name: /Scan Now/ }).click();
        await expect(page.getByText(/Scan complete/)).toBeVisible({ timeout: 60000 });
    });
});
