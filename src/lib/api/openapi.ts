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
- \`ambiguous\`: el dato coincide con más de un perfil, o con alguien de otro nombre (por ejemplo un teléfono familiar).

**Mirá siempre \`risk\`** antes de entregar un animal: la peor calificación y todas las alertas de **cada** perfil que coincidió con el email, teléfono o documento, sea cual sea el resultado.

**\`mode: "fuzzy"\`**: la misma búsqueda de la página de inicio, con cualquier combinación de campos. Devuelve una lista ordenada por relevancia. No registra nada.

## Cada búsqueda exacta registra una actividad
Mandá \`activity\` con su tipo (\`activityType\`): \`adoption_request\`, \`adoption\`, \`foster\`, \`follow_up\`, \`returned_pet\` u \`observation\`. Se guarda sobre la persona:
- **\`found\`**: en su perfil. Si mandaste un email, teléfono o documento que su perfil no tenía, se agrega (queda en el historial del perfil y te lo decimos en \`activity.contactsAdded\`).
- **\`not_found\`**: en un perfil nuevo.
- **\`ambiguous\`**: si el nombre coincide con alguno de los perfiles, en el que mejor coincide; si no coincide con ninguno, en un perfil nuevo que un admin revisa como posible duplicado.

Todo lo demás de \`activity\` es opcional: tu id (\`externalId\`), el animal (\`animalName\`, \`species\`), la fecha, notas y la calificación (si no la tenés, no la mandes). En un \`adoption_request\` podés mandar en \`formContent\` **todas las respuestas de tu formulario**, con la forma que tengan (cualquier objeto JSON, hasta 50 KB): se muestran en la actividad como pregunta → respuesta. Si la persona llena un formulario por cada animal, mandá una actividad por cada uno.

**Mandá siempre el header \`Idempotency-Key\`** (cualquier texto único, por ejemplo un UUID): si reintentás la misma llamada, devuelve la misma respuesta en vez de registrar dos veces.

**Volver a consultar sin registrar**: una búsqueda exacta **sin** \`activity\` solo se responde si tu rescate ya registró a esa persona; si no, responde \`422 activity_required\`.

## Anular una actividad: \`POST /api/v1/activities/{id}/void\`
Solo actividades guardadas por tu propia clave. Se quitan también las respuestas del formulario y los datos de contacto que esa llamada agregó.

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
        // error.code is one of the enum in the error schema; clients should also tolerate codes added later.
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
                    summary: 'Buscar a una persona y registrar su actividad',
                    operationId: 'search',
                    parameters: [{
                        name: 'Idempotency-Key', in: 'header', required: false,
                        description: 'Required whenever `activity` is sent. Any unique string, e.g. a UUID; a retry with the same key gets the same answer instead of a second activity.',
                        schema: { type: 'string', maxLength: 200 },
                    }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: schema(searchRequestSchema, 'input'),
                                examples: {
                                    exact: {
                                        summary: 'Exact: check and register an adoption request',
                                        value: { mode: 'exact', person: { fullName: 'María José Pérez', phone: '+54 9 11 6462-2274' }, activity: { activityType: 'adoption_request' } },
                                    },
                                    exact_with_form: {
                                        summary: 'Exact, with the animal and your form\'s answers',
                                        value: {
                                            mode: 'exact',
                                            person: { fullName: 'María José Pérez', email: 'maria@example.com' },
                                            activity: {
                                                activityType: 'adoption_request', externalId: 'jotform-5512', animalName: 'Luna', species: 'dog',
                                                formContent: { '¿Tenés patio?': 'Sí', '¿Quiénes viven en la casa?': ['2 adultos', '1 niño'], mascotas: [{ tipo: 'gato', edad: 3 }] },
                                            },
                                        },
                                    },
                                    exact_lookup: {
                                        summary: 'Exact look-up of someone your rescue already registered (saves nothing)',
                                        value: { mode: 'exact', person: { fullName: 'María José Pérez', email: 'maria@example.com' } },
                                    },
                                    fuzzy: {
                                        summary: 'Fuzzy: like the homepage',
                                        value: { mode: 'fuzzy', person: { fullName: 'María Pérez', socials: [{ platform: 'instagram', handle: '@mariajose' }] } },
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
            '/api/v1/activities/{id}/void': {
                post: {
                    summary: 'Anular una actividad guardada por esta clave',
                    operationId: 'voidActivity',
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '`activity.activityId` from the search response' }],
                    responses: {
                        '200': { description: 'Voided', content: { 'application/json': { schema: schema(voidResponseSchema) } } },
                        '401': errors['401'], '403': errors['403'], '404': errors['404'],
                    },
                },
            },
        },
    };
}
