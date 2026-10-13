import { test, expect, type Page } from '@playwright/test';
import { dismissCountryBanner } from './helpers';

/**
 * /import/sheet: the dotted upload box takes a dropped file, not only a click.
 * Before, dropping a file there made the browser open the file itself and the
 * import was lost. Events are dispatched with a real DataTransfer + File.
 */
async function dispatchFile(page: Page, selector: string, type: 'dragenter' | 'drop', name: string, body: string) {
    return page.evaluate(({ selector, type, name, body }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([body], name, { type: name.endsWith('.csv') ? 'text/csv' : 'application/pdf' }));
        const target = selector === 'body' ? document.body : document.querySelector(selector)!;
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
        target.dispatchEvent(ev);
        return ev.defaultPrevented;
    }, { selector, type, name, body });
}

test.describe('sheet import: drag and drop', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/import/sheet');
        await dismissCountryBanner(page);
        await expect(page.getByTestId('sheet-dropzone')).toBeVisible({ timeout: 30000 });
    });

    test('dragging over the box highlights it; dropping a CSV reads it like a picked file', async ({ page }) => {
        const zone = page.getByTestId('sheet-dropzone');
        await expect(zone).toContainText(/Arrastrá un archivo/);
        await dispatchFile(page, '[data-testid="sheet-dropzone"]', 'dragenter', 'lista.csv', '');
        await expect(zone).toHaveAttribute('data-dragover', 'true');
        await expect(zone).toContainText(/Soltá el archivo acá/);

        const prevented = await dispatchFile(page, '[data-testid="sheet-dropzone"]', 'drop', 'lista.csv',
            'Nombre,Telefono,Email\nAna Arrastrefixture,1155550199,ana.drop@example.com\n');
        expect(prevented).toBe(true);
        // The upload step is done: the box is gone and the sheet's row is on screen.
        await expect(zone).toHaveCount(0, { timeout: 30000 });
        await expect(page.getByText('Ana Arrastrefixture').first()).toBeVisible({ timeout: 30000 });
    });

    test('a file that is not a spreadsheet is refused with a message, staying on upload', async ({ page }) => {
        await dispatchFile(page, '[data-testid="sheet-dropzone"]', 'drop', 'contrato.pdf', '%PDF-1.4');
        await expect(page.getByText(/no es una planilla/)).toBeVisible();
        await expect(page.getByTestId('sheet-dropzone')).toBeVisible();
    });

    test('a file dropped outside the box does not make the browser open it', async ({ page }) => {
        const prevented = await dispatchFile(page, 'body', 'drop', 'lista.csv', 'Nombre\nX\n');
        expect(prevented).toBe(true);
        await expect(page).toHaveURL(/\/import\/sheet/);
    });

    test('an Excel file with more than one sheet is read (first sheet), not «e.map is not a function»', async ({ page }) => {
        // read-excel-file v9 returns every sheet as [{ sheet, data }]; the parser used to treat that as rows.
        await page.getByTestId('sheet-file-input').setInputFiles('tests/fixtures/two-sheets.xlsx');
        await expect(page.getByTestId('sheet-dropzone')).toHaveCount(0, { timeout: 30000 });
        await expect(page.getByText('Excela Fixtureperez').first()).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(/is not a function/)).toHaveCount(0);
    });
});
