import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * /import/sheet on a rescue's form export (one column per question, the same
 * person on several rows, "no"/"si" in contact columns, status codes as type).
 * Everything here is checked on Revisar — nothing is imported.
 */
const CSV = [
    'Nombre y Apellido,Celular,Email,Direccion,Localidad,Instagram,tipo,animal_tipo,2. ¿Qué tipo de vivienda tenés?',
    'Zoe Formexportfixture,1155550191,zoe.formexport@example.com,Calle Uno 100,Morón,no,AP,P,Casa',
    'zoe formexportfixture,11 5555 0192,zoe.formexport@example.com,Calle Uno 100,Morón,@zoe.formexport,AP,P,Departamento',
    'Bruno Formexportfixture,1155550193,bruno.formexport@example.com,Calle Dos 200,Haedo,si,A,G,Casa',
].join('\n') + '\n';

test.describe('sheet import: a form export', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/import/sheet');
        await dismissCountryBanner(page);
        await expect(page.getByTestId('sheet-dropzone')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('sheet-file-input').setInputFiles({ name: 'form-export.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
        await expect(page.getByText('Bruno Formexportfixture').first()).toBeVisible({ timeout: 30000 });
    });

    test('unknown types are announced and fixed for every row at once', async ({ page }) => {
        const notice = page.getByTestId('import-unknown-types');
        await expect(notice).toContainText('3 filas');
        await expect(notice).toContainText('«AP»');
        await page.getByTestId('bulk-record-type').selectOption('adoption_request');
        await expect(notice).toHaveCount(0);
    });

    test('"no"/"si" are not contacts, and one row\'s address columns are one address', async ({ page }) => {
        await expect(page.getByTestId('import-dropped-placeholders')).toContainText('2 valores vacíos');
        await expect(page.getByText('Calle Uno 100, Morón').first()).toBeVisible();
        await expect(page.getByText('Calle Dos 200, Haedo').first()).toBeVisible();
        // The housing question was not taken as a record type, so only `tipo` is (3 unknown rows, not 6).
        await expect(page.getByTestId('import-unknown-types')).toContainText('3 filas');
    });

    test('the same person on two rows is one record, with every contact, until split', async ({ page }) => {
        await expect(page.getByText(/2 actividades · mismo email/)).toBeVisible();
        await expect(page.getByText('@zoe.formexport').first()).toBeVisible();
        await expect(page.getByText('11 5555 0192').first()).toBeVisible();
        await page.getByTestId('split-group').click();
        await expect(page.getByText(/2 actividades/)).toHaveCount(0);
        await expect(page.getByText(/^zoe formexportfixture$/i)).toHaveCount(2);
    });
});

test.describe('sheet import: the same person on several rows', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/import/sheet');
        await dismissCountryBanner(page);
        await expect(page.getByTestId('sheet-dropzone')).toBeVisible({ timeout: 30000 });
    });

    test('importing them makes ONE profile carrying both phones and both activities', async ({ page }) => {
        const csv = 'Nombre,Celular,Email,Mascota\n'
            + 'Lia Groupfixture,1155550181,lia.group@example.com,Toby\n'
            + 'lia groupfixture,1155550182,lia.group@example.com,Mora\n';
        await page.getByTestId('sheet-file-input').setInputFiles({ name: 'grupo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
        await expect(page.getByText(/2 actividades · mismo email/)).toBeVisible({ timeout: 30000 });
        await page.getByRole('button', { name: /Continuar a duplicados/ }).click();
        await page.getByRole('button', { name: /Importar 2 →/ }).click({ timeout: 60000 });
        await expect(page.getByText('Importación completa')).toBeVisible({ timeout: 60000 });
        await expect(page.getByText(/1 fila de la misma persona se agrupó/)).toBeVisible();
        const href = await page.getByRole('link', { name: /Ver perfil/ }).first().getAttribute('href');
        await page.goto(href!);
        await expect(page.getByText(/1155550181|11 5555-0181/).first()).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(/1155550182|11 5555-0182/).first()).toBeVisible();
        await expect(page.getByText('Toby').first()).toBeVisible();
        await expect(page.getByText('Mora').first()).toBeVisible();
    });
});
