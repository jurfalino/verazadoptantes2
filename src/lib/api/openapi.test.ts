import { describe, it, expect } from 'vitest';
import { buildOpenApi } from './openapi';

describe('buildOpenApi', () => {
    const doc = buildOpenApi('https://staging.buenadoptante.org') as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    it('documents the three v1 endpoints', () => {
        expect(Object.keys(doc.paths)).toEqual(['/api/v1/search', '/api/v1/me', '/api/v1/records/{id}/void']);
    });

    it('the request schema is generated from the zod contract (every person field, every context)', () => {
        const req = doc.paths['/api/v1/search'].post.requestBody.content['application/json'].schema;
        expect(Object.keys(req.properties.person.properties).sort())
            .toEqual(['address', 'documentId', 'email', 'fullName', 'phone', 'socials']);
        expect(req.properties.context.enum).toEqual(['adoption_request', 'adoption', 'foster', 'follow_up', 'returned_pet', 'observation']);
        expect(req.required).toEqual(expect.arrayContaining(['mode', 'context', 'person']));
    });

    it('the guide covers every search field', () => {
        for (const f of ['fullName', 'email', 'phone', 'documentId', 'address', 'socials']) expect(doc.info.description).toContain(f);
    });
});
