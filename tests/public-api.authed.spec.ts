import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Third-party API v1 (.agents/plans/2026-10-09-third-party-api.md), end to end:
 * the admin issues a key, a "partner" (no cookies, Bearer key) searches,
 * saves, retries and voids, and both review surfaces show the calls.
 * Every exact search saves a record; the look-ups that must not write use the
 * admin-only read-only mode (X-Dry-Run), which this admin-owned key may use.
 *
 * ENABLE_PUBLIC_API is off in the seed; this file turns it on for itself and
 * is the ONLY spec that touches it (serial). Every person it creates is unique
 * to the run (letters-only stamp: digits in a name would tokenize as a phone).
 */
function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const flagOn = () => execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_PUBLIC_API', 'true', strftime('%s','now'), 'e2e')`);
const flagOff = () => execD1(`DELETE FROM app_config WHERE key = 'ENABLE_PUBLIC_API'`);

const STAMP = String(Date.now());
const TAG = STAMP.split('').map(d => 'abcdefghij'[Number(d)]).join('');
const NAME = `Apifixture ${TAG.charAt(0).toUpperCase()}${TAG.slice(1)}`;
const PHONE_TAIL = STAMP.slice(-8);
const LOCAL_PHONE = `11 ${PHONE_TAIL.slice(0, 4)}-${PHONE_TAIL.slice(4)}`;
const INTL_PHONE = `+54 9 11 ${PHONE_TAIL.slice(0, 4)} ${PHONE_TAIL.slice(4)}`;
const EMAIL = `api-${STAMP}@example.com`;
const NEW_PHONE = `11 ${String(Number(PHONE_TAIL) + 1).padStart(8, '0').slice(-8, -4)}-${String(Number(PHONE_TAIL) + 1).padStart(8, '0').slice(-4)}`;
const ADMIN_EMAIL = 'gatitosolivos@gmail.com';

test.describe.configure({ mode: 'serial' });

test.describe('public API v1', () => {
    let secret = '';
    let keyId = '';
    let api: APIRequestContext;
    let recordId = '';
    let profileId = '';

    test.beforeAll(async ({ baseURL }) => {
        flagOn();
        api = await pwRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    });
    test.afterAll(async () => {
        flagOff();
        await api?.dispose();
    });

    const auth = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${secret}`, ...extra });
    const search = (data: unknown, headers: Record<string, string> = {}) =>
        api.post('/api/v1/search', { data, headers: auth(headers) });
    // A read-only exact look-up: same answer as a real call, nothing written.
    let dryN = 0;
    const check = (data: unknown) => search(data, { 'x-dry-run': '1', 'idempotency-key': `dry-${++dryN}-${STAMP}` });
    // A look-up without activity (no dry run): only for people this rescue registered.
    const lookup = (person: unknown, key = secret) => api.post('/api/v1/search', { data: { mode: 'exact', person }, headers: { authorization: `Bearer ${key}` } });
    const countRows = (sql: string) => JSON.parse(execD1(sql))[0].results[0].n as number;

    test('admin issues a key; the secret is shown once and works for /me', async ({ page }) => {
        const res = await page.request.post('/api/admin/api-keys', { data: { ownerEmail: ADMIN_EMAIL, name: `E2E ${TAG}` } });
        expect(res.status()).toBe(201);
        const issued = await res.json();
        expect(issued.secret).toMatch(/^ba_test_[A-Za-z0-9]{43}$/);
        secret = issued.secret;
        keyId = issued.id;

        expect((await api.get('/api/v1/me')).status()).toBe(401);
        expect((await api.get('/api/v1/me', { headers: { authorization: 'Bearer ba_test_notarealkeynotarealkeynotarealkey12345' } })).status()).toBe(401);
        const me = await api.get('/api/v1/me', { headers: auth() });
        expect(me.status()).toBe(200);
        const body = await me.json();
        expect(body.rescuer.email).toBe(ADMIN_EMAIL);
        expect(body.key.scopes).toEqual(['search', 'search:fuzzy', 'record:write']);
        expect(me.headers()['x-request-id']).toBe(body.requestId);
    });

    test('validation: full name + identifier, a real full name, no activity in fuzzy, a key on every saving call, forms only on requests', async () => {
        const noId = await search({ mode: 'exact', person: { fullName: NAME }, activity: { activityType: 'adoption_request' } });
        expect(noId.status()).toBe(422);
        expect((await noId.json()).error.code).toBe('exact_requires_name_and_identifier');

        const oneWord = await search({ mode: 'exact', person: { fullName: 'María', phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } });
        expect((await oneWord.json()).error.code).toBe('full_name_required');

        const fuzzyActivity = await search({ mode: 'fuzzy', person: { fullName: NAME }, activity: { activityType: 'adoption_request' } });
        expect((await fuzzyActivity.json()).error.code).toBe('activity_requires_exact');

        const formOnObservation = await search({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'observation', formContent: { a: 1 } } }, { 'idempotency-key': `form-obs-${STAMP}` });
        expect((await formOnObservation.json()).error.code).toBe('form_content_requires_adoption_request');
        const tooDeep = await search({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request', formContent: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } } }, { 'idempotency-key': `form-deep-${STAMP}` });
        expect(tooDeep.status()).toBe(422);

        const badRating = await search({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'observation', rating: 7 } }, { 'idempotency-key': `bad-${STAMP}` });
        expect(badRating.status()).toBe(422);

        // Every call that saves an activity needs an Idempotency-Key.
        const noKey = await search({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } });
        expect((await noKey.json()).error.code).toBe('idempotency_key_required');
        expect(countRows(`SELECT count(*) AS n FROM adopters WHERE name = '${NAME}'`)).toBe(0);
    });

    test('admin dry run: the same answer, nothing written, logged as a test', async () => {
        const dry = await check({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } });
        expect(dry.status()).toBe(200);
        expect(dry.headers()['x-dry-run']).toBe('1');
        const d = await dry.json();
        expect(d.result).toBe('not_found');
        expect(d.activity).toBeUndefined();
        expect(d.risk).toEqual({ worstRating: { rating: null, ratingLevel: 0, ratingLabel: 'not_rated' }, flags: [], profilesMatched: 0 });
        expect(countRows(`SELECT count(*) AS n FROM adopters WHERE name = '${NAME}'`)).toBe(0);
        expect(countRows(`SELECT count(*) AS n FROM api_requests WHERE id = '${d.requestId}' AND dry_run = 1 AND record_id IS NULL AND outcome = 'not_found'`)).toBe(1);
        // A void can't be a dry run.
        const v = await api.post('/api/v1/activities/whatever/void', { headers: auth({ 'x-dry-run': '1' }) });
        expect((await v.json()).error.code).toBe('dry_run_not_allowed');
    });

    test('a rescue\'s own key cannot dry-run: refused, never silently saved', async ({ page }) => {
        const res = await page.request.post('/api/admin/api-keys', { data: { ownerEmail: 'testuser@example.com', name: `E2E user ${TAG}` } });
        expect(res.status()).toBe(201);
        const userKey = await res.json();
        const stranger = `Dryrunfixture ${TAG.charAt(0).toUpperCase()}${TAG.slice(1)}`;
        const r = await api.post('/api/v1/search', {
            data: { mode: 'exact', person: { fullName: stranger, email: `dry-${STAMP}@example.com` }, activity: { activityType: 'adoption_request' } },
            headers: { authorization: `Bearer ${userKey.secret}`, 'x-dry-run': '1', 'idempotency-key': `user-dry-${STAMP}` },
        });
        expect(r.status()).toBe(403);
        expect((await r.json()).error.code).toBe('dry_run_not_allowed');
        expect(countRows(`SELECT count(*) AS n FROM adopters WHERE name = '${stranger}'`)).toBe(0);
        await page.request.patch(`/api/admin/api-keys/${userKey.id}`, { data: { revoke: true } });
    });

    test('unknown person → not_found; the call creates the profile and the activity, unrated, with the form answers', async () => {
        const body = {
            mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE, email: EMAIL },
            activity: {
                activityType: 'adoption_request', externalId: `ext-${STAMP}`, animalName: 'Luna', species: 'P',
                formContent: { '¿Tenés patio?': 'Sí', '¿Quiénes viven en la casa?': ['2 adultos', '1 niño'], mascotas: [{ tipo: 'gato', edad: 3 }], acepta_seguimiento: true } as Record<string, unknown> | undefined,
            },
        };
        const saved = await search(body, { 'idempotency-key': `save-${STAMP}` });
        expect(saved.status()).toBe(200);
        const s = await saved.json();
        expect(s.result).toBe('not_found');
        expect(s.activity.profileCreated).toBe(true);
        expect(s.activity.contactsAdded).toEqual([]);
        expect(s.activity.activityUrl).toContain(`/adopter/${s.activity.profileId}?record=${s.activity.activityId}`);
        recordId = s.activity.activityId;
        profileId = s.activity.profileId;
        // The form answers are stored as sent; species was read from a code.
        expect(countRows(`SELECT count(*) AS n FROM activity_forms WHERE activity_id = '${recordId}'`)).toBe(1);
        expect(countRows(`SELECT count(*) AS n FROM adoptions WHERE id = '${recordId}' AND species = 'dog'`)).toBe(1);

        // A retry with the same key and body replays the answer and writes nothing.
        const replay = await search(body, { 'idempotency-key': `save-${STAMP}` });
        const r = await replay.json();
        expect(r.replayed).toBe(true);
        expect(r.activity.activityId).toBe(recordId);
        // Same key, different body → refused.
        const clash = await search({ ...body, activity: { ...body.activity, activityType: 'observation', formContent: undefined } }, { 'idempotency-key': `save-${STAMP}` });
        expect(clash.status()).toBe(409);
        // Same externalId under a new idempotency key → refused.
        const dupExt = await search(body, { 'idempotency-key': `save2-${STAMP}` });
        expect((await dupExt.json()).error.code).toBe('external_id_reused');
    });

    test('a look-up without activity: answered only for people this rescue registered, saves nothing', async ({ page }) => {
        const mine = await lookup({ fullName: NAME, email: EMAIL });
        expect(mine.status()).toBe(200);
        const m = await mine.json();
        expect(m.result).toBe('found');
        expect(m.activity).toBeUndefined();
        expect(m.risk.profilesMatched).toBe(1);
        expect(countRows(`SELECT count(*) AS n FROM adoptions WHERE adopter_id = '${profileId}'`)).toBe(1);

        // Another rescue (no shared organization) and a stranger get the very same refusal.
        const res = await page.request.post('/api/admin/api-keys', { data: { ownerEmail: 'testuser@example.com', name: `E2E lookup ${TAG}` } });
        const userKey = await res.json();
        const other = await lookup({ fullName: NAME, email: EMAIL }, userKey.secret);
        const nobody = await lookup({ fullName: 'Nadie Conocido', email: `nadie-${STAMP}@example.com` });
        for (const r of [other, nobody]) {
            expect(r.status()).toBe(422);
            const e = await r.json();
            expect(e.error).toEqual({ code: 'activity_required', message: 'send an activity: an exact call without one is only answered for people your rescue already registered' });
            // A refusal records nothing about who matched.
            expect(countRows(`SELECT count(*) AS n FROM api_requests WHERE id = '${e.requestId}' AND profile_ids IS NULL AND outcome = 'error'`)).toBe(1);
        }

        // Another rescue registers a stranger on the same phone. Our look-up of OUR
        // person must not reveal them (no otherMatches, not counted in risk).
        const strangerRes = await api.post('/api/v1/search', {
            data: { mode: 'exact', person: { fullName: 'Extrañafixture Ajena', phone: LOCAL_PHONE }, activity: { activityType: 'observation' } },
            headers: { authorization: `Bearer ${userKey.secret}`, 'idempotency-key': `stranger-${STAMP}` },
        });
        const stranger = await strangerRes.json();
        expect(stranger.activity.profileCreated).toBe(true);
        const ours = await (await lookup({ fullName: NAME, phone: LOCAL_PHONE })).json();
        expect(ours.result).toBe('found');
        expect(ours.otherMatches).toBeUndefined();
        expect(ours.risk.profilesMatched).toBe(1);
        expect(JSON.stringify(ours)).not.toContain(stranger.activity.profileId);
        const v = await api.post(`/api/v1/activities/${stranger.activity.activityId}/void`, { headers: { authorization: `Bearer ${userKey.secret}` } });
        expect((await v.json()).profileVoided).toBe(true);
        await page.request.patch(`/api/admin/api-keys/${userKey.id}`, { data: { revoke: true } });
    });

    test('the same person in another phone format → found, with one request and no rating', async () => {
        const res = await check({ mode: 'exact', person: { fullName: `${NAME.split(' ')[1]}, ${NAME.split(' ')[0]}`, phone: INTL_PHONE }, activity: { activityType: 'adoption_request' } });
        const b = await res.json();
        expect(b.result).toBe('found');
        expect(b.profile.profileId).toBe(profileId);
        expect(b.profile.matchedOn).toEqual(['phone']);
        expect(b.profile.nameMatchedAs).toBe('profile');
        expect(b.profile.records).toEqual({ adoption_request: 1 });
        expect(b.profile.ratingLabel).toBe('not_rated');
        expect(b.profile.url).toContain(`/adopter/${profileId}`);

        const byEmail = await check({ mode: 'exact', person: { fullName: NAME, email: EMAIL.toUpperCase() }, activity: { activityType: 'adoption_request' } });
        expect((await byEmail.json()).profile.matchedOn).toEqual(['email']);
    });

    let secondRecordId = '';
    test('a known person → the activity goes on THAT profile; the answer is the person before the call', async () => {
        const res = await search(
            { mode: 'exact', person: { fullName: NAME, email: EMAIL }, activity: { activityType: 'observation', rating: 1, notes: 'No respondió más' } },
            { 'idempotency-key': `obs-${STAMP}` },
        );
        const b = await res.json();
        expect(b.result).toBe('found');
        expect(b.activity.profileCreated).toBe(false);
        expect(b.activity.profileId).toBe(profileId);
        expect(b.profile.records).toEqual({ adoption_request: 1 }); // before this call
        expect(b.profile.ratingLabel).toBe('not_rated');
        secondRecordId = b.activity.activityId;

        const after = await (await check({ mode: 'exact', person: { fullName: NAME, email: EMAIL }, activity: { activityType: 'observation' } })).json();
        expect(after.profile.records).toEqual({ adoption_request: 1, observation: 1 });
        expect(after.profile.ratingLabel).toBe('dangerous');
    });

    test('an activity with only its type still saves; a new phone for a known person is added, with a trail, and void takes it back', async () => {
        const res = await search({ mode: 'exact', person: { fullName: NAME, email: EMAIL }, activity: { activityType: 'follow_up' } }, { 'idempotency-key': `plain-${STAMP}` });
        const b = await res.json();
        expect(b.result).toBe('found');
        expect(b.activity.profileId).toBe(profileId);
        expect(b.activity.profileCreated).toBe(false);
        const after = await (await check({ mode: 'exact', person: { fullName: NAME, email: EMAIL }, activity: { activityType: 'follow_up' } })).json();
        expect(after.profile.records.follow_up).toBe(1);
        // Found by email, with a phone the profile didn't have: it is added and logged.
        const withPhone = await (await search({ mode: 'exact', person: { fullName: NAME, email: EMAIL, phone: NEW_PHONE }, activity: { activityType: 'follow_up' } }, { 'idempotency-key': `newphone-${STAMP}` })).json();
        expect(withPhone.activity.contactsAdded).toEqual(['phone']);
        expect(countRows(`SELECT count(*) AS n FROM adopter_history WHERE adopter_id = '${profileId}' AND changes LIKE '%contacts_added_via_api%'`)).toBe(1);
        const byNewPhone = await (await check({ mode: 'exact', person: { fullName: NAME, phone: NEW_PHONE }, activity: { activityType: 'observation' } })).json();
        expect(byNewPhone.result).toBe('found');
        expect(byNewPhone.profile.profileId).toBe(profileId);
        // Put the person back as the next tests expect: void both; the added phone comes back off.
        for (const id of [b.activity.activityId, withPhone.activity.activityId]) {
            const v = await api.post(`/api/v1/activities/${id}/void`, { headers: auth() });
            expect((await v.json()).profileVoided).toBe(false);
        }
        expect((await (await check({ mode: 'exact', person: { fullName: NAME, phone: NEW_PHONE }, activity: { activityType: 'observation' } })).json()).result).toBe('not_found');
    });

    test('same phone, unrelated name → ambiguous name_mismatch, never a guess', async () => {
        const res = await check({ mode: 'exact', person: { fullName: 'Otra Persona Distinta', phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } });
        const b = await res.json();
        expect(b.result).toBe('ambiguous');
        expect(b.reason).toBe('name_mismatch');
        expect(b.candidates).toBe(1);
        // The previous test rated this person 1★: an ambiguous answer still lets the client block.
        expect(b.worstRating.ratingLabel).toBe('dangerous');
        expect(b.risk.worstRating.ratingLabel).toBe('dangerous');
        expect(b.risk.profilesMatched).toBe(1);
        expect(b.profile).toBeUndefined();
    });

    test('fuzzy search finds the person like the homepage does', async () => {
        const res = await search({ mode: 'fuzzy', person: { fullName: NAME } });
        expect(res.status()).toBe(200);
        const b = await res.json();
        expect(b.results.map((r: { profile: { profileId: string } }) => r.profile.profileId)).toContain(profileId);
    });

    test('the activity link opens the profile on it; the rescue sees its form answers', async ({ page }) => {
        await page.goto(`/adopter/${profileId}?record=${recordId}`);
        const card = page.locator(`[id="adoption-${recordId}"]`);
        await expect(card).toBeVisible({ timeout: 30000 });
        const answers = card.getByTestId('activity-form-answers');
        await answers.getByRole('button').click();
        await expect(answers).toContainText('¿Tenés patio?');
        await expect(answers).toContainText('2 adultos, 1 niño');
        await expect(answers).toContainText(/edad/);
        await expect(answers).toContainText(/^.*(Sí|Yes|Sim)/);
    });

    test('another rescue sees the activity, not the applicant\'s form answers', async ({ browser }) => {
        const ctx = await browser.newContext({ storageState: '.auth/user.json' });
        const page = await ctx.newPage();
        await page.goto(`/adopter/${profileId}?record=${recordId}`);
        await expect(page.locator(`[id="adoption-${recordId}"]`)).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('activity-form-answers')).toHaveCount(0);
        await ctx.close();
    });

    test('ambiguous, several names fit → the activity goes on the best match, no new profile', async () => {
        const TWIN = `Gemelofixture ${TAG.charAt(0).toUpperCase()}${TAG.slice(1)}`;
        const tail = String(Number(PHONE_TAIL) + 7).padStart(8, '0').slice(-8);
        const twinPhone = `11 ${tail.slice(0, 4)}-${tail.slice(4)}`;
        const doc = `3${tail.slice(0, 7)}`;
        // Two profiles with the same name: T1 has an email, a phone and a document; T2 another email.
        const t1 = await (await search({ mode: 'exact', person: { fullName: TWIN, email: `t1-${STAMP}@example.com`, phone: twinPhone }, activity: { activityType: 'observation' } }, { 'idempotency-key': `t1-${STAMP}` })).json();
        const t1doc = await (await search({ mode: 'exact', person: { fullName: TWIN, phone: twinPhone, documentId: { value: doc } }, activity: { activityType: 'observation' } }, { 'idempotency-key': `t1d-${STAMP}` })).json();
        expect(t1doc.activity.profileId).toBe(t1.activity.profileId);
        expect(t1doc.activity.contactsAdded).toEqual(['documentId']);
        const t2 = await (await search({ mode: 'exact', person: { fullName: TWIN, email: `t2-${STAMP}@example.com` }, activity: { activityType: 'observation' } }, { 'idempotency-key': `t2-${STAMP}` })).json();
        expect(t2.activity.profileCreated).toBe(true);
        // Someone else's email sent along with T1's phone: found T1, but that email is NOT copied onto T1.
        const z = await (await search({ mode: 'exact', person: { fullName: 'Zetafixture Ajeno', email: `z-${STAMP}@example.com` }, activity: { activityType: 'observation' } }, { 'idempotency-key': `z-${STAMP}` })).json();
        const mixed = await (await search({ mode: 'exact', person: { fullName: TWIN, phone: twinPhone, email: `z-${STAMP}@example.com` }, activity: { activityType: 'observation' } }, { 'idempotency-key': `mixed-${STAMP}` })).json();
        expect(mixed.result).toBe('found');
        expect(mixed.activity.profileId).toBe(t1.activity.profileId);
        expect(mixed.activity.contactsAdded).toEqual([]);
        for (const a of [mixed, z]) await api.post(`/api/v1/activities/${a.activity.activityId}/void`, { headers: auth() });
        // T1 matches on phone + document, T2 on email only → T1.
        const res = await (await search({ mode: 'exact', person: { fullName: TWIN, email: `t2-${STAMP}@example.com`, phone: twinPhone, documentId: { value: doc } }, activity: { activityType: 'adoption_request' } }, { 'idempotency-key': `twin-${STAMP}` })).json();
        expect(res.result).toBe('ambiguous');
        expect(res.reason).toBe('multiple_profiles');
        expect(res.activity.profileId).toBe(t1.activity.profileId);
        expect(res.activity.profileCreated).toBe(false);
        expect(res.activity.contactsAdded).toEqual([]); // never on an ambiguous answer
        expect(res.risk.profilesMatched).toBe(2);
        for (const a of [res, t2, t1doc, t1]) await api.post(`/api/v1/activities/${a.activity.activityId}/void`, { headers: auth() });
    });

    test('both review surfaces list the calls', async ({ page }) => {
        const admin = await page.request.get(`/api/admin/api-requests?keyId=${keyId}`);
        const rows = (await admin.json()).rows as Array<{ recordId: string | null; outcome: string; dryRun: boolean }>;
        expect(rows.some(r => r.recordId === recordId)).toBe(true);
        expect(rows.some(r => r.outcome === 'ambiguous')).toBe(true);
        expect(rows.some(r => r.dryRun && r.recordId === null)).toBe(true);

        await page.goto('/admin/api');
        await expect(page.getByTestId('api-keys')).toContainText(`E2E ${TAG}`, { timeout: 30000 });
        await expect(page.getByTestId('api-transaction').first()).toBeVisible();
        // Each key shows what it saved and voided in the last 30 days (search-then-void is visible).
        const keys = (await (await page.request.get('/api/admin/api-keys')).json()).keys as Array<{ id: string; last30: { activities: number; voided: number } }>;
        const mine = keys.find(k => k.id === keyId)!;
        expect(mine.last30.activities).toBeGreaterThan(3);
        expect(mine.last30.voided).toBeGreaterThanOrEqual(2); // the two follow-ups voided earlier
        await expect(page.getByTestId('api-keys').locator('li').filter({ hasText: `E2E ${TAG}` }).getByTestId('api-key-stats'))
            .toContainText(`${mine.last30.activities}`);
        // Test calls are marked as such: nothing was saved, so nothing to void.
        const dryRow = page.getByTestId('api-transaction').filter({ has: page.getByTestId('api-dry-run-badge') }).first();
        await expect(dryRow).toBeVisible();
        await expect(dryRow.getByRole('button', { name: /^(Anular|Void)$/ })).toHaveCount(0);

        await page.goto('/settings');
        await expect(page.getByTestId('settings-api')).toContainText(`E2E ${TAG}`, { timeout: 30000 });
    });

    test('ambiguous, no name fits → a NEW profile, registered as a possible duplicate', async () => {
        const res = await search(
            { mode: 'exact', person: { fullName: 'Otra Persona Distinta', phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } },
            { 'idempotency-key': `amb-${STAMP}` },
        );
        const b = await res.json();
        expect(b.result).toBe('ambiguous');
        expect(b.activity.profileCreated).toBe(true);
        expect(b.activity.profileId).not.toBe(profileId);
        // No name fits: a new profile, but the danger signal stays in risk.
        expect(b.risk.worstRating.ratingLabel).toBe('dangerous');
        const pair = JSON.parse(execD1(`SELECT count(*) AS n FROM duplicate_candidates WHERE (adopter1_id = '${b.activity.profileId}' AND adopter2_id = '${profileId}') OR (adopter1_id = '${profileId}' AND adopter2_id = '${b.activity.profileId}')`));
        expect(pair[0].results[0].n).toBe(1);
        // Now the phone belongs to two people: the original is still found by
        // name, and the answer says another profile shares the identifier.
        const found = await (await check({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } })).json();
        expect(found.result).toBe('found');
        expect(found.profile.profileId).toBe(profileId);
        expect(found.otherMatches.count).toBe(1);
        expect(found.otherMatches.urls[0]).toContain(b.activity.profileId);
        // Clean up through the API itself.
        const v = await api.post(`/api/v1/activities/${b.activity.activityId}/void`, { headers: auth() });
        expect((await v.json()).profileVoided).toBe(true);
    });

    test('void: only once; the API-created profile goes only when nothing is left on it', async () => {
        const first = await api.post(`/api/v1/activities/${secondRecordId}/void`, { headers: auth() });
        expect(first.status()).toBe(200);
        expect((await first.json()).profileVoided).toBe(false); // added to an existing profile

        const res = await api.post(`/api/v1/activities/${recordId}/void`, { headers: auth() });
        expect(res.status()).toBe(200);
        expect((await res.json()).profileVoided).toBe(true);
        const again = await api.post(`/api/v1/activities/${recordId}/void`, { headers: auth() });
        expect(again.status()).toBe(200);
        expect((await again.json()).alreadyVoided).toBe(true);
        // Not this key's record → 404 too.
        expect((await api.post('/api/v1/activities/test-adoption-5/void', { headers: auth() })).status()).toBe(404);

        const after = await check({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } });
        expect((await after.json()).result).toBe('not_found');
    });

    test('adoption: species required, animal details stored; the signed contract attaches once and opens for the rescue', async ({ page }) => {
        const ADOPTER = `Adopcionfixture ${TAG.charAt(0).toUpperCase()}${TAG.slice(1)}`;
        const person = { fullName: ADOPTER, email: `adopcion-${STAMP}@example.com` };
        const noSpecies = await search({ mode: 'exact', person, activity: { activityType: 'adoption', animalName: 'Luna' } }, { 'idempotency-key': `nosp-${STAMP}` });
        expect((await noSpecies.json()).error.code).toBe('species_required');
        const ageOnRequest = await search({ mode: 'exact', person, activity: { activityType: 'adoption_request', age: '2 años' } }, { 'idempotency-key': `agereq-${STAMP}` });
        expect((await ageOnRequest.json()).error.code).toBe('animal_details_require_placement');
        const futureBirth = await search({ mode: 'exact', person, activity: { activityType: 'adoption', species: 'cat', birthDate: '2026-11-01', date: '2026-10-12' } }, { 'idempotency-key': `badage-${STAMP}` });
        expect((await futureBirth.json()).error.code).toBe('invalid_age');
        const junkSpecies = await search({ mode: 'exact', person, activity: { activityType: 'adoption', species: '...' } }, { 'idempotency-key': `junksp-${STAMP}` });
        expect((await junkSpecies.json()).error.code).toBe('species_required');

        const res = await search({
            mode: 'exact', person,
            activity: {
                activityType: 'adoption', externalId: `adopcion-${STAMP}`, animalName: 'Luna', species: 'cat', age: '2 años', sex: 'female',
                neutered: true, color: 'atigrada', microchip: '985112345678901', date: '2026-10-12', rating: 5, notes: 'Entrega en domicilio.',
            },
        }, { 'idempotency-key': `adopt-${STAMP}` });
        expect(res.status()).toBe(200);
        const a = (await res.json()).activity;
        const animal = JSON.parse(execD1(`SELECT species, sex, neutered, color, microchip, age, estimated_birth_date AS b, added_by FROM animals WHERE id = '${a.activityId}'`))[0].results[0];
        expect(animal).toMatchObject({ species: 'cat', sex: 'hembra', neutered: 1, color: 'atigrada', microchip: '985112345678901', age: '2 años', added_by: ADMIN_EMAIL });
        expect(new Date(Number(animal.b) * 1000).getUTCFullYear()).toBe(2024);

        // The contract: wrong type refused; a PDF stored once; a second one refused.
        const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
        const wrongType = await api.post(`/api/v1/activities/${a.activityId}/contract`, { headers: auth({ 'content-type': 'text/plain' }), data: Buffer.from('hola') });
        expect(wrongType.status()).toBe(415);
        const attached = await api.post(`/api/v1/activities/${a.activityId}/contract`, { headers: auth({ 'content-type': 'application/pdf' }), data: pdf });
        expect(attached.status()).toBe(201);
        const c = await attached.json();
        expect(c.contract).toMatchObject({ contentType: 'application/pdf', size: pdf.byteLength });
        expect(c.contract.sha256).toMatch(/^[0-9a-f]{64}$/);
        const again = await api.post(`/api/v1/activities/${a.activityId}/contract`, { headers: auth({ 'content-type': 'application/pdf' }), data: pdf });
        expect(again.status()).toBe(409);
        expect((await again.json()).error.message).toContain(c.contract.sha256);
        // A dry run never stores or links a file.
        expect((await (await api.post(`/api/v1/activities/${a.activityId}/contract`, { headers: auth({ 'content-type': 'application/pdf', 'x-dry-run': '1' }), data: pdf })).json()).error.code).toBe('dry_run_not_allowed');
        // Only on adoptions / fosters this key saved.
        const req = (await (await search({ mode: 'exact', person, activity: { activityType: 'adoption_request' } }, { 'idempotency-key': `adreq-${STAMP}` })).json()).activity;
        expect((await (await api.post(`/api/v1/activities/${req.activityId}/contract`, { headers: auth({ 'content-type': 'application/pdf' }), data: pdf })).json()).error.code).toBe('contract_not_allowed');
        expect((await api.post('/api/v1/activities/test-adoption-5/contract', { headers: auth({ 'content-type': 'application/pdf' }), data: pdf })).status()).toBe(404);

        // The rescue opens it from the profile; the file is the one sent.
        const file = await page.request.get(`/api/files/contract/${a.activityId}`);
        expect(file.status()).toBe(200);
        expect(file.headers()['content-type']).toBe('application/pdf');
        expect((await file.body()).equals(pdf)).toBe(true);
        await page.goto(`/adopter/${a.profileId}`);
        await expect(page.locator(`[id="adoption-${a.activityId}"] a[href="/api/files/contract/${a.activityId}"]`)).toBeVisible({ timeout: 30000 });

        // Void: the adoption and its contract are gone; the file no longer opens.
        for (const id of [req.activityId, a.activityId]) await api.post(`/api/v1/activities/${id}/void`, { headers: auth() });
        expect((await page.request.get(`/api/files/contract/${a.activityId}`)).status()).toBe(404);
        expect(JSON.parse(execD1(`SELECT count(*) AS n FROM placements WHERE id = '${a.activityId}-plc' AND contract_key IS NOT NULL`))[0].results[0].n).toBe(0);
    });

    test('daily cap → 429 with Retry-After', async ({ page }) => {
        const me = await (await api.get('/api/v1/me', { headers: auth() })).json();
        await page.request.patch(`/api/admin/api-keys/${keyId}`, { data: { dailyCapFuzzy: me.usedToday.fuzzy + 1 } });
        expect((await search({ mode: 'fuzzy', person: { fullName: NAME } })).status()).toBe(200);
        const capped = await search({ mode: 'fuzzy', person: { fullName: NAME } });
        expect(capped.status()).toBe(429);
        expect(Number(capped.headers()['retry-after'])).toBeGreaterThan(0);
    });

    test('admin: the rescuer email suggests matching users; picking one fills the field', async ({ page }) => {
        await page.goto('/admin/api');
        const email = page.getByTestId('api-owner-email');
        await email.fill('gatitos');
        const options = page.getByTestId('api-owner-options');
        await expect(options).toContainText(ADMIN_EMAIL, { timeout: 30000 });
        await options.getByRole('button').filter({ hasText: ADMIN_EMAIL }).first().click();
        await expect(email).toHaveValue(ADMIN_EMAIL);
        // The key name says what it is for.
        await expect(page.locator('#api-key-name-hint')).toBeVisible();
    });

    test('admin: «Regenerar» shows a new secret once; the old one stops working, the key keeps its history', async ({ page }) => {
        const oldSecret = secret;
        expect((await api.get('/api/v1/me', { headers: auth() })).status()).toBe(200);
        await page.goto('/admin/api');
        const row = page.getByTestId('api-keys').locator('li').filter({ hasText: `E2E ${TAG}` });
        await row.getByRole('button', { name: /^(Regenerar|Regenerate)$/ }).click();
        await row.getByRole('button', { name: /Sí, regenerar|Yes, regenerate|Sim, regenerar/ }).click();
        const box = page.getByTestId('api-new-secret');
        await expect(box).toContainText(/Clave nueva|New key|Chave nova/, { timeout: 30000 });
        const fresh = (await box.locator('code').textContent())?.trim() ?? '';
        expect(fresh).toMatch(/^ba_test_[A-Za-z0-9]{43}$/);
        expect(fresh).not.toBe(oldSecret);

        expect((await api.get('/api/v1/me', { headers: { authorization: `Bearer ${oldSecret}` } })).status()).toBe(401);
        secret = fresh;
        const me = await api.get('/api/v1/me', { headers: auth() });
        expect(me.status()).toBe(200);
        // Same key row: its transactions are still listed under it.
        const tx = await page.request.get(`/api/admin/api-requests?keyId=${keyId}`);
        expect(((await tx.json()).rows as unknown[]).length).toBeGreaterThan(5);
    });

    test('docs and spec are served; a revoked key stops working', async ({ page }) => {
        const spec = await api.get('/api/v1/openapi.json');
        expect((await spec.json()).paths['/api/v1/search']).toBeTruthy();
        const docs = await api.get('/api/v1/docs');
        expect(docs.headers()['content-type']).toContain('text/html');
        expect(docs.headers()['content-security-policy']).toContain("connect-src 'self'");
        // The pinned, integrity-checked explorer actually renders under that CSP.
        await page.goto('/api/v1/docs');
        await expect(page.getByText('BuenAdoptante API').first()).toBeVisible({ timeout: 30000 });

        await page.request.patch(`/api/admin/api-keys/${keyId}`, { data: { revoke: true } });
        expect((await api.get('/api/v1/me', { headers: auth() })).status()).toBe(401);
    });

    test('flag off → every endpoint answers 404 api_disabled', async () => {
        flagOff();
        const res = await api.get('/api/v1/me', { headers: auth() });
        expect(res.status()).toBe(404);
        expect((await res.json()).error.code).toBe('api_disabled');
        flagOn();
    });
});
