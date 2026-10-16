import { describe, it, expect } from 'vitest';
import { buildOpenApi, responseExamples, REQUEST_EXAMPLES } from './openapi';
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

    it('every example is written out in the guide, not only in the explorer\'s dropdown', () => {
        const guide: string = doc.info.description;
        expect(guide).toContain('## Ejemplos');
        for (const e of Object.values(REQUEST_EXAMPLES)) expect(guide).toContain(`### Pedido — ${e.summary}`);
        for (const e of Object.values(responseExamples('https://staging.buenadoptante.org'))) expect(guide).toContain(`### Respuesta — ${e.summary}`);
        // One answer per rating level, 5★ down to not rated.
        for (const level of [5, 4, 3, 2, 1, 0]) expect(guide).toContain(`"ratingLevel": ${level}`);
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
        const examples = doc.paths['/api/v1/search'].post.requestBody.content['application/json'].examples;
        expect(Object.keys(examples)).toEqual(expect.arrayContaining(['minimal', 'complete_request', 'complete_adoption']));
        for (const [name, ex] of Object.entries(examples) as Array<[string, { value: unknown }]>) {
            const parsed = searchRequestSchema.safeParse(ex.value);
            expect(parsed.success, name).toBe(true);
            expect(checkSearchRules(parsed.data!), name).toBeNull();
        }
        // The minimal one really is minimal: name, one contact, the activity type.
        expect(examples.minimal.value).toEqual({ mode: 'exact', person: { fullName: expect.any(String), phone: expect.any(String) }, activity: { activityType: 'adoption_request' } });
    });

    it('every response example matches the response schema, and they cover each rating and alert case', () => {
        const ex = responseExamples('https://buenadoptante.org');
        for (const [name, e] of Object.entries(ex)) expect(exactResponseSchema.safeParse(e.value).success, name).toBe(true);
        const labels = new Set(Object.values(ex).map(e => (e.value as { risk: { worstRating: { ratingLabel: string } } }).risk.worstRating.ratingLabel));
        expect([...labels]).toEqual(expect.arrayContaining(['not_rated', 'dangerous', 'poor', 'average', 'good', 'excellent']));
        const flags = new Set(Object.values(ex).flatMap(e => (e.value as { risk: { flags: string[] } }).risk.flags));
        expect([...flags]).toEqual(expect.arrayContaining(['inaccurate', 'too_many_requests', 'too_many_adoptions', 'possible_duplicate', 'duplicate']));
        expect(Object.values(ex).map(e => (e.value as { result: string }).result)).toEqual(expect.arrayContaining(['found', 'not_found', 'ambiguous']));
    });

    it('the guide covers every search field', () => {
        for (const f of ['fullName', 'email', 'phone', 'documentId', 'address', 'socials']) expect(doc.info.description).toContain(f);
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
