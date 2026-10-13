import { test, expect, type Page } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * /import/sheet on a big sheet: the duplicate analysis can run for minutes.
 * It used to have no Cancel, and a reload silently threw everything away with
 * no word on whether anything was still running. Server actions are slowed
 * here so the analysis is still going when the test acts.
 */
const CSV = 'Nombre,Telefono,Email\nInes Interruptfixture,1155550177,ines.interrupt@example.com\nTeo Interruptfixture,1155550178,teo.interrupt@example.com\n';

async function slowServerActions(page: Page, ms: number) {
    await page.route('**/import/sheet', async route => {
        if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
            await new Promise(r => setTimeout(r, ms));
        }
        await route.continue().catch(() => { /* page reloaded meanwhile */ });
    });
}

async function startAnalysis(page: Page) {
    await page.getByTestId('sheet-file-input').setInputFiles({ name: 'interrupt.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
    await expect(page.getByText('Ines Interruptfixture').first()).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: /Continuar a duplicados/ }).click();
    await expect(page.getByText(/Analizando \d+\/2 registros/)).toBeVisible({ timeout: 15000 });
}

test.describe('sheet import: stopping and reloading', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/import/sheet');
        await dismissCountryBanner(page);
        await expect(page.getByTestId('sheet-dropzone')).toBeVisible({ timeout: 30000 });
    });

    test('Cancel during the duplicate analysis goes back to Revisar with the sheet intact', async ({ page }) => {
        await slowServerActions(page, 8000);
        await startAnalysis(page);
        await page.getByTestId('detect-cancel').click();
        await expect(page.getByText(/Analizando/)).toHaveCount(0);
        await expect(page.getByText('Ines Interruptfixture').first()).toBeVisible();
        await expect(page.getByText('Teo Interruptfixture').first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Continuar a duplicados/ })).toBeEnabled();
        // The slowed lookups finishing later must not drag the screen back to Duplicados.
        await page.waitForTimeout(9000);
        await expect(page.getByRole('button', { name: /Continuar a duplicados/ })).toBeVisible();
    });

    test('a reload mid-analysis asks first, then says what stopped and that nothing runs in the background', async ({ page }) => {
        await slowServerActions(page, 8000);
        await startAnalysis(page);
        const dialogs: string[] = [];
        page.on('dialog', d => { dialogs.push(d.type()); void d.accept(); });
        await page.reload();
        expect(dialogs).toContain('beforeunload');
        await dismissCountryBanner(page);
        const notice = page.getByTestId('import-stopped');
        await expect(notice).toBeVisible({ timeout: 30000 });
        await expect(notice).toContainText('interrupt.csv');
        await expect(notice).toContainText(/analizando duplicados/);
        await expect(notice).toContainText(/nada sigue corriendo en segundo plano/);
        await expect(page.getByTestId('import-elsewhere')).toHaveCount(0);
        // Dismissed, it stays gone.
        await notice.getByRole('button', { name: 'Entendido' }).click();
        await expect(notice).toHaveCount(0);
        await page.unroute('**/import/sheet');
        await page.reload();
        await expect(page.getByTestId('sheet-dropzone')).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('import-stopped')).toHaveCount(0);
    });

    test('a step still running in another tab is reported as running there, not as stopped', async ({ page }) => {
        await page.evaluate(() => localStorage.setItem('buenadoptante-import-activity-v1',
            JSON.stringify({ phase: 'send', fileName: 'otra-pestana.xlsx', total: 40, at: Date.now(), runId: 'x' })));
        await page.reload();
        await expect(page.getByTestId('import-elsewhere')).toContainText('otra-pestana.xlsx', { timeout: 30000 });
        await expect(page.getByTestId('import-stopped')).toHaveCount(0);
        await page.evaluate(() => localStorage.removeItem('buenadoptante-import-activity-v1'));
    });

    test('a finished import leaves no reload notice and no leave-page prompt, and lists the run as complete', async ({ page }) => {
        const csv = 'Nombre,Telefono,Email\nNora Completefixture,1155550166,nora.complete@example.com\n';
        await page.getByTestId('sheet-file-input').setInputFiles({ name: 'completa.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
        await page.getByRole('button', { name: /Continuar a duplicados/ }).click();
        await page.getByRole('button', { name: /Importar 1 →/ }).click({ timeout: 60000 });
        await expect(page.getByText('Importación completa')).toBeVisible({ timeout: 60000 });
        expect(await page.evaluate(() => localStorage.getItem('buenadoptante-import-activity-v1'))).toBeNull();
        const dialogs: string[] = [];
        page.on('dialog', d => { dialogs.push(d.type()); void d.accept(); });
        await page.reload();
        expect(dialogs).toEqual([]);
        await expect(page.getByTestId('sheet-dropzone')).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('import-stopped')).toHaveCount(0);
        await expect(page.getByTestId('import-resume')).toHaveCount(0);
        await expect(page.getByText('completa.csv').first()).toBeVisible({ timeout: 30000 });
    });
});
