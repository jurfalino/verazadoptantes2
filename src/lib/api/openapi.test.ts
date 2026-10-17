import { describe, it, expect } from 'vitest';
import { buildOpenApi, REQUEST_EXAMPLES } from './openapi';
import { exactScenarios } from './docScenarios';
import { checkSearchRules, exactResponseSchema, searchRequestSchema } from './schemas';
import { dryRunAllowed } from './handler';

describe('buildOpenApi', () => {
    const doc = buildOpenApi('https://staging.buenadoptante.org') as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    it('documents the v1 endpoints', () => {
        expect(Object.keys(doc.paths)).toEqual(['/api/v1/search', '/api/v1/me', '/api/v1/activities/{id}/contract', '/api/v1/activities/{id}/void']);
    });

    it('the request schema is generated from the zod contract (every person field, every activity type)', () => {
        const req = doc.paths['/api/v1/search'].post.requestBody.content['application/json'].schema;
        expect(Object.keys(req.properties.person.properties).sort())
            .toEqual(['address', 'documentId', 'email', 'fullName', 'phone', 'socials']);
        const activity = req.properties.activity;
        expect(activity.properties.activityType.enum).toEqual(['adoption_request', 'adoption', 'foster', 'follow_up', 'returned_pet', 'observation']);
        expect(Object.keys(activity.properties).sort())
            .toEqual(['activityType', 'age', 'animalName', 'birthDate', 'color', 'date', 'externalId', 'formContent', 'microchip', 'neutered', 'notes', 'rating', 'sex', 'species']);
        expect(activity.required).toEqual(['activityType']);
        expect(req.required).toEqual(expect.arrayContaining(['mode', 'person']));
        expect(req.required).not.toContain('activity');
    });

    it('every response carries risk; every error code is published, the dry-run refusal included', () => {
        const exact = doc.paths['/api/v1/search'].post.responses['200'].content['application/json'].schema.oneOf[0];
        expect(exact.required).toContain('risk');
        const codes = doc.paths['/api/v1/search'].post.responses['422'].content['application/json'].schema.properties.error.properties.code.enum;
        expect(codes).toEqual(expect.arrayContaining(['activity_required', 'form_content_requires_adoption_request', 'idempotency_key_required', 'dry_run_not_allowed']));
    });

    it('the guide writes out every request example and every exact scenario: registered, request, answer, why', () => {
        const guide: string = doc.info.description;
        for (const e of Object.values(REQUEST_EXAMPLES)) expect(guide).toContain(`### ${e.summary}`);
        const scenarios = exactScenarios('https://staging.buenadoptante.org');
        scenarios.forEach((sc, i) => {
            const at = guide.indexOf(`### ${i + 1}. ${sc.title}`);
            expect(at, sc.key).toBeGreaterThan(-1);
            const section = guide.slice(at, guide.indexOf('### ', at + 4) === -1 ? undefined : guide.indexOf('### ', at + 4));
            for (const part of ['**Qué hay registrado:**', '**Llamada**', '**Respuesta**', '**Por qué:**', 'Idempotency-Key: ']) expect(section, `${sc.key} ${part}`).toContain(part);
            expect(section.includes('X-Dry-Run: 1'), sc.key).toBe(sc.dryRun);
            expect(section).toContain(JSON.stringify(sc.request, null, 2));
            expect(section).toContain(JSON.stringify(sc.response, null, 2));
        });
    });

    it('the guide on production shows live keys and no dry-run header outside its own scenario', () => {
        const prod: string = (buildOpenApi('https://buenadoptante.org') as any).info.description; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prod).toContain('ba_live_…');
        expect(prod).not.toContain('En staging estas personas existen');
    });

    it('the dry-run header is not pre-filled into generated requests (no enum/const/example)', () => {
        const header = doc.paths['/api/v1/search'].post.parameters.find((p: { name: string }) => p.name === 'X-Dry-Run');
        expect(header.schema).toEqual({ type: 'string' });
        expect(header.example).toBeUndefined();
    });

    it('documents the dry run as staging-only', () => {
        expect(doc.info.description).toMatch(/X-Dry-Run: 1/);
        expect(doc.info.description).toMatch(/En producción no funciona/);
        const header = doc.paths['/api/v1/search'].post.parameters.find((p: { name: string }) => p.name === 'X-Dry-Run');
        expect(header.description).toMatch(/STAGING ONLY/);
    });

    it('every request example is a valid request (schema and rules)', () => {
        const examples = doc.paths['/api/v1/search'].post.requestBody.content['application/json'].examples as Record<string, { value: unknown }>;
        expect(Object.keys(examples)).toEqual(expect.arrayContaining(['minimal', 'complete_request', 'complete_adoption']));
        for (const [name, ex] of Object.entries(examples)) {
            const parsed = searchRequestSchema.safeParse(ex.value);
            expect(parsed.success, name).toBe(true);
            expect(checkSearchRules(parsed.data!), name).toBeNull();
        }
        // The minimal one really is minimal: name, one contact, the activity type.
        expect(examples.minimal.value).toEqual({ mode: 'exact', person: { fullName: expect.any(String), phone: expect.any(String) }, activity: { activityType: 'adoption_request' } });
    });

    it('scenarios: each request is a valid exact request and each answer a valid exact answer', () => {
        for (const sc of exactScenarios('https://buenadoptante.org')) {
            const parsed = searchRequestSchema.safeParse(sc.request);
            expect(parsed.success, sc.key).toBe(true);
            expect(checkSearchRules(parsed.data!), sc.key).toBeNull();
            expect(parsed.data!.mode).toBe('exact');
            expect(exactResponseSchema.safeParse(sc.response).success, sc.key).toBe(true);
        }
    });

    it('scenarios cover every rating level, every result and every alert', () => {
        type R = { result: string; reason?: string; profile?: { ratingLevel: number }; risk: { worstRating: { ratingLevel: number }; flags: string[] }; activity?: unknown };
        const rs = exactScenarios('https://buenadoptante.org').map(sc => sc.response as unknown as R);
        const foundLevels = rs.filter(r => r.result === 'found').map(r => r.profile!.ratingLevel);
        expect(foundLevels).toEqual(expect.arrayContaining([5, 4, 3, 2, 1, 0]));
        expect(rs.map(r => r.reason ?? r.result)).toEqual(expect.arrayContaining(['found', 'not_found', 'name_mismatch', 'multiple_profiles']));
        expect([...new Set(rs.flatMap(r => r.risk.flags))]).toEqual(expect.arrayContaining(['inaccurate', 'possible_duplicate', 'duplicate']));
        const alertTypes = new Set(rs.flatMap(r => (r.risk as unknown as { alerts: Array<{ type: string }> }).alerts.map(a => a.type)));
        expect([...alertTypes].sort()).toEqual(['too_many_adoptions', 'too_many_requests']);
        // The two "too many" live in alerts, never in flags.
        expect(rs.flatMap(r => r.risk.flags).filter(f => f.startsWith('too_many'))).toEqual([]);
    });

    it('scenarios say what each one claims (spot checks against the decision rules)', () => {
        const by = Object.fromEntries(exactScenarios('https://buenadoptante.org').map(sc => [sc.key, sc.response as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(by.five_stars.activity.contactsAdded).toEqual(['email']);           // the email was new
        expect(by.three_stars.profile.matchedOn).toEqual(['documentId']);          // "Jorge Ramírez" ~ "Jorge Luis Ramírez"
        expect(by.shared_phone.result).toBe('found');
        expect(by.shared_phone.otherMatches.count).toBe(1);
        expect(by.shared_phone.risk.worstRating.ratingLevel).toBe(1);              // the relative's 1★ shows in risk
        expect(by.name_mismatch.activity.profileCreated).toBe(true);
        expect(by.multiple_profiles.activity.profileId).toBe('demo-api-laura-a');  // email AND phone match
        expect(by.one_star.profile.alerts).toEqual([{ type: 'too_many_requests', count: 4, periodDays: 30 }]);
        expect(by.one_star.profile.rating).toBe(1.3);
        expect(by.shared_phone.risk.alerts).toEqual([{ type: 'too_many_adoptions', count: 5, periodDays: 90, profileId: 'demo-api-ramon' }]);
        expect(by.five_stars.profile.rating).toBe(4.8);
        expect(by.four_stars.profile.ratingLevel).toBe(4);
        expect(by.not_found.activity.profileCreated).toBe(true);
        expect(by.dry_run.activity).toBeUndefined();
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
