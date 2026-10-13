import { test, expect, request as pwRequest } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Signed contracts go to PRIVATE storage with a random file name per signing
 * (src/lib/contractStorage.ts): never a public address built from the animal
 * id (anyone with a showcase link could open it), and a second signing never
 * overwrites the first. They open only through /api/files/contract/[animalId],
 * for the animal's rescue and admins.
 */
function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const rows = (sql: string) => JSON.parse(execD1(sql))[0].results as Array<Record<string, unknown>>;
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test.describe('signed contracts: private storage', () => {
    const animalId = `test-animal-contract-storage-${Date.now()}`;

    test.beforeAll(() => {
        execD1(`INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) VALUES ('${animalId}', 'Contratofixture', 'cat', 'E2E fixture', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now'))`);
    });

    test('signing stores the file under a random key; only the rescue and admins can open it', async ({ page, baseURL, browser }) => {
        const anon = await pwRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
        const res = await anon.post(`/api/contract/${animalId}/submit`, {
            data: { name: 'Contrato', lastName: `Privado${Date.now()}`, email: `contract-${Date.now()}@example.com`, phone: '555-0177', screenshot: TINY_PNG, standardVersion: 'test1234', locale: 'es' },
        });
        expect(res.ok(), await res.text()).toBeTruthy();
        const signed = await res.json();
        expect(JSON.stringify(signed)).not.toContain('r2.dev');

        const placement = rows(`SELECT comments FROM placements WHERE animal_id = '${animalId}' AND ended_at IS NULL`)[0];
        const key = JSON.parse(String(placement.comments)).contractKey as string;
        expect(key).toMatch(/^contracts\/[0-9a-f-]{36}\.png$/);
        expect(key).not.toContain(animalId);
        expect(String(placement.comments)).not.toContain('contractScreenshot');
        expect(rows(`SELECT file_key FROM signed_contracts WHERE animal_id = '${animalId}'`)[0].file_key).toBe(key);

        // The animal's rescue (the admin owns it) opens it.
        const mine = await page.request.get(`/api/files/contract/${animalId}`);
        expect(mine.status()).toBe(200);
        expect(mine.headers()['content-type']).toBe('image/png');
        expect(mine.headers()['cache-control']).toContain('no-store');
        expect((await mine.body()).byteLength).toBeGreaterThan(0);

        // Another rescue: the same 404 as an animal without a contract. Nobody signed in: 401.
        const ctx = await browser.newContext({ storageState: '.auth/user.json' });
        expect((await ctx.request.get(`/api/files/contract/${animalId}`)).status()).toBe(404);
        // ...and no link to it on the adopter's profile either.
        const other = await ctx.newPage();
        await other.goto(`/adopter/${signed.adopterId}`);
        await expect(other.locator(`[id="adoption-${animalId}"]`)).toBeVisible({ timeout: 30000 });
        await expect(other.locator('a[href^="/api/files/contract/"]')).toHaveCount(0);
        await ctx.close();
        await page.goto(`/adopter/${signed.adopterId}`);
        await expect(page.locator(`[id="adoption-${animalId}"] a[href="/api/files/contract/${animalId}"]`)).toBeVisible({ timeout: 30000 });
        expect((await anon.get(`/api/files/contract/${animalId}`)).status()).toBe(401);
        // The old unauthenticated "retry upload" route that could replace any contract is gone.
        expect((await anon.post(`/api/contract/${animalId}/upload`, { data: { screenshot: TINY_PNG } })).ok()).toBe(false);
        await anon.dispose();

        // The adoption card links through the checked route.
        await page.goto(`/my-animals/${animalId}`);
        await expect(page.locator(`a[href^="/api/files/contract/${animalId}"]`).first()).toBeVisible({ timeout: 30000 });
    });

    test('admin move: old public contracts are copied to private storage, records repointed, then the public copies deleted', async ({ page }) => {
        const legacyAnimal = `test-animal-contract-legacy-${Date.now()}`;
        const publicKey = `contracts/${legacyAnimal}/signed-contract.png`;
        const file = `${process.cwd()}/test-results/legacy-contract.png`;
        execSync(`mkdir -p test-results && printf 'PNGfake' > ${file}`);
        execSync(`npx wrangler r2 object put buenadoptante-images/${publicKey} --file ${file} --content-type image/png --local`, { stdio: 'ignore' });
        execD1(`INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) VALUES ('${legacyAnimal}', 'Legadofixture', 'dog', 'E2E fixture', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now'))`);
        execD1(`INSERT INTO placements (id, animal_id, adopter_id, record_type, status, started_at, comments, recorded_by) VALUES ('${legacyAnimal}-plc', '${legacyAnimal}', 'test-adopter-1', 'adoption', 'active', strftime('%s','now'), '{"contractScreenshot":"https://pub-bb28dd8b1e674fc189252b0000a7b573.r2.dev/${publicKey}"}', 'contract')`);

        const plan = await (await page.request.get('/api/admin/contracts/migrate')).json();
        expect(plan.toMove.some((m: { animalId: string }) => m.animalId === legacyAnimal)).toBe(true);

        const moved = await (await page.request.post('/api/admin/contracts/migrate')).json();
        expect(moved.results.find((r: { animalId: string }) => r.animalId === legacyAnimal)?.status).toBe('moved');
        const comments = JSON.parse(String(rows(`SELECT comments FROM placements WHERE id = '${legacyAnimal}-plc'`)[0].comments));
        expect(comments.contractKey).toMatch(/^contracts\/[0-9a-f-]{36}\.png$/);
        expect(comments.movedFrom).toBe(publicKey);
        expect((await page.request.get(`/api/files/contract/${legacyAnimal}`)).status()).toBe(200);

        const del = await (await page.request.post('/api/admin/contracts/migrate?deletePublic=1')).json();
        expect(del.deleted).toContain(publicKey);
        let stillThere = true;
        try { execSync(`npx wrangler r2 object get buenadoptante-images/${publicKey} --pipe --local`, { stdio: 'pipe' }); } catch { stillThere = false; }
        expect(stillThere).toBe(false);
        // The private copy is still served after the public one is gone.
        expect((await page.request.get(`/api/files/contract/${legacyAnimal}`)).status()).toBe(200);
    });
});

