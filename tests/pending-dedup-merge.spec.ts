import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * «Combinar perfiles» on /my-adopters goes through mergePendingDedupPair: the
 * server takes the actor from the session and only merges a pair the feed
 * shows the caller (they created one side). Before, the page called the bare
 * mergeAdopters action with ids and an actor email of its own choosing — an
 * endpoint anyone could hit for any two profiles.
 *
 * Runs as the regular user. Own fixture rows (test-pdmerge-fixture-*), never
 * seed adopters; INSERT OR REPLACE keeps reruns idempotent.
 */

const USER_EMAIL = 'testuser@example.com';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}
const rows = (sql: string) => {
    const w = JSON.parse(execD1(sql));
    return ((Array.isArray(w) ? w[0] : w)?.results ?? []) as Array<Record<string, unknown>>;
};
const isNull = (v: unknown) => v === null || v === undefined || v === 'null';

test('the owner merges a pending pair from /my-adopters; the older profile survives', async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const OLD = `test-pdmerge-fixture-old-${stamp}`;
    const NEW = `test-pdmerge-fixture-new-${stamp}`;
    const CAND = `test-pdmerge-fixture-cand-${stamp}`;
    const NAME = `Pdmerge Fixture ${stamp}`;
    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, created_at, updated_at) VALUES ('${OLD}', '${NAME}', 'Tel: 11 1000-${String(stamp).slice(-4)}', 'AR', '5', '${USER_EMAIL}', NULL, strftime('%s','now','-30 days'), strftime('%s','now'))`);
    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, created_at, updated_at) VALUES ('${NEW}', '${NAME}', 'Tel: 11 2000-${String(stamp).slice(-4)}', 'AR', '5', '${USER_EMAIL}', NULL, strftime('%s','now'), strftime('%s','now'))`);
    execD1(`INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at, resolved_at, resolved_by) VALUES ('${CAND}', '${NEW}', '${OLD}', '["name_full"]', '{}', 100, 'high', 'pending', strftime('%s','now'), NULL, NULL)`);

    await page.goto('/my-adopters');
    await dismissCountryBanner(page);
    const toggle = page.getByRole('button', { name: /Pending review|Pendientes de revisar|Pendentes de revisão/ });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const card = page.locator('#pending-dedup-list > div').filter({ hasText: NAME });
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    await card.getByRole('button', { name: /^(Merge profiles|Combinar perfiles|Mesclar perfis|Combinar perfis)$/ }).click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });

    await expect.poll(() => isNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${NEW}'`)[0]?.deleted_at), { timeout: 30_000 })
        .toBe(false);
    expect(isNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${OLD}'`)[0]?.deleted_at), 'the older profile survives').toBe(true);
});

test('a foreign profile is never absorbed into hers: the merge is refused and both records stay', async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const MINE = `test-pdmerge-fixture-mine-${stamp}`;
    const FOREIGN = `test-pdmerge-fixture-foreign-${stamp}`;
    const CAND = `test-pdmerge-fixture-cand-x-${stamp}`;
    const NAME = `Pdmerge Cross ${stamp}`;
    // Hers is OLDER, so a merge would absorb the other rescuer's record.
    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, created_at, updated_at) VALUES ('${MINE}', '${NAME}', 'Tel: 11 3000-${String(stamp).slice(-4)}', 'AR', '5', '${USER_EMAIL}', NULL, strftime('%s','now','-30 days'), strftime('%s','now'))`);
    execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, country, status, added_by, deleted_at, created_at, updated_at) VALUES ('${FOREIGN}', '${NAME}', 'Tel: 11 4000-${String(stamp).slice(-4)}', 'AR', '5', 'someone-else@example.com', NULL, strftime('%s','now'), strftime('%s','now'))`);
    execD1(`INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at, resolved_at, resolved_by) VALUES ('${CAND}', '${FOREIGN}', '${MINE}', '["name_full"]', '{}', 100, 'high', 'pending', strftime('%s','now'), NULL, NULL)`);

    await page.goto('/my-adopters');
    await dismissCountryBanner(page);
    const toggle = page.getByRole('button', { name: /Pending review|Pendientes de revisar|Pendentes de revisão/ });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const card = page.locator('#pending-dedup-list > div').filter({ hasText: NAME });
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    await card.getByRole('button', { name: /^(Merge profiles|Combinar perfiles|Mesclar perfis|Combinar perfis)$/ }).click();
    await expect(page.getByText(/created by another rescuer|lo cargó otro rescatista|cadastrado por outro resgatista/).first()).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveCount(1);
    for (const id of [MINE, FOREIGN]) {
        expect(isNull(rows(`SELECT deleted_at FROM adopters WHERE id = '${id}'`)[0]?.deleted_at), `${id} untouched`).toBe(true);
    }
});
