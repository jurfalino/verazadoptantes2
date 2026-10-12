/**
 * OpenAPI 3.1 document for the third-party API, generated from the same zod
 * schemas the routes validate with (src/lib/api/schemas.ts).
 */
import { z } from 'zod';
import {
    errorResponseSchema, exactResponseSchema, fuzzyResponseSchema, meResponseSchema,
    searchRequestSchema, voidResponseSchema,
} from './schemas';

const schema = (s: z.ZodType, io: 'input' | 'output' = 'output') => {
    const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io, unrepresentable: 'any' }) as Record<string, unknown>;
    void _drop;
    return rest;
};

const GUIDE = `
API para que las herramientas de tu rescate (formulario propio, planilla, sistema de gestión) consulten y registren adoptantes en BuenAdoptante.

## Autenticación
Cada clave pertenece a un rescatista. Enviala en cada llamada: \`Authorization: Bearer ba_live_…\`.
Las claves \`ba_test_…\` funcionan solo en staging, para probar.

## Buscar a una persona: \`POST /api/v1/search\`
Podés enviar cualquiera de estos datos de la persona:

| Campo | Ejemplo |
|---|---|
| \`fullName\` | María José Pérez |
| \`email\` | maria@example.com |
| \`phone\` | +54 9 11 6462-2274 (cualquier formato) |
| \`documentId.value\` | 30.123.456 (DNI, CI, CPF, RUT…) |
| \`address\` | Av. Siempreviva 742, CABA |
| \`socials\` | [{ "platform": "instagram", "handle": "@mariajose" }] |

**\`mode: "exact"\`**: nombre y apellido **más** email, teléfono o documento. Responde:
- \`found\`: es una persona conocida; incluye su calificación, alertas y un link a su perfil.
- \`not_found\`: no hay registros de esa persona.
- \`ambiguous\`: el dato coincide con más de un perfil, o con alguien de otro nombre (por ejemplo un teléfono familiar). Incluye la **peor calificación** entre los candidatos, para que puedas frenar igual.

**\`mode: "fuzzy"\`**: la misma búsqueda de la página de inicio, con cualquier combinación de campos. Devuelve una lista ordenada por relevancia.

**\`context\`** (obligatorio): qué está haciendo la persona: \`adoption_request\`, \`adoption\`, \`foster\`, \`follow_up\`, \`returned_pet\` u \`observation\`.

## Registrar en la misma llamada
En modo exacto, agregá \`save\` para guardar el registro (con el header \`Idempotency-Key\`, así un reintento no lo duplica). Si la persona era conocida, se agrega a su perfil; si no, se crea un perfil nuevo. La calificación es opcional: si no la tenés, no la mandes.

## Anular un registro: \`POST /api/v1/records/{id}/void\`
Solo registros guardados por tu propia clave.

## Probar la conexión: \`GET /api/v1/me\`
Muestra a qué rescatista pertenece la clave y cuánto del cupo diario se usó.

## Cupos
Cada clave tiene un cupo diario de búsquedas exactas y otro (menor) de búsquedas fuzzy. Se reinician a las 00:00 UTC. Al llegar al cupo, la respuesta es \`429\` con \`Retry-After\`.
`.trim();

export function buildOpenApi(origin: string) {
    const error = { description: 'Error', content: { 'application/json': { schema: schema(errorResponseSchema) } } };
    const errors = {
        '400': { ...error, description: 'Invalid JSON' },
        '401': { ...error, description: 'Missing, unknown or revoked key' },
        '403': { ...error, description: 'The key lacks a scope' },
        '404': { ...error, description: 'Not found, or the API is disabled' },
        '409': { ...error, description: 'Idempotency-Key or externalId already used' },
        '422': { ...error, description: 'Validation failed (see error.code)' },
        '429': { ...error, description: 'Daily cap reached (see Retry-After)' },
        '500': { ...error, description: 'Server error (quote error.errorId)' },
    };
    return {
        openapi: '3.1.0',
        info: { title: 'BuenAdoptante API', version: '1.0.0', description: GUIDE },
        servers: [{ url: origin }],
        security: [{ bearerAuth: [] }],
        components: {
            securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'ba_live_… / ba_test_…' } },
        },
        paths: {
            '/api/v1/search': {
                post: {
                    summary: 'Buscar a una persona (y opcionalmente registrar)',
                    operationId: 'search',
                    parameters: [{
                        name: 'Idempotency-Key', in: 'header', required: false,
                        description: 'Required when `save` is present. Any unique string, e.g. a UUID.',
                        schema: { type: 'string', maxLength: 200 },
                    }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: schema(searchRequestSchema, 'input'),
                                examples: {
                                    exact_check: {
                                        summary: 'Exact: check only',
                                        value: { mode: 'exact', context: 'adoption_request', person: { fullName: 'María José Pérez', phone: '+54 9 11 6462-2274' } },
                                    },
                                    exact_save: {
                                        summary: 'Exact: check and save the request',
                                        value: {
                                            mode: 'exact', context: 'adoption_request',
                                            person: { fullName: 'María José Pérez', email: 'maria@example.com' },
                                            save: { externalId: 'jotform-5512', animalName: 'Luna', species: 'dog', notes: 'Aplicó por el formulario de la web' },
                                        },
                                    },
                                    fuzzy: {
                                        summary: 'Fuzzy: like the homepage',
                                        value: { mode: 'fuzzy', context: 'adoption_request', person: { fullName: 'María Pérez', socials: [{ platform: 'instagram', handle: '@mariajose' }] } },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'exact → found / not_found / ambiguous; fuzzy → ranked results',
                            content: { 'application/json': { schema: { oneOf: [schema(exactResponseSchema), schema(fuzzyResponseSchema)] } } },
                        },
                        ...errors,
                    },
                },
            },
            '/api/v1/me': {
                get: {
                    summary: 'Probar la conexión: a quién pertenece la clave y su cupo',
                    operationId: 'me',
                    responses: { '200': { description: 'OK', content: { 'application/json': { schema: schema(meResponseSchema) } } }, '401': errors['401'] },
                },
            },
            '/api/v1/records/{id}/void': {
                post: {
                    summary: 'Anular un registro guardado por esta clave',
                    operationId: 'voidRecord',
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '`saved.recordId` from the search response' }],
                    responses: {
                        '200': { description: 'Voided', content: { 'application/json': { schema: schema(voidResponseSchema) } } },
                        '401': errors['401'], '403': errors['403'], '404': errors['404'],
                    },
                },
            },
        },
    };
}
