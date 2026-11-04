import { execD1, execD1Batch, rows, sqlJson } from './db';
import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Shared fixture helpers for the households-as-profiles e2e specs (Task 8).
 * Every row a spec writes carries its own prefix (test-*-fixture-*); the
 * profiles the UI makes have random ids, so cleanup also finds them through
 * the fixture's households.
 */

// The DB helpers live in ./db (shared by every spec); re-exported so the household specs keep one import.
export { execD1, execD1Batch, isDbNull, rows, sqlJson } from './db';
export const ADMIN_EMAIL = 'gatitosolivos@gmail.com';
export const USER_EMAIL = 'testuser@example.com';

/** A profile written directly (no tokens: not findable by search — use `createProfileViaApi` for that). */
export function profileSql(p: { id: string; name: string; owner: string; contacts?: unknown[]; age?: number | null; isMinor?: boolean; daysAgo?: number }) {
    const entries = p.contacts ?? [];
    const blob = entries.map(e => (e as { value?: string }).value ?? '').filter(Boolean).join('\n');
    const age = typeof p.age === 'number' ? String(p.age) : 'NULL';
    const asOf = typeof p.age === 'number' ? `'${new Date().toISOString().slice(0, 10)}'` : 'NULL';
    return (
        `INSERT OR REPLACE INTO adopters (id, name, contact_info, contact_entries, country, status, added_by, is_public, deleted_at, age, age_as_of, is_minor, created_at, updated_at) ` +
        `VALUES ('${p.id}', '${p.name.replace(/'/g, "''")}', '${blob.replace(/'/g, "''")}', '${sqlJson(entries)}', 'AR', '5', '${p.owner}', 0, NULL, ${age}, ${asOf}, ${p.isMinor ? 1 : 0}, strftime('%s','now','-${p.daysAgo ?? 5} days'), strftime('%s','now'))`
    );
}

export function insertProfile(p: Parameters<typeof profileSql>[0]) {
    execD1(profileSql(p));
}

/** A household with its anchor row (no adder, next to nobody) and the given members next to the anchor. */
export function householdSql(householdId: string, anchorId: string, members: Array<{ id: string; adopterId: string; relationship?: string; addedBy: string; relativeTo?: string | null }>): string[] {
    return [
        `INSERT OR REPLACE INTO households (id, created_by, created_at) VALUES ('${householdId}', NULL, strftime('%s','now','-5 days'))`,
        `INSERT OR REPLACE INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, gift_recipient, added_by, added_at, recorded_at) ` +
        `VALUES ('${householdId}-anchor', '${householdId}', '${anchorId}', 'unknown', NULL, 0, NULL, strftime('%s','now','-5 days'), strftime('%s','now','-5 days'))`,
        ...members.map((m, i) =>
            `INSERT OR REPLACE INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, gift_recipient, added_by, added_at, recorded_at) ` +
            `VALUES ('${m.id}', '${householdId}', '${m.adopterId}', '${m.relationship ?? 'unknown'}', ${m.relativeTo === null ? 'NULL' : `'${m.relativeTo ?? anchorId}'`}, 0, '${m.addedBy}', strftime('%s','now','-${4 - Math.min(i, 3)} days'), strftime('%s','now','-4 days'))`),
    ];
}

export function insertHousehold(householdId: string, anchorId: string, members: Parameters<typeof householdSql>[2]) {
    execD1Batch(householdSql(householdId, anchorId, members));
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
    if (all.size === 0) return;
    const inList = (set: Iterable<string>) => [...set].map(id => `'${id}'`).join(', ');
    // Anyone the UI added to these profiles' households goes too.
    for (const r of rows(
        `SELECT DISTINCT o.adopter_id AS p FROM household_memberships m JOIN household_memberships o ON o.household_id = m.household_id AND o.adopter_id <> m.adopter_id WHERE m.adopter_id IN (${inList(all)})`,
    )) all.add(String(r.p));
    const households = rows(`SELECT DISTINCT household_id AS h FROM household_memberships WHERE adopter_id IN (${inList(all)})`).map(r => String(r.h));
    // One batch (one transaction): every table is in the CI seed, so a missing one must fail loudly.
    const stmts: string[] = [];
    for (const h of households) {
        stmts.push(`DELETE FROM household_memberships WHERE household_id = '${h}'`);
        stmts.push(`DELETE FROM household_corrections WHERE household_id = '${h}'`);
        stmts.push(`DELETE FROM households WHERE id = '${h}'`);
    }
    for (const id of all) {
        for (const table of ['adopter_history', 'pii_access_grants', 'pii_access_requests', 'duplicate_tokens', 'adopter_flags', 'adopter_events', 'placements', 'household_corrections', 'household_conversions']) {
            const col = table === 'household_conversions' ? 'profile_id' : 'adopter_id';
            stmts.push(`DELETE FROM ${table} WHERE ${col} = '${id}'`);
        }
        stmts.push(`DELETE FROM duplicate_candidates WHERE adopter1_id = '${id}' OR adopter2_id = '${id}'`);
        stmts.push(`DELETE FROM notifications WHERE url LIKE '%${id}%'`);
        stmts.push(`DELETE FROM adopters WHERE id = '${id}'`);
    }
    execD1Batch(stmts);
}

/** A non-admin rescuer: user + profile rows and a signed-in context (the pattern of tests/one-reality.authed.spec.ts). */
export async function rescuerContext(browser: Browser, tag: string, stamp: number): Promise<{ email: string; name: string; page: Page; close: () => Promise<void> }> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET is not set: session cookies are signed with it (.env.local).');
    const id = `test-hh-fixture-user-${tag}-${stamp}`;
    const email = `hh-${tag}-${stamp}@example.com`;
    const name = `Hh ${tag.toUpperCase()} ${stamp}`;
    execD1Batch([
        `INSERT OR REPLACE INTO user (id, name, email, emailVerified, image) VALUES ('${id}', '${name}', '${email}', strftime('%s','now'), NULL)`,
        `INSERT OR REPLACE INTO user_profiles (user_id, country, country_confirmed, terms_version, terms_accepted_at) VALUES ('${id}', 'AR', 1, 1, strftime('%s','now'))`,
    ]);
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
            execD1Batch([
                `DELETE FROM user_profiles WHERE user_id = '${id}'`,
                `DELETE FROM user WHERE id = '${id}'`,
                `DELETE FROM notifications WHERE user_id = '${email}'`,
            ]);
        },
    };
}

/** The open «⋯» menu of a member card — rendered on <body>, so found on the page, not inside the card. */
export function memberMenuPanel(card: ReturnType<Page['getByTestId']>) {
    return card.page().getByTestId('household-member-menu-panel');
}

/** Opens a member card's ⋯ menu and picks an item (edit | remove | delete | request). */
export async function memberMenu(card: ReturnType<Page['getByTestId']>, item: 'edit' | 'remove' | 'delete' | 'request') {
    await card.getByTestId('household-member-menu').click();
    // The panel is on <body> (AnchoredMenu), not inside the card: one menu is open at a time.
    const pick = memberMenuPanel(card).getByTestId(`household-member-menu-${item}`);
    await expect(pick).toBeVisible({ timeout: 15_000 });
    await expect(pick).toBeEnabled({ timeout: 15_000 });
    await pick.click();
}

/**
 * The add form: name, relationship, one phone (no age: it isn't entered in the app — Jon, 2026-10-29). «+ Agregar» is one button
 * per section; with 2+ homes it asks «¿En qué hogar?» first — `home` is the
 * household id to pick there (required then, ignored otherwise).
 */
export async function fillAddForm(page: Page, p: { name?: string; relationship?: string; phone?: string }, home?: string) {
    const button = page.getByTestId('household-add-member');
    await expect(button).toHaveCount(1);
    await button.click();
    if (home) await page.getByTestId('household-add-which').locator(`[data-household-id="${home}"]`).click();
    const form = page.getByTestId('hh-add-form');
    await expect(form).toBeVisible({ timeout: 15_000 });
    if (p.name) await form.getByTestId('hh-person-name').fill(p.name);
    if (p.relationship) await form.getByTestId('hh-person-rel').selectOption(p.relationship);
    if (p.phone) {
        // The profile's own contact list (ContactEntriesSection, prefix «hh-add-contact»).
        await form.getByTestId('hh-add-contact-add-trigger').click();
        await form.getByTestId('hh-add-contact-type-phone').click();
        await form.getByTestId('hh-add-contact-composer-input').fill(p.phone);
        await form.getByTestId('hh-add-contact-composer-submit').click();
        await expect(form.getByTestId('hh-add-contact-chip')).toHaveCount(1);
    }
    return form;
}

/** «Guardar» on the add form; a weak «¿Es este perfil?» on someone unrelated is answered «No» (a race, never a fixed wait). */
export async function saveAsNew(page: Page) {
    const form = page.getByTestId('hh-add-form');
    await form.getByTestId('hh-form-save').click();
    for (let i = 0; i < 4; i++) {
        const candidate = form.getByTestId('hh-candidate');
        const done = form.waitFor({ state: 'detached', timeout: 20_000 }).then(() => 'done' as const).catch(() => 'timeout' as const);
        const asked = candidate.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'asked' as const).catch(() => 'timeout' as const);
        const first = await Promise.race([done, asked]);
        if (first !== 'asked') break;
        await candidate.getByTestId('hh-candidate-no').click();
    }
    await expect(form).toHaveCount(0, { timeout: 30_000 });
}
