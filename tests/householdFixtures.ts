import { execSync } from 'child_process';
import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Shared fixture helpers for the households-as-profiles e2e specs (Task 8).
 * Every row a spec writes carries its own prefix (test-*-fixture-*); the
 * profiles the UI makes have random ids, so cleanup also finds them through
 * the fixture's households.
 */

export function execD1(sql: string): string {
    return execSync(
        `npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`,
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
}

export function rows(sql: string): Array<Record<string, unknown>> {
    try {
        const wrapped = JSON.parse(execD1(sql));
        return (Array.isArray(wrapped) ? wrapped[0] : wrapped)?.results ?? [];
    } catch {
        return [];
    }
}

/** Wrangler's --json renders SQL NULL as the string "null" in CI — normalize. */
export const isDbNull = (v: unknown) => v === null || v === undefined || v === 'null';
export const sqlJson = (v: unknown) => JSON.stringify(v).replace(/'/g, "''");
export const ADMIN_EMAIL = 'gatitosolivos@gmail.com';
export const USER_EMAIL = 'testuser@example.com';

/** A profile written directly (no tokens: not findable by search — use `createProfileViaApi` for that). */
export function insertProfile(p: { id: string; name: string; owner: string; contacts?: unknown[]; age?: number | null; isMinor?: boolean; daysAgo?: number }) {
    const entries = p.contacts ?? [];
    const blob = entries.map(e => (e as { value?: string }).value ?? '').filter(Boolean).join('\n');
    const age = typeof p.age === 'number' ? String(p.age) : 'NULL';
    const asOf = typeof p.age === 'number' ? `'${new Date().toISOString().slice(0, 10)}'` : 'NULL';
    execD1(
        `INSERT OR REPLACE INTO adopters (id, name, contact_info, contact_entries, country, status, added_by, is_public, deleted_at, age, age_as_of, is_minor, created_at, updated_at) ` +
        `VALUES ('${p.id}', '${p.name.replace(/'/g, "''")}', '${blob.replace(/'/g, "''")}', '${sqlJson(entries)}', 'AR', '5', '${p.owner}', 0, NULL, ${age}, ${asOf}, ${p.isMinor ? 1 : 0}, strftime('%s','now','-${p.daysAgo ?? 5} days'), strftime('%s','now'))`,
    );
}

/** A household with its anchor row (no adder, next to nobody) and the given members next to the anchor. */
export function insertHousehold(householdId: string, anchorId: string, members: Array<{ id: string; adopterId: string; relationship?: string; addedBy: string; relativeTo?: string | null }>) {
    execD1(`INSERT OR REPLACE INTO households (id, created_by, created_at) VALUES ('${householdId}', NULL, strftime('%s','now','-5 days'))`);
    execD1(
        `INSERT OR REPLACE INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, gift_recipient, added_by, added_at, recorded_at) ` +
        `VALUES ('${householdId}-anchor', '${householdId}', '${anchorId}', 'unknown', NULL, 0, NULL, strftime('%s','now','-5 days'), strftime('%s','now','-5 days'))`,
    );
    members.forEach((m, i) => execD1(
        `INSERT OR REPLACE INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, gift_recipient, added_by, added_at, recorded_at) ` +
        `VALUES ('${m.id}', '${householdId}', '${m.adopterId}', '${m.relationship ?? 'unknown'}', ${m.relativeTo === null ? 'NULL' : `'${m.relativeTo ?? anchorId}'`}, 0, '${m.addedBy}', strftime('%s','now','-${4 - Math.min(i, 3)} days'), strftime('%s','now','-4 days'))`,
    ));
}

/** A profile made through the app (tokenized, so search and «¿Es este perfil?» find it), as the context's session user. */
export async function createProfileViaApi(request: APIRequestContext, p: { name: string; phone?: string; email?: string }): Promise<string> {
    const entries = [
        ...(p.phone ? [{ id: `e2e-p-${Date.now()}`, type: 'phone', value: p.phone }] : []),
        ...(p.email ? [{ id: `e2e-e-${Date.now()}`, type: 'email', value: p.email }] : []),
    ];
    const res = await request.post('/api/adopters', { data: { name: p.name, contactEntries: JSON.stringify(entries) } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { id } = await res.json() as { id: string };
    expect(id).toBeTruthy();
    return id;
}

/** Everyone who lives with `adopterId` (any household), straight from the tables. */
export function housemates(adopterId: string): Array<{ profileId: string; addedBy: unknown; relationship: unknown; householdId: unknown }> {
    return rows(
        `SELECT o.adopter_id AS profileId, o.added_by AS addedBy, o.relationship AS relationship, o.household_id AS householdId FROM household_memberships m ` +
        `JOIN household_memberships o ON o.household_id = m.household_id AND o.adopter_id <> m.adopter_id WHERE m.adopter_id = '${adopterId}' ORDER BY o.added_at`,
    ) as Array<{ profileId: string; addedBy: unknown; relationship: unknown; householdId: unknown }>;
}

/** The live profile of that name made at/after `sinceMs` (the UI makes them with random ids). */
export function profileNamed(name: string): Record<string, unknown> | undefined {
    return rows(`SELECT * FROM adopters WHERE name = '${name.replace(/'/g, "''")}' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)[0];
}

/** Deletes the given profiles and everything a household spec leaves on them, and every household they were in. */
export function cleanupProfiles(ids: string[]) {
    const all = new Set(ids.filter(Boolean));
    // Anyone the UI added to these profiles' households goes too.
    for (const id of [...all]) for (const h of housemates(id)) all.add(String(h.profileId));
    const households = new Set<string>();
    for (const id of all) for (const r of rows(`SELECT household_id AS h FROM household_memberships WHERE adopter_id = '${id}'`)) households.add(String(r.h));
    for (const h of households) {
        execD1(`DELETE FROM household_memberships WHERE household_id = '${h}'`);
        execD1(`DELETE FROM household_corrections WHERE household_id = '${h}'`);
        execD1(`DELETE FROM households WHERE id = '${h}'`);
    }
    for (const id of all) {
        for (const table of ['adopter_history', 'pii_access_grants', 'pii_access_requests', 'duplicate_tokens', 'adopter_flags', 'adopter_events', 'placements', 'household_corrections', 'household_conversions']) {
            const col = table === 'household_conversions' ? 'profile_id' : 'adopter_id';
            try { execD1(`DELETE FROM ${table} WHERE ${col} = '${id}'`); } catch { /* table/column absent on an older seed: nothing to clean */ }
        }
        execD1(`DELETE FROM duplicate_candidates WHERE adopter1_id = '${id}' OR adopter2_id = '${id}'`);
        execD1(`DELETE FROM notifications WHERE url LIKE '%${id}%'`);
        execD1(`DELETE FROM adopters WHERE id = '${id}'`);
    }
}

/** A non-admin rescuer: user + profile rows and a signed-in context (the pattern of tests/one-reality.authed.spec.ts). */
export async function rescuerContext(browser: Browser, tag: string, stamp: number): Promise<{ email: string; name: string; page: Page; close: () => Promise<void> }> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET is not set: session cookies are signed with it (.env.local).');
    const id = `test-hh-fixture-user-${tag}-${stamp}`;
    const email = `hh-${tag}-${stamp}@example.com`;
    const name = `Hh ${tag.toUpperCase()} ${stamp}`;
    execD1(`INSERT OR REPLACE INTO user (id, name, email, emailVerified, image) VALUES ('${id}', '${name}', '${email}', strftime('%s','now'), NULL)`);
    execD1(`INSERT OR REPLACE INTO user_profiles (user_id, country, country_confirmed, terms_version, terms_accepted_at) VALUES ('${id}', 'AR', 1, 1, strftime('%s','now'))`);
    const { encode } = await import('next-auth/jwt');
    const token = await encode({ secret, token: { email, name, sub: id, sessionVersion: 3 }, salt: 'authjs.session-token' });
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await ctx.addCookies([{ name: 'authjs.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await ctx.addInitScript((e) => {
        localStorage.setItem(`country_confirmed_${e}`, '1');
        localStorage.setItem('playwright_test_mode', '1');
    }, email);
    const page = await ctx.newPage();
    return {
        email, name, page,
        close: async () => {
            await ctx.close();
            execD1(`DELETE FROM user_profiles WHERE user_id = '${id}'`);
            execD1(`DELETE FROM user WHERE id = '${id}'`);
            execD1(`DELETE FROM notifications WHERE user_id = '${email}'`);
        },
    };
}

/** Opens a member card's ⋯ menu and picks an item (edit | remove | delete | request). */
export async function memberMenu(card: ReturnType<Page['getByTestId']>, item: 'edit' | 'remove' | 'delete' | 'request') {
    await card.getByTestId('household-member-menu').click();
    const pick = card.getByTestId(`household-member-menu-${item}`);
    await expect(pick).toBeVisible({ timeout: 15_000 });
    await expect(pick).toBeEnabled({ timeout: 15_000 });
    await pick.click();
}

/** The add form: name, relationship, age, one phone; then «Guardar» (the «¿Es este perfil?» check runs). */
export async function fillAddForm(page: Page, p: { name?: string; relationship?: string; age?: number; phone?: string }) {
    await page.getByTestId('household-add-member').first().click();
    const form = page.getByTestId('hh-add-form');
    await expect(form).toBeVisible({ timeout: 15_000 });
    if (p.name) await form.getByTestId('hh-person-name').fill(p.name);
    if (p.relationship) await form.getByTestId('hh-person-rel').selectOption(p.relationship);
    if (typeof p.age === 'number') await form.getByTestId('hh-person-age').fill(String(p.age));
    if (p.phone) {
        await form.getByTestId('hh-add-contact').click();
        await form.getByTestId('hh-add-contact-type-phone').click();
        await form.getByTestId('hh-add-contact-input').fill(p.phone);
        await form.getByTestId('hh-add-contact-save').click();
        await expect(form.getByTestId('hh-add-draft')).toHaveCount(1);
    }
    return form;
}
