import { test, expect, request as pwRequest } from '@playwright/test';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

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

        const placement = rows(`SELECT comments, contract_key, contract_sha256 FROM placements WHERE animal_id = '${animalId}' AND ended_at IS NULL`)[0];
        const key = String(placement.contract_key);
        expect(key).toMatch(/^contracts\/[0-9a-f-]{36}\.png$/);
        expect(key).not.toContain(animalId);
        expect(String(placement.contract_sha256)).toMatch(/^[0-9a-f]{64}$/);
        // Never in the free-text comments a rescuer can edit.
        expect(String(placement.comments ?? '')).not.toContain('contracts/');
        // The public contract page no longer returns comments at all.
        const pub = await (await anon.get(`/api/contract/${animalId}`)).json().catch(() => ({}));
        expect(pub.comments).toBeUndefined();
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

        // A forged reference gets nothing: another rescuer types the key into
        // comments of THEIR record, or a key is copied onto another animal's row.
        const forged = `test-animal-contract-forged-${Date.now()}`;
        execD1(`INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) VALUES ('${forged}', 'Falsofixture', 'cat', 'E2E fixture', 'testuser@example.com', strftime('%s','now'), strftime('%s','now'))`);
        execD1(`INSERT INTO placements (id, animal_id, adopter_id, record_type, status, started_at, comments, recorded_by) VALUES ('${forged}-plc', '${forged}', 'test-adopter-1', 'adoption', 'active', strftime('%s','now'), '{"contractKey":"${key}"}', 'testuser@example.com')`);
        const thief = await browser.newContext({ storageState: '.auth/user.json' });
        expect((await thief.request.get(`/api/files/contract/${forged}`)).status()).toBe(404);
        execD1(`UPDATE placements SET contract_key = '${key}' WHERE id = '${forged}-plc'`);
        expect((await thief.request.get(`/api/files/contract/${forged}`)).status()).toBe(404); // the file was stored for another animal
        await thief.close();

        // The adoption card links through the checked route.
        await page.goto(`/my-animals/${animalId}`);
        await expect(page.locator(`a[href^="/api/files/contract/${animalId}"]`).first()).toBeVisible({ timeout: 30000 });
    });

    test('admin move: an old public contract is copied to private storage, linked, then its public copy deleted', async ({ page }) => {
        const legacyAnimal = `test-animal-contract-legacy-${Date.now()}`;
        const otherAnimal = `test-animal-contract-other-${Date.now()}`;
        const publicKey = `contracts/${legacyAnimal}/signed-contract.png`;
        const file = `${process.cwd()}/test-results/legacy-contract.png`;
        execSync('mkdir -p test-results');
        writeFileSync(file, Buffer.from(TINY_PNG.split(',')[1], 'base64'));
        execSync(`npx wrangler r2 object put buenadoptante-images/${publicKey} --file ${file} --content-type image/png --local`, { stdio: 'ignore' });
        for (const id of [legacyAnimal, otherAnimal]) {
            execD1(`INSERT INTO animals (id, name, species, details, added_by, created_at, updated_at) VALUES ('${id}', 'Legadofixture', 'dog', 'E2E fixture', 'gatitosolivos@gmail.com', strftime('%s','now'), strftime('%s','now'))`);
        }
        const url = `https://pub-bb28dd8b1e674fc189252b0000a7b573.r2.dev/${publicKey}`;
        execD1(`INSERT INTO placements (id, animal_id, adopter_id, record_type, status, started_at, comments, recorded_by) VALUES ('${legacyAnimal}-plc', '${legacyAnimal}', 'test-adopter-1', 'adoption', 'active', strftime('%s','now'), '{"contractScreenshot":"${url}","note":"keep me"}', 'contract')`);
        // A record pointing at ANOTHER animal's legacy file is never moved (comments are user-writable).
        execD1(`INSERT INTO placements (id, animal_id, adopter_id, record_type, status, started_at, comments, recorded_by) VALUES ('${otherAnimal}-plc', '${otherAnimal}', 'test-adopter-1', 'adoption', 'active', strftime('%s','now'), '{"contractScreenshot":"${url}"}', 'contract')`);

        const plan = await (await page.request.get('/api/admin/contracts/migrate')).json();
        const planned = plan.toMove.map((m: { animalId: string }) => m.animalId);
        expect(planned).toContain(legacyAnimal);
        expect(planned).not.toContain(otherAnimal);

        const moved = await (await page.request.post('/api/admin/contracts/migrate')).json();
        expect(moved.contracts.find((r: { id: string }) => r.id === legacyAnimal)).toMatchObject({ status: 'moved', publicDeleted: true });
        const row = rows(`SELECT comments, contract_key FROM placements WHERE id = '${legacyAnimal}-plc'`)[0];
        expect(String(row.contract_key)).toMatch(/^contracts\/[0-9a-f-]{36}\.png$/);
        expect(JSON.parse(String(row.comments))).toEqual({ note: 'keep me' });
        expect((await page.request.get(`/api/files/contract/${legacyAnimal}`)).status()).toBe(200);
        let stillThere = true;
        try { execSync(`npx wrangler r2 object get buenadoptante-images/${publicKey} --pipe --local`, { stdio: 'pipe' }); } catch { stillThere = false; }
        expect(stillThere).toBe(false);
        // Running it again changes nothing.
        expect((await (await page.request.post('/api/admin/contracts/migrate')).json()).contracts.some((r: { id: string }) => r.id === legacyAnimal)).toBe(false);
    });

    test('a form selfie is stored privately; only who may see the form results opens it', async ({ page, baseURL, browser }) => {
        const anon = await pwRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
        const res = await anon.post('/api/form/test-admin-id/submit', {
            data: { legal: true, name: `Selfiefixture ${Date.now()}`, email: `selfie-${Date.now()}@example.com`, phone: '555-0144', address: '1 E2E Ave', intent: 'self', selfie: TINY_PNG },
        });
        expect(res.ok(), await res.text()).toBeTruthy();
        const { submissionId } = await res.json();
        const row = rows(`SELECT selfie_key, selfie_url, answers_json FROM form_submissions WHERE id = '${submissionId}'`)[0];
        expect(String(row.selfie_key)).toMatch(/^selfies\/[0-9a-f-]{36}\.png$/);
        expect(row.selfie_url === null || row.selfie_url === 'null').toBe(true);
        expect(String(row.answers_json)).not.toContain('r2.dev');

        // The form's owner (the admin) opens it; another rescue and nobody signed in don't.
        const mine = await page.request.get(`/api/files/selfie/${submissionId}`);
        expect(mine.status()).toBe(200);
        expect(mine.headers()['content-type']).toBe('image/png');
        const other = await browser.newContext({ storageState: '.auth/user.json' });
        expect((await other.request.get(`/api/files/selfie/${submissionId}`)).status()).toBe(404);
        await other.close();
        expect((await anon.get(`/api/files/selfie/${submissionId}`)).status()).toBe(401);
        await anon.dispose();

        // The form results page shows it through the checked route.
        await page.goto(`/form-results/${submissionId}`);
        await expect(page.locator(`img[src="/api/files/selfie/${submissionId}"]`).first()).toBeVisible({ timeout: 30000 });
    });

    test('form photos (protection + where it sleeps) are stored privately; only who may see the form opens them', async ({ page, baseURL, browser }) => {
        const anon = await pwRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
        const stamp = Date.now();
        const res = await anon.post('/api/form/test-admin-id/submit', {
            data: {
                legal: true, name: `Fotosfixture ${stamp}`, email: `fotos-${stamp}@example.com`, phone: '555-0145', address: '2 E2E Ave', intent: 'self',
                protectionPhotos: [TINY_PNG, TINY_PNG, 'https://evil.example/x.png'], sleepPhoto: TINY_PNG,
            },
        });
        expect(res.ok(), await res.text()).toBeTruthy();
        const { submissionId } = await res.json();
        const row = rows(`SELECT photo_keys, answers_json FROM form_submissions WHERE id = '${submissionId}'`)[0];
        const keys = JSON.parse(String(row.photo_keys)) as Array<{ kind: string; key: string }>;
        expect(keys.map(k => k.kind)).toEqual(['protection', 'protection', 'sleep']);
        for (const k of keys) expect(k.key).toMatch(/^form-photos\/[0-9a-f-]{36}\.png$/);
        // No image data and no storage key in the answers the results page receives.
        expect(String(row.answers_json)).not.toContain('data:image');
        expect(String(row.answers_json)).not.toContain('form-photos/');
        expect(JSON.parse(String(row.answers_json))).toMatchObject({ protectionPhotos: 2, sleepPhoto: true });

        const mine = await page.request.get(`/api/files/form-photo/${submissionId}/0`);
        expect(mine.status()).toBe(200);
        expect(mine.headers()['content-type']).toBe('image/png');
        expect((await page.request.get(`/api/files/form-photo/${submissionId}/2`)).status()).toBe(200);
        expect((await page.request.get(`/api/files/form-photo/${submissionId}/3`)).status()).toBe(404);
        const other = await browser.newContext({ storageState: '.auth/user.json' });
        expect((await other.request.get(`/api/files/form-photo/${submissionId}/0`)).status()).toBe(404);
        await other.close();
        expect((await anon.get(`/api/files/form-photo/${submissionId}/0`)).status()).toBe(401);
        await anon.dispose();

        // The form results page shows them through the checked route — never a key.
        await page.goto(`/form-results/${submissionId}`);
        const block = page.getByTestId('form-photos');
        await expect(block.locator(`img[src="/api/files/form-photo/${submissionId}/0"]`)).toBeVisible({ timeout: 30000 });
        await expect(block.locator(`img[src="/api/files/form-photo/${submissionId}/1"]`)).toBeVisible();
        await expect(block.locator(`img[src="/api/files/form-photo/${submissionId}/2"]`)).toBeVisible();
        expect(await page.content()).not.toContain('form-photos/');
    });
});
