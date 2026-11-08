import { test, expect } from '@playwright/test';
import { dismissCountryBanner } from './helpers';
import { cleanupProfiles, createProfileViaApi, fillAddForm, rows } from './householdFixtures';

/**
 * «¿Es este perfil?» → «No, es otra persona» is an answer, not a dismissal of a
 * popup (spec .agents/plans/2026-11-05-form-matches-are-duplicates.md, CX
 * addition 2): the new person and the rejected profile are recorded as two
 * people, so no later Scan asks again. Runs as the `user` project; own rows.
 */
const stamp = Date.now();
const s = String(stamp);
const made: string[] = [];
test.afterAll(() => cleanupProfiles(made));

const pairRow = (x: string, y: string) => rows(
    `SELECT status, resolved_by FROM duplicate_candidates WHERE (adopter1_id = '${x}' AND adopter2_id = '${y}') OR (adopter1_id = '${y}' AND adopter2_id = '${x}')`)[0];

test('«No, es otra persona» records the two as different people', async ({ page, request }) => {
    test.setTimeout(150_000);
    const phone = `11 3${s.slice(-3)}-${s.slice(-7, -3)}`;
    const anchor = await createProfileViaApi(request, { name: `Ancla No ${stamp}` });
    const existing = await createProfileViaApi(request, { name: `Rosa Existe No ${stamp}`, phone });
    made.push(anchor, existing);
    await page.goto(`/adopter/${anchor}`);
    await dismissCountryBanner(page);
    const typed = `Rosa Nueva No ${stamp}`;
    const form = await fillAddForm(page, { name: typed, phone });
    await form.getByTestId('hh-form-save').click();
    const cand = form.getByTestId('hh-candidate');
    await expect(cand).toBeVisible({ timeout: 30_000 });
    await cand.getByTestId('hh-candidate-no').click();
    await expect(page.getByTestId('household-member').filter({ hasText: typed })).toHaveCount(1, { timeout: 30_000 });
    const created = String(rows(`SELECT id FROM adopters WHERE name = '${typed}' AND deleted_at IS NULL`)[0].id);
    made.push(created);
    const pair = pairRow(created, existing);
    expect(pair?.status).toBe('dismissed');
    expect(pair?.resolved_by).toBe('testuser@example.com');
});

test('«No» to one, «Sí» to the next: nobody new, nothing recorded', async ({ page, request }) => {
    test.setTimeout(150_000);
    const phone = `11 2${s.slice(-3)}-${s.slice(-7, -3)}`;
    const anchor = await createProfileViaApi(request, { name: `Ancla Si ${stamp}` });
    const one = await createProfileViaApi(request, { name: `Uno Mismo Tel ${stamp}`, phone });
    const two = await createProfileViaApi(request, { name: `Dos Mismo Tel ${stamp}`, phone });
    made.push(anchor, one, two);
    await page.goto(`/adopter/${anchor}`);
    await dismissCountryBanner(page);
    const typed = `Tipeada Si ${stamp}`;
    const form = await fillAddForm(page, { name: typed, phone });
    await form.getByTestId('hh-form-save').click();
    const cand = form.getByTestId('hh-candidate');
    await expect(cand).toBeVisible({ timeout: 30_000 });
    const firstHref = await cand.getByTestId('hh-candidate-link').getAttribute('href');
    const firstId = (firstHref ?? '').split('/').pop()!.split('?')[0];
    await cand.getByTestId('hh-candidate-no').click();
    await expect(form.getByTestId('hh-candidate')).toBeVisible();
    await form.getByTestId('hh-candidate').getByTestId('hh-candidate-yes').click();
    await expect(form).toHaveCount(0, { timeout: 30_000 });
    expect(rows(`SELECT id FROM adopters WHERE name = '${typed}'`)).toHaveLength(0);
    const other = firstId === one ? two : one;
    expect(pairRow(firstId, other)?.status ?? null).not.toBe('dismissed');
    expect(rows(`SELECT id FROM duplicate_candidates WHERE status = 'dismissed' AND resolved_by = 'testuser@example.com' AND (adopter1_id = '${firstId}' OR adopter2_id = '${firstId}')`)).toHaveLength(0);
});
