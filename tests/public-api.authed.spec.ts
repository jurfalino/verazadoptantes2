import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Third-party API v1 (.agents/plans/2026-10-09-third-party-api.md), end to end:
 * the admin issues a key, a "partner" (no cookies, Bearer key) searches,
 * saves, retries and voids, and both review surfaces show the calls.
 * Every exact search saves a record; the look-ups that must not write use the
 * read-only mode (X-Dry-Run), which works with test keys off production only —
 * keys made here, on localhost, are test keys.
 *
 * ENABLE_PUBLIC_API is off in the seed; this file turns it on for itself and
 * and public-api-docs.authed.spec.ts are the only specs that touch it (each serial, each in its own CI leg). Every person it creates is unique
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

// @leg-apicore: CI runs this file in a leg of its own (ci.yml) — a long serial flow
// (example people, docs replay, /developers) that no longer fits a shared dev server.
test.describe('public API v1', { tag: '@leg-apicore' }, () => {
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
    // externalId is the retry key (was the Idempotency-Key header): a test's per-call
    // key becomes its activity's externalId, unless the activity already has one.
    const search = (data: unknown, headers: Record<string, string> = {}) => {
        const { 'idempotency-key': ext, ...rest } = headers;
        const d = data as { activity?: Record<string, unknown> };
        const body = ext && d.activity && !d.activity.externalId ? { ...d, activity: { ...d.activity, externalId: ext } } : data;
        return api.post('/api/v1/search', { data: body, headers: auth(rest) });
    };
    // A read-only exact look-up: same answer as a real call, nothing written.
    let dryN = 0;
    const check = (data: unknown) => search(data, { 'x-dry-run': '1', 'idempotency-key': `dry-${++dryN}-${STAMP}` });
    const countRows = (sql: string) => JSON.parse(execD1(sql))[0].results[0].n as number;

    test('admin issues a key; the secret is shown once and works for /me', async ({ page }) => {
        const res = await page.request.post('/api/admin/api-keys', { data: { ownerEmail: ADMIN_EMAIL, name: `E2E ${TAG}` } });
        expect(res.status()).toBe(201);
        const issued = await res.json();
        expect(issued.secret).toMatch(/^ba_test_[A-Za-z0-9]{43}$/);
        secret = issued.secret;
        keyId = issued.id;

        const none = await api.get('/api/v1/me');
        expect(none.status()).toBe(401);
        expect((await none.json()).error.message).toMatch(/no API key/);
        const unknown = await api.get('/api/v1/me', { headers: { authorization: 'Bearer ba_test_notarealkeynotarealkeynotarealkey12345' } });
        expect(unknown.status()).toBe(401);
        expect((await unknown.json()).error.message).toBe('unknown or revoked API key');
        // A production key here (off production) is named as such.
        expect((await (await api.get('/api/v1/me', { headers: { authorization: 'Bearer ba_live_notarealkeynotarealkeynotarealkey12345' } })).json()).error.message).toMatch(/production key/);
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

        // Every saving call needs its externalId (the retry key).
        const noExt = await search({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } });
        const ne = await noExt.json();
        expect(ne.error).toMatchObject({ code: 'external_id_required', field: 'activity.externalId' });
        expect(ne.error.docUrl).toMatch(/\/api\/v1\/docs#description\/errores$/);
        // Every problem at once, each with its field.
        const many = await (await search({ mode: 'exact', person: { fullName: 'Ana', email: 'nope', phone: 'x' }, activity: { activityType: 'adoption' } })).json();
        expect(many.error.details.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['invalid_email', 'invalid_phone', 'full_name_required', 'external_id_required', 'species_required']));
        expect(countRows(`SELECT count(*) AS n FROM adopters WHERE name = '${NAME}'`)).toBe(0);
    });

    test('one bad field no longer refuses the call: it is left out when another identifier works, and the answer says so', async () => {
        const res = await check({ mode: 'exact', person: {
            fullName: `Warn ${TAG} Perez`, email: `warn-${STAMP}@example.com (hija)`, phone: 'Xiaomi',
            socials: [{ platform: 'facebook', handle: 'no tengo' }, { platform: 'facebook', handle: 'Ana Perez' }],
        }, activity: { activityType: 'adoption_request' } });
        expect(res.status()).toBe(200);
        const j = await res.json();
        expect(j.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'person.phone', code: 'value_dropped', reason: 'not_a_phone' }),
            expect.objectContaining({ field: 'person.socials[0]', code: 'value_dropped', reason: 'no_account' }),
            expect.objectContaining({ field: 'person.email', code: 'value_cleaned', reason: 'first_valid_email' }),
        ]));
        // A name that is an email is refused, not saved as a person called "x@y.com".
        const asName = await search({ mode: 'exact', person: { fullName: `warn-${STAMP}@example.com`, email: `warn-${STAMP}@example.com` }, activity: { activityType: 'adoption_request' } }, { 'idempotency-key': `asname-${STAMP}` });
        expect((await asName.json()).error.code).toBe('full_name_required');
    });

    test('import mode: the save notifies nobody and skips the daily counting', async ({ page }) => {
        expect((await page.request.patch(`/api/admin/api-keys/${keyId}`, { data: { importMode: true } })).status()).toBe(200);
        try {
            const res = await search({ mode: 'exact', person: { fullName: `Importmode ${TAG} Perez`, email: `import-${STAMP}@example.com` }, activity: { activityType: 'adoption_request', externalId: `import-${STAMP}` } });
            expect(res.status()).toBe(200);
            const j = await res.json();
            expect(j.saved.action).toBe('created_profile');
            expect(res.headers()['ratelimit-remaining']).toBeUndefined();
            await new Promise(r => setTimeout(r, 2000)); // notifications run after the response
            expect(countRows(`SELECT count(*) AS n FROM notifications WHERE url LIKE '%${j.saved.profileId}%'`)).toBe(0);
            await api.post(`/api/v1/activities/${j.saved.activityId}/void`, { headers: auth() });
        } finally {
            await page.request.patch(`/api/admin/api-keys/${keyId}`, { data: { importMode: false } });
        }
    });

    test('dry run with a test key: the same answer, nothing written, logged as a test', async () => {
        const dry = await check({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } });
        expect(dry.status()).toBe(200);
        expect(dry.headers()['x-dry-run']).toBe('1');
        const d = await dry.json();
        expect(d.match).toBe('not_found');
        expect(d.saved).toEqual({ action: 'created_profile', dryRun: true }); // what it WOULD do
        expect(d.risk).toEqual({ worstRating: { rating: null, ratingLevel: 0, ratingLabel: 'not_rated' }, flags: [], alerts: [], profilesMatched: 0 });
        expect(countRows(`SELECT count(*) AS n FROM adopters WHERE name = '${NAME}'`)).toBe(0);
        expect(countRows(`SELECT count(*) AS n FROM api_requests WHERE id = '${d.requestId}' AND dry_run = 1 AND record_id IS NULL AND outcome = 'not_found'`)).toBe(1);
        // A void can't be a dry run.
        const v = await api.post('/api/v1/activities/whatever/void', { headers: auth({ 'x-dry-run': '1' }) });
        expect((await v.json()).error.code).toBe('dry_run_not_allowed');
    });

    test('a rescue\'s test key can dry-run too; a live key is refused, never silently saved', async ({ page }) => {
        const res = await page.request.post('/api/admin/api-keys', { data: { ownerEmail: 'testuser@example.com', name: `E2E user ${TAG}` } });
        expect(res.status()).toBe(201);
        const userKey = await res.json();
        expect(userKey.secret).toMatch(/^ba_test_/);
        const stranger = `Dryrunfixture ${TAG.charAt(0).toUpperCase()}${TAG.slice(1)}`;
        const call = (n: number) => api.post('/api/v1/search', {
            data: { mode: 'exact', person: { fullName: stranger, email: `dry-${STAMP}@example.com` }, activity: { activityType: 'adoption_request', externalId: `user-dry-${n}-${STAMP}` } },
            headers: { authorization: `Bearer ${userKey.secret}`, 'x-dry-run': '1' },
        });
        const ok = await call(1);
        expect(ok.status()).toBe(200);
        expect(ok.headers()['x-dry-run']).toBe('1');
        expect((await ok.json()).saved).toEqual({ action: 'created_profile', dryRun: true });
        // The same key as a production (live) key: refused.
        execD1(`UPDATE api_keys SET environment = 'live' WHERE id = '${userKey.id}'`);
        const refused = await call(2);
        expect(refused.status()).toBe(403);
        expect((await refused.json()).error.code).toBe('dry_run_not_allowed');
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
        expect(s.match).toBe('not_found');
        expect(s.saved.action).toBe('created_profile');
        expect(s.saved.contactsAdded).toEqual([]);
        expect(s.saved.activityUrl).toContain(`/adopter/${s.saved.profileId}?record=${s.saved.activityId}`);
        recordId = s.saved.activityId;
        profileId = s.saved.profileId;
        // The form answers are stored as sent; species was read from a code.
        expect(countRows(`SELECT count(*) AS n FROM activity_forms WHERE activity_id = '${recordId}'`)).toBe(1);
        expect(countRows(`SELECT count(*) AS n FROM adoptions WHERE id = '${recordId}' AND species = 'dog'`)).toBe(1);

        // A retry (same externalId, same content — even with its keys in another order) replays the answer and writes nothing.
        const reordered = { activity: { ...body.activity }, person: { email: EMAIL, phone: LOCAL_PHONE, fullName: NAME }, mode: 'exact' };
        const replay = await search(reordered);
        const r = await replay.json();
        expect(r.replayed).toBe(true);
        expect(r.saved.activityId).toBe(recordId);
        expect(r.originalRequestId).toBe(s.requestId);
        expect(r.requestId).not.toBe(s.requestId);
        expect(countRows(`SELECT count(*) AS n FROM adoptions WHERE adopter_id = '${profileId}'`)).toBe(1);
        // Same externalId, different content → refused, naming what was saved.
        const clash = await search({ ...body, activity: { ...body.activity, activityType: 'observation', formContent: undefined } });
        expect(clash.status()).toBe(409);
        expect((await clash.json()).error).toMatchObject({ code: 'external_id_reused', originalRequestId: s.requestId, activityId: recordId, profileId });

        // What did that call do? By its requestId, and by the externalId.
        const byId = await (await api.get(`/api/v1/requests/${s.requestId}`, { headers: auth() })).json();
        expect(byId.call).toMatchObject({ requestId: s.requestId, externalId: `ext-${STAMP}`, activityId: recordId, voided: false, httpStatus: 200 });
        expect(byId.call.response.saved.activityId).toBe(recordId);
        const byExt = await (await api.get(`/api/v1/requests?externalId=ext-${STAMP}`, { headers: auth() })).json();
        expect(byExt.call.requestId).toBe(s.requestId);
        expect((await api.get('/api/v1/requests/not-a-request', { headers: auth() })).status()).toBe(404);
    });

    test('an exact call without activity is refused and points to fuzzy; fuzzy finds the person, saves nothing, shows the quota', async () => {
        const r = await api.post('/api/v1/search', { data: { mode: 'exact', person: { fullName: NAME, email: EMAIL } }, headers: auth() });
        expect(r.status()).toBe(422);
        const e = await r.json();
        expect(e.error).toMatchObject({ code: 'activity_required', field: 'activity' });
        expect(e.error.message).toMatch(/fuzzy/);
        // A refusal records nothing about who matched.
        expect(countRows(`SELECT count(*) AS n FROM api_requests WHERE id = '${e.requestId}' AND profile_ids IS NULL AND outcome = 'error'`)).toBe(1);

        const f = await search({ mode: 'fuzzy', person: { fullName: NAME, email: EMAIL } });
        expect(f.status()).toBe(200);
        expect((await f.json()).results.some((x: { profile: { profileId: string } }) => x.profile.profileId === profileId)).toBe(true);
        expect(countRows(`SELECT count(*) AS n FROM adoptions WHERE adopter_id = '${profileId}'`)).toBe(1);
        expect(Number(f.headers()['ratelimit-limit'])).toBeGreaterThan(0);
        expect(Number(f.headers()['ratelimit-remaining'])).toBeLessThan(Number(f.headers()['ratelimit-limit']));
        expect(Number(f.headers()['ratelimit-reset'])).toBeGreaterThan(0);
    });

    test('the same person in another phone format → found, with one request and no rating', async () => {
        const res = await check({ mode: 'exact', person: { fullName: `${NAME.split(' ')[1]}, ${NAME.split(' ')[0]}`, phone: INTL_PHONE }, activity: { activityType: 'adoption_request' } });
        const b = await res.json();
        expect(b.match).toBe('found');
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
        expect(b.match).toBe('found');
        expect(b.saved.action).toBe('added_to_profile');
        expect(b.saved.profileId).toBe(profileId);
        expect(b.profile.records).toEqual({ adoption_request: 1 }); // before this call
        expect(b.profile.ratingLabel).toBe('not_rated');
        secondRecordId = b.saved.activityId;

        const after = await (await check({ mode: 'exact', person: { fullName: NAME, email: EMAIL }, activity: { activityType: 'observation' } })).json();
        expect(after.profile.records).toEqual({ adoption_request: 1, observation: 1 });
        expect(after.profile.ratingLabel).toBe('dangerous');
    });

    test('an activity with only its type still saves; a new phone for a known person is added, with a trail, and void takes it back', async () => {
        const res = await search({ mode: 'exact', person: { fullName: NAME, email: EMAIL }, activity: { activityType: 'follow_up' } }, { 'idempotency-key': `plain-${STAMP}` });
        const b = await res.json();
        expect(b.match).toBe('found');
        expect(b.saved.profileId).toBe(profileId);
        expect(b.saved.action).toBe('added_to_profile');
        const after = await (await check({ mode: 'exact', person: { fullName: NAME, email: EMAIL }, activity: { activityType: 'follow_up' } })).json();
        expect(after.profile.records.follow_up).toBe(1);
        // Found by email, with a phone the profile didn't have: it is added and logged.
        const withPhone = await (await search({ mode: 'exact', person: { fullName: NAME, email: EMAIL, phone: NEW_PHONE }, activity: { activityType: 'follow_up' } }, { 'idempotency-key': `newphone-${STAMP}` })).json();
        expect(withPhone.saved.contactsAdded).toEqual(['phone']);
        expect(countRows(`SELECT count(*) AS n FROM adopter_history WHERE adopter_id = '${profileId}' AND changes LIKE '%contacts_added_via_api%'`)).toBe(1);
        const byNewPhone = await (await check({ mode: 'exact', person: { fullName: NAME, phone: NEW_PHONE }, activity: { activityType: 'observation' } })).json();
        expect(byNewPhone.match).toBe('found');
        expect(byNewPhone.profile.profileId).toBe(profileId);
        // Put the person back as the next tests expect: void both; the added phone comes back off.
        for (const id of [b.saved.activityId, withPhone.saved.activityId]) {
            const v = await api.post(`/api/v1/activities/${id}/void`, { headers: auth() });
            expect((await v.json()).profileVoided).toBe(false);
        }
        expect((await (await check({ mode: 'exact', person: { fullName: NAME, phone: NEW_PHONE }, activity: { activityType: 'observation' } })).json()).match).toBe('not_found');
    });

    test('same phone, unrelated name → ambiguous name_mismatch, never a guess', async () => {
        const res = await check({ mode: 'exact', person: { fullName: 'Otra Persona Distinta', phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } });
        const b = await res.json();
        expect(b.match).toBe('ambiguous');
        expect(b.reason).toBe('name_mismatch');
        expect(b.candidates).toEqual([expect.objectContaining({ profileId, nameMatchedAs: null })]);
        // The previous test rated this person 1★: an ambiguous answer still lets the client block (risk is the one place to look).
        expect(b.worstRating).toBeUndefined();
        expect(b.risk.worstRating.ratingLabel).toBe('dangerous');
        expect(b.saved).toEqual({ action: 'created_profile_for_review', dryRun: true });
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
        // With origin labels on, the activity says which tool sent it.
        execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_ORIGIN_LABELS', 'true', strftime('%s','now'), 'e2e')`);
        await page.goto(`/adopter/${profileId}?record=${recordId}`);
        const card = page.locator(`[id="adoption-${recordId}"]`);
        await expect(card).toBeVisible({ timeout: 30000 });
        await expect(card.getByTestId('origin-tag')).toHaveText(`API · E2E ${TAG}`);
        execD1(`DELETE FROM app_config WHERE key = 'ENABLE_ORIGIN_LABELS'`);
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
        expect(t1doc.saved.profileId).toBe(t1.saved.profileId);
        expect(t1doc.saved.contactsAdded).toEqual(['documentId']);
        const t2 = await (await search({ mode: 'exact', person: { fullName: TWIN, email: `t2-${STAMP}@example.com` }, activity: { activityType: 'observation' } }, { 'idempotency-key': `t2-${STAMP}` })).json();
        expect(t2.saved.action).toMatch(/^created_profile/);
        // Someone else's email sent along with T1's phone: found T1, but that email is NOT copied onto T1.
        const z = await (await search({ mode: 'exact', person: { fullName: 'Zetafixture Ajeno', email: `z-${STAMP}@example.com` }, activity: { activityType: 'observation' } }, { 'idempotency-key': `z-${STAMP}` })).json();
        const mixed = await (await search({ mode: 'exact', person: { fullName: TWIN, phone: twinPhone, email: `z-${STAMP}@example.com` }, activity: { activityType: 'observation' } }, { 'idempotency-key': `mixed-${STAMP}` })).json();
        expect(mixed.match).toBe('found');
        expect(mixed.saved.profileId).toBe(t1.saved.profileId);
        expect(mixed.saved.contactsAdded).toEqual([]);
        for (const a of [mixed, z]) await api.post(`/api/v1/activities/${a.saved.activityId}/void`, { headers: auth() });
        // T1 matches on phone + document, T2 on email only → T1.
        const res = await (await search({ mode: 'exact', person: { fullName: TWIN, email: `t2-${STAMP}@example.com`, phone: twinPhone, documentId: { value: doc } }, activity: { activityType: 'adoption_request' } }, { 'idempotency-key': `twin-${STAMP}` })).json();
        expect(res.match).toBe('ambiguous');
        expect(res.reason).toBe('multiple_profiles');
        expect(res.saved.profileId).toBe(t1.saved.profileId);
        expect(res.saved.action).toBe('added_to_best_match');
        expect(res.saved.contactsAdded).toEqual([]); // never on an ambiguous answer
        expect(res.risk.profilesMatched).toBe(2);
        for (const a of [res, t2, t1doc, t1]) await api.post(`/api/v1/activities/${a.saved.activityId}/void`, { headers: auth() });
    });

    test('both review surfaces list the calls', async ({ page }) => {
        const admin = await page.request.get(`/api/admin/api-requests?keyId=${keyId}`);
        const rows = (await admin.json()).rows as Array<{ recordId: string | null; outcome: string; dryRun: boolean }>;
        expect(rows.some(r => r.recordId === recordId)).toBe(true);
        expect(rows.some(r => r.outcome === 'ambiguous')).toBe(true);
        expect(rows.some(r => r.dryRun && r.recordId === null)).toBe(true);

        await page.goto('/admin/api?tab=keys');
        await expect(page.getByTestId('api-keys')).toContainText(`E2E ${TAG}`, { timeout: 30000 });
        // Each key shows what it saved and voided in the last 30 days (search-then-void is visible).
        const keys = (await (await page.request.get('/api/admin/api-keys')).json()).keys as Array<{ id: string; last30: { activities: number; voided: number } }>;
        const mine = keys.find(k => k.id === keyId)!;
        expect(mine.last30.activities).toBeGreaterThan(3);
        expect(mine.last30.voided).toBeGreaterThanOrEqual(2); // the two follow-ups voided earlier
        await expect(page.getByTestId('api-keys').locator('li').filter({ hasText: `E2E ${TAG}` }).getByTestId('api-key-stats'))
            .toContainText(`${mine.last30.activities}`);
        // Calls tab: every transaction, test calls marked as such (nothing was saved, so nothing to void).
        await page.getByTestId('api-tab-calls').click();
        await expect(page.getByTestId('api-transaction').first()).toBeVisible({ timeout: 30000 });
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
        expect(b.match).toBe('ambiguous');
        expect(b.saved.action).toBe('created_profile_for_review');
        expect(b.saved.profileId).not.toBe(profileId);
        // No name fits: a new profile, but the danger signal stays in risk.
        expect(b.risk.worstRating.ratingLabel).toBe('dangerous');
        const pair = JSON.parse(execD1(`SELECT count(*) AS n FROM duplicate_candidates WHERE (adopter1_id = '${b.saved.profileId}' AND adopter2_id = '${profileId}') OR (adopter1_id = '${profileId}' AND adopter2_id = '${b.saved.profileId}')`));
        expect(pair[0].results[0].n).toBe(1);
        // Now the phone belongs to two people: the original is still found by
        // name, and the answer says another profile shares the identifier.
        const found = await (await check({ mode: 'exact', person: { fullName: NAME, phone: LOCAL_PHONE }, activity: { activityType: 'adoption_request' } })).json();
        expect(found.match).toBe('found');
        expect(found.profile.profileId).toBe(profileId);
        expect(found.otherMatches).toEqual([expect.objectContaining({ profileId: b.saved.profileId })]);
        // Clean up through the API itself.
        const v = await api.post(`/api/v1/activities/${b.saved.activityId}/void`, { headers: auth() });
        expect((await v.json()).profileVoided).toBe(true);
    });

    test('a call that saved and then crashed: the retry names it (partially_saved), voiding it frees the externalId', async () => {
        const ext = `crash-${STAMP}`;
        const body = { mode: 'exact', person: { fullName: NAME, email: EMAIL }, activity: { activityType: 'observation', externalId: ext } };
        const first = await (await search(body)).json();
        expect(first.saved.activityId).toBeTruthy();
        // As if the worker had died after saving: the row says 500.
        execD1(`UPDATE api_requests SET http_status = 500 WHERE id = '${first.requestId}'`);
        const retry = await search(body);
        expect(retry.status()).toBe(409);
        expect((await retry.json()).error).toMatchObject({ code: 'partially_saved', originalRequestId: first.requestId, activityId: first.saved.activityId });
        // The docs say: void it, then send again. Both must work.
        const v = await api.post(`/api/v1/activities/${first.saved.activityId}/void`, { headers: auth() });
        expect(v.status()).toBe(200);
        const again = await search(body);
        expect(again.status()).toBe(200);
        const a = await again.json();
        expect(a.replayed).toBeUndefined();
        expect(a.saved.activityId).not.toBe(first.saved.activityId);
        await api.post(`/api/v1/activities/${a.saved.activityId}/void`, { headers: auth() });
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
        expect((await after.json()).match).toBe('not_found');
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
        const a = (await res.json()).saved;
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
        const req = (await (await search({ mode: 'exact', person, activity: { activityType: 'adoption_request' } }, { 'idempotency-key': `adreq-${STAMP}` })).json()).saved;
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
        // The key allows one more today — unless the owner's limit across all their keys
        // (calls from an earlier attempt of this file count too) is already used up.
        let capped = await search({ mode: 'fuzzy', person: { fullName: NAME } });
        if (capped.status() === 200) capped = await search({ mode: 'fuzzy', person: { fullName: NAME } });
        expect(capped.status()).toBe(429);
        expect(Number(capped.headers()['retry-after'])).toBeGreaterThan(0);
    });

    test('flag off → every endpoint answers 404 api_disabled', async () => {
        flagOff();
        const res = await api.get('/api/v1/me', { headers: auth() });
        expect(res.status()).toBe(404);
        expect((await res.json()).error.code).toBe('api_disabled');
        flagOn();
    });
});
