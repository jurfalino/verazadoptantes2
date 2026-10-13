import { describe, it, expect } from 'vitest';
import { buildOpenApi } from './openapi';

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

    it('every response carries risk; error codes are published, the hidden dry-run refusal is not', () => {
        const exact = doc.paths['/api/v1/search'].post.responses['200'].content['application/json'].schema.oneOf[0];
        expect(exact.required).toContain('risk');
        const codes = doc.paths['/api/v1/search'].post.responses['422'].content['application/json'].schema.properties.error.properties.code.enum;
        expect(codes).toEqual(expect.arrayContaining(['activity_required', 'form_content_requires_adoption_request', 'idempotency_key_required']));
        expect(codes).not.toContain('dry_run_not_allowed');
        expect(JSON.stringify(doc)).not.toMatch(/dry.?run/i);
    });

    it('the guide covers every search field', () => {
        for (const f of ['fullName', 'email', 'phone', 'documentId', 'address', 'socials']) expect(doc.info.description).toContain(f);
    });
});
