import { describe, it, expect } from 'vitest';
import { buildOpenApi, examplesGuide, shownScenarios } from './openapi';
import { exactScenarios, isExampleData, REQUEST_EXAMPLES } from './docScenarios';
import { API_ERROR_CODES, checkSearchRules, exactResponseSchema, saveActionOf, searchRequestSchema } from './schemas';
import { canonicalJson, dryRunAllowed, unauthorizedMessage } from './handler';

/* eslint-disable @typescript-eslint/no-explicit-any */
const STAGING = 'https://staging.buenadoptante.org';
const PROD = 'https://buenadoptante.org';

describe('buildOpenApi', () => {
    const doc = buildOpenApi(STAGING) as any;
    const search = doc.paths['/api/v1/search'].post;

    it('documents the v1 endpoints', () => {
        expect(Object.keys(doc.paths)).toEqual(['/api/v1/search', '/api/v1/requests/{requestId}', '/api/v1/requests', '/api/v1/me', '/api/v1/activities/{id}/contract', '/api/v1/activities/{id}/void']);
    });

    it('the request schema is generated from the zod contract; no Idempotency-Key header any more', () => {
        const req = search.requestBody.content['application/json'].schema;
        expect(Object.keys(req.properties.person.properties).sort())
            .toEqual(['address', 'documentId', 'email', 'fullName', 'phone', 'socials']);
        const activity = req.properties.activity;
        expect(activity.properties.activityType.enum).toEqual(['adoption_request', 'adoption', 'foster', 'follow_up', 'returned_pet', 'observation']);
        expect(Object.keys(activity.properties)).toContain('externalId');
        expect(search.parameters.map((p: { name: string }) => p.name)).toEqual(['X-Dry-Run']);
        expect(JSON.stringify(doc)).not.toMatch(/Idempotency-Key/);
    });

    it('every error code is published and explained in the guide\'s «Errores» table', () => {
        const codes = search.responses['422'].content['application/json'].schema.properties.error.properties.code.enum;
        expect(codes).toEqual(API_ERROR_CODES);
        const guide: string = doc.info.description;
        expect(guide).toContain('## Errores');
        for (const c of API_ERROR_CODES) expect(guide, c).toContain(`| \`${c}\``);
        expect(search.responses['503']).toBeDefined();
    });

    it('every curl in the guide points at the page\'s own host, with that environment\'s key', () => {
        const stagingGuide: string = doc.info.description;
        expect(stagingGuide).toContain(`${STAGING}/api/v1/search`);
        expect(stagingGuide).not.toContain(`${PROD}/api/v1`);
        expect(stagingGuide).not.toContain('-H "Authorization: Bearer ba_live_');
        const prodGuide: string = (buildOpenApi(PROD) as any).info.description;
        expect(prodGuide).toContain(`${PROD}/api/v1/search`);
        expect(prodGuide).not.toContain('-H "Authorization: Bearer ba_test_');
        expect(prodGuide).not.toContain('En staging estas personas existen');
    });

    it('every request example is a valid request; exact ones carry their own externalId', () => {
        const examples = search.requestBody.content['application/json'].examples as Record<string, { value: any }>;
        expect(Object.keys(examples)).toEqual(expect.arrayContaining(['minimal', 'complete_request', 'complete_adoption', 'fuzzy']));
        for (const [name, ex] of Object.entries(examples)) {
            const parsed = searchRequestSchema.safeParse(ex.value);
            expect(parsed.success, name).toBe(true);
            expect(checkSearchRules(parsed.data!), name).toEqual([]);
        }
        expect(examples.minimal.value).toEqual({ mode: 'exact', person: { fullName: expect.any(String), phone: expect.any(String) }, activity: { activityType: 'adoption_request', externalId: expect.any(String) } });
        // Distinct externalIds: pasting two examples is never a "reused" conflict.
        const ids = Object.values(examples).map(e => e.value.activity?.externalId).filter(Boolean);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('the dry-run header is not pre-filled into generated requests (no enum/const/example)', () => {
        const header = search.parameters.find((p: { name: string }) => p.name === 'X-Dry-Run');
        expect(header.schema).toEqual({ type: 'string' });
        expect(header.description).toMatch(/STAGING ONLY/);
    });
});

describe('exact scenarios', () => {
    const scenarios = exactScenarios(PROD);

    it('each request is a valid exact request with its own externalId; each answer a valid exact answer', () => {
        const ids = new Set<string>();
        for (const sc of scenarios) {
            const parsed = searchRequestSchema.safeParse(sc.request);
            expect(parsed.success, sc.key).toBe(true);
            expect(checkSearchRules(parsed.data!), sc.key).toEqual([]);
            ids.add(parsed.data!.activity!.externalId!);
            expect(exactResponseSchema.safeParse(sc.response).success, sc.key).toBe(true);
        }
        expect(ids.size).toBe(scenarios.length);
    });

    it('cover every rating level, every match, every save action and every alert', () => {
        const rs = scenarios.map(sc => sc.response as any);
        expect(rs.filter(r => r.match === 'found').map(r => r.profile.ratingLevel)).toEqual(expect.arrayContaining([5, 4, 3, 2, 1, 0]));
        expect(rs.map(r => r.reason ?? r.match)).toEqual(expect.arrayContaining(['found', 'not_found', 'name_mismatch', 'multiple_profiles']));
        expect([...new Set(rs.map(r => r.saved.action))].sort()).toEqual(['added_to_best_match', 'added_to_profile', 'created_profile', 'created_profile_for_review']);
        expect([...new Set(rs.flatMap(r => r.risk.flags))]).toEqual(expect.arrayContaining(['inaccurate', 'possible_duplicate', 'duplicate']));
        expect([...new Set(rs.flatMap(r => r.risk.alerts.map((a: any) => a.type)))].sort()).toEqual(['too_many_adoptions', 'too_many_requests']);
    });

    it('say what each one claims (spot checks against the decision rules)', () => {
        const by = Object.fromEntries(scenarios.map(sc => [sc.key, sc.response as any]));
        expect(by.five_stars.saved).toMatchObject({ action: 'added_to_profile', contactsAdded: ['email'] });
        expect(by.five_stars.profile.rating).toBe(4.8);
        expect(by.five_stars.profile.registeredByYourRescue).toBe(false);
        expect(by.three_stars.profile.matchedOn).toEqual(['documentId']);
        expect(by.shared_phone.match).toBe('found');
        expect(by.shared_phone.otherMatches).toEqual([{ profileId: 'demo-api-ramon', url: `${PROD}/adopter/demo-api-ramon` }]);
        expect(by.shared_phone.risk.worstRating.ratingLevel).toBe(1);
        expect(by.shared_phone.risk.alerts).toEqual([{ type: 'too_many_adoptions', count: 5, periodDays: 90, profileId: 'demo-api-ramon' }]);
        expect(by.one_star.profile.alerts).toEqual([{ type: 'too_many_requests', count: 4, periodDays: 30 }]);
        expect(by.name_mismatch.saved.action).toBe('created_profile_for_review');
        expect(by.name_mismatch.candidates).toEqual([{ profileId: 'demo-api-martin', url: `${PROD}/adopter/demo-api-martin`, nameMatchedAs: null }]);
        expect(by.multiple_profiles.saved).toMatchObject({ action: 'added_to_best_match', profileId: 'demo-api-laura-a' });
        expect(by.not_found.saved.action).toBe('created_profile');
        expect(by.dry_run.saved).toEqual({ action: 'created_profile', dryRun: true });
    });

    it('on staging every call is shown as a dry run, with the dry-run answer', () => {
        for (const sc of shownScenarios(STAGING)) {
            expect(sc.dryRunCall).toBe(true);
            expect((sc.response as any).saved).toEqual({ action: expect.any(String), dryRun: true });
        }
        const guide = examplesGuide(STAGING);
        shownScenarios(STAGING).forEach((sc, i) => {
            const at = guide.indexOf(`### ${i + 1}. ${sc.title}`);
            expect(at, sc.key).toBeGreaterThan(-1);
            const next = guide.indexOf('### ', at + 4);
            const section = guide.slice(at, next === -1 ? undefined : next);
            for (const part of ['**Qué hay registrado:**', '**Llamada**', '**Respuesta**', '**Por qué:**', 'X-Dry-Run: 1', '"externalId"']) expect(section, `${sc.key} ${part}`).toContain(part);
            expect(section).toContain(JSON.stringify(sc.response, null, 2));
        });
    });

    it('in production the calls are real (no dry run) except the dry-run scenario itself', () => {
        for (const sc of shownScenarios(PROD)) expect(sc.dryRunCall, sc.key).toBe(sc.key === 'dry_run');
    });
});

describe('isExampleData (production refuses the docs\' example people)', () => {
    it('an example name with an example identifier is example data', () => {
        expect(isExampleData({ fullName: 'Carla Gómez', phone: '1155503104' })).toBe(true);
        expect(isExampleData({ fullName: 'maria jose perez', email: 'MariaJose.Demo@example.com' })).toBe(true);
        expect(isExampleData((REQUEST_EXAMPLES.minimal.value as any).person)).toBe(true);
    });
    it('a real person who shares only the name, or only the phone, is not', () => {
        expect(isExampleData({ fullName: 'Carla Gómez', phone: '11 4000-1234' })).toBe(false);
        expect(isExampleData({ fullName: 'Juana Ruiz', phone: '1155503104' })).toBe(false);
    });
});

describe('handler helpers', () => {
    it('saveActionOf', () => {
        expect(saveActionOf('found', false)).toBe('added_to_profile');
        expect(saveActionOf('not_found', true)).toBe('created_profile');
        expect(saveActionOf('ambiguous', false)).toBe('added_to_best_match');
        expect(saveActionOf('ambiguous', true)).toBe('created_profile_for_review');
    });
    it('canonicalJson: key order and spacing do not make a retry look different', () => {
        expect(canonicalJson('{"b":1,"a":{"y":2,"x":[1,{"d":1,"c":2}]}}')).toBe(canonicalJson('{ "a": { "x": [1, {"c":2,"d":1}], "y": 2 }, "b": 1 }'));
        expect(canonicalJson('{"a":1}')).not.toBe(canonicalJson('{"a":2}'));
        // A field sent as null instead of left out, and spaces around a value, are the same request.
        expect(canonicalJson('{"a":" x ","b":null}')).toBe(canonicalJson('{"a":"x"}'));
        expect(canonicalJson('{"a":[2,1]}')).not.toBe(canonicalJson('{"a":[1,2]}')); // order of a list still matters
    });
    it('unauthorizedMessage says why, without telling unknown from revoked', () => {
        expect(unauthorizedMessage(null, null, 'buenadoptante.org')).toMatch(/no API key/);
        expect(unauthorizedMessage('Token abc', null, 'buenadoptante.org')).toMatch(/malformed/);
        expect(unauthorizedMessage('Bearer ba_test_x', 'ba_test_x', 'buenadoptante.org')).toMatch(/test key/);
        expect(unauthorizedMessage('Bearer ba_live_x', 'ba_live_x', 'staging.buenadoptante.org')).toMatch(/production key/);
        expect(unauthorizedMessage('Bearer ba_live_x', 'ba_live_x', 'buenadoptante.org')).toBe('unknown or revoked API key');
    });
});

describe('checkSearchRules', () => {
    it('reports every problem at once, each with its field', () => {
        const parsed = searchRequestSchema.parse({ mode: 'exact', person: { fullName: 'Ana', email: 'nope', phone: 'x' }, activity: { activityType: 'adoption' } });
        const problems = checkSearchRules(parsed);
        expect(problems.map(p => p.code)).toEqual(expect.arrayContaining(['invalid_email', 'invalid_phone', 'full_name_required', 'external_id_required', 'species_required']));
        expect(problems.find(p => p.code === 'invalid_email')!.field).toBe('person.email');
    });
    it('an exact call without activity points to fuzzy', () => {
        const parsed = searchRequestSchema.parse({ mode: 'exact', person: { fullName: 'Ana Pérez', email: 'ana@x.com' } });
        expect(checkSearchRules(parsed)[0]).toMatchObject({ code: 'activity_required', message: expect.stringMatching(/fuzzy/) });
    });
});

describe('dryRunAllowed', () => {
    it('a test key on staging or local: yes', () => {
        expect(dryRunAllowed('test', 'staging.verazadoptantes2.pages.dev')).toBe(true);
        expect(dryRunAllowed('test', 'localhost:3000')).toBe(true);
    });
    it('production: never, whatever the key', () => {
        expect(dryRunAllowed('live', 'buenadoptante.org')).toBe(false);
        expect(dryRunAllowed('test', 'buenadoptante.org')).toBe(false);
        expect(dryRunAllowed('test', 'www.buenadoptante.org')).toBe(false);
    });
    it('a live key anywhere: no', () => {
        expect(dryRunAllowed('live', 'staging.verazadoptantes2.pages.dev')).toBe(false);
    });
});
