import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * Admins can delete a triggered notification from /admin/notifications.
 * Destructive, so: dedicated fixture rows, admin-only, confirmed, audited.
 */
const KEEP = 'test-notif-delete-fixture-keep';
const DROP = 'test-notif-delete-fixture-drop';
const TYPE = 'e2e_delete_fixture';

function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
}
const ids = () => (JSON.parse(execD1(`SELECT id FROM notifications WHERE type='${TYPE}' ORDER BY id`))[0].results as Array<{ id: string }>).map(r => r.id);

test.describe('admin deletes a notification', () => {
    test.beforeEach(() => {
        execD1(`DELETE FROM notifications WHERE type='${TYPE}'`);
        execD1(
            `INSERT INTO notifications (id,user_id,type,title,body,url,icon,read,dismissed,created_at) VALUES ` +
            `('${DROP}','testuser@example.com','${TYPE}','Fixture a borrar','Se borra en el test.','/','x',0,0,strftime('%s','now')), ` +
            `('${KEEP}','testuser@example.com','${TYPE}','Fixture que queda','No se toca.','/','x',0,0,strftime('%s','now','-1 minute'))`,
        );
    });
    test.afterAll(() => { execD1(`DELETE FROM notifications WHERE type='${TYPE}'`); });

    test('deletes only the chosen one, after confirming', async ({ page }) => {
        await page.goto('/admin/notifications');
        await dismissCountryBanner(page);
        await page.getByText(TYPE, { exact: true }).first().click();
        const row = page.locator(`[data-notification-id="${DROP}"]`);
        await expect(row).toBeVisible({ timeout: 30000 });
        await expect(row.getByText('testuser@example.com')).toBeVisible();
        await expect(row.getByTestId('notif-seen-state')).toHaveText('Sin ver');

        // Declining the confirmation deletes nothing.
        page.once('dialog', d => d.dismiss());
        await row.getByRole('button', { name: /Eliminar/ }).click();
        await page.waitForTimeout(800);
        expect(ids()).toEqual([DROP, KEEP].sort());

        page.once('dialog', d => d.accept());
        await row.getByRole('button', { name: /Eliminar/ }).click();
        await expect(row).toHaveCount(0, { timeout: 15000 });
        await expect(page.locator(`[data-notification-id="${KEEP}"]`)).toBeVisible();
        expect(ids()).toEqual([KEEP]);
        // Audited: who deleted it, which one, whose it was — and not the message text.
        const audit = JSON.parse(execD1(`SELECT user_email, target, details FROM audit_log WHERE action='notification_deleted' AND target='${DROP}' ORDER BY rowid DESC LIMIT 1`))[0].results as Array<{ user_email: string; target: string; details: string }>;
        expect(audit).toHaveLength(1);
        expect(audit[0].user_email).toBe('gatitosolivos@gmail.com');
        expect(JSON.parse(audit[0].details)).toEqual({ type: TYPE, recipient: 'testuser@example.com' });
    });

    test('deleting one that is already gone is not an error, and a bad id is refused', async ({ page }) => {
        expect((await page.request.delete('/api/admin/notifications?id=test-notif-does-not-exist')).status()).toBe(404);
        expect((await page.request.delete('/api/admin/notifications?id=')).status()).toBe(400);
        expect(ids()).toEqual([DROP, KEEP].sort());
    });

    test('a non-admin cannot delete one through the API', async ({ browser }) => {
        const ctx = await browser.newContext({ storageState: '.auth/user.json' });
        const res = await ctx.request.delete(`/api/admin/notifications?id=${DROP}`);
        expect(res.status()).toBe(403);
        expect(ids()).toEqual([DROP, KEEP].sort());
        await ctx.close();
    });

    test('an anonymous caller cannot either', async ({ browser }) => {
        const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const res = await ctx.request.delete(`/api/admin/notifications?id=${DROP}`);
        expect(res.status()).toBe(401);
        expect(ids()).toEqual([DROP, KEEP].sort());
        await ctx.close();
    });
});
