/**
 * OpenAPI 3.1 document for the third-party API, generated from the same zod
 * schemas the routes validate with (src/lib/api/schemas.ts).
 */
import { z } from 'zod';
import {
    errorResponseSchema, contractResponseSchema, exactResponseSchema, fuzzyResponseSchema, meResponseSchema,
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

### Calificaciones
| \`ratingLevel\` | \`ratingLabel\` | Qué significa |
|---|---|---|
| 0 | \`not_rated\` | Nadie la calificó todavía. No es ni bueno ni malo: nunca se infiere una calificación. |
| 1 | \`dangerous\` | Peligroso. **En BuenAdoptante, 1★ impide adoptar.** |
| 2 | \`poor\` | Malo. |
| 3 | \`average\` | Regular. |
| 4 | \`good\` | Bueno. |
| 5 | \`excellent\` | Excelente. |

\`rating\` es el promedio (con un decimal) de todas las calificaciones; \`ratingLevel\` es ese promedio redondeado.

### Alertas (\`risk.flags\`)
| Alerta | Qué significa |
|---|---|
| \`inaccurate\` | Alguien marcó que los datos de esa persona no son confiables. |
| \`duplicate\` | Un rescatista marcó el perfil como duplicado de otro. |
| \`possible_duplicate\` | BuenAdoptante detectó que puede ser la misma persona que otro perfil. |
| \`too_many_requests\` | Pidió adoptar en muchos rescates **distintos** en poco tiempo (detalle en \`profile.tooManyRequests\`). |
| \`too_many_adoptions\` | Adoptó muchos animales en poco tiempo (detalle en \`profile.tooManyAdoptions\`). |

\`profile.flags\` puede traer además \`verified_identity\` y \`verified_address\` (identidad o domicilio verificados): son buenas señales y por eso no aparecen en \`risk\`.

En las respuestas de ejemplo de \`POST /api/v1/search\` hay un caso de cada tipo: persona excelente, persona peligrosa con alertas, un teléfono compartido con alguien peligroso, desconocida y ambigua.

**\`mode: "fuzzy"\`**: la misma búsqueda de la página de inicio, con cualquier combinación de campos. Devuelve una lista ordenada por relevancia. No registra nada.

## Cada búsqueda exacta registra una actividad
Mandá \`activity\` con su tipo (\`activityType\`): \`adoption_request\`, \`adoption\`, \`foster\`, \`follow_up\`, \`returned_pet\` u \`observation\`. Se guarda sobre la persona:
- **\`found\`**: en su perfil. Si mandaste un email, teléfono o documento que su perfil no tenía, se agrega (queda en el historial del perfil y te lo decimos en \`activity.contactsAdded\`).
- **\`not_found\`**: en un perfil nuevo.
- **\`ambiguous\`**: si el nombre coincide con alguno de los perfiles, en el que mejor coincide; si no coincide con ninguno, en un perfil nuevo que un admin revisa como posible duplicado.

Todo lo demás de \`activity\` es opcional: tu id (\`externalId\`), el animal (\`animalName\`, \`species\`), la fecha, notas y la calificación (si no la tenés, no la mandes).

**Adopción o tránsito** (\`adoption\`, \`foster\`): el animal queda en tu lista de animales, así que \`species\` es **obligatorio**. Podés sumar sus datos: \`age\` (como lo escribirías: "2 años", "3 meses") o \`birthDate\`, \`sex\` (\`female\` / \`male\`), \`neutered\`, \`color\` y \`microchip\`. Esos datos del animal no se aceptan en otros tipos de actividad. En un \`adoption_request\` podés mandar en \`formContent\` **todas las respuestas de tu formulario**, con la forma que tengan (cualquier objeto JSON, hasta 50 KB): se muestran en la actividad como pregunta → respuesta. Si la persona llena un formulario por cada animal, mandá una actividad por cada uno.

### Pedido mínimo y pedido completo
Lo mínimo para registrar una solicitud: nombre y apellido, **un** dato de contacto (email, teléfono o documento) y el tipo de actividad.

\`\`\`
curl -X POST https://buenadoptante.org/api/v1/search \\
  -H "Authorization: Bearer ba_live_…" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 6f1c2a9e-3b0d-4e55-9d4f-1a2b3c4d5e6f" \\
  -d '{"mode":"exact","person":{"fullName":"María José Pérez","phone":"11 6462-2274"},"activity":{"activityType":"adoption_request"}}'
\`\`\`

Un pedido completo manda todos los datos que tengas: más datos de contacto ayudan a encontrar a la persona aunque haya cambiado de teléfono. Los ejemplos \`complete_request\` (una solicitud con las respuestas de tu formulario) y \`complete_adoption\` (una adopción con los datos del animal) de \`POST /api/v1/search\` muestran cada campo.

**Mandá siempre el header \`Idempotency-Key\`** (cualquier texto único, por ejemplo un UUID): si reintentás la misma llamada, devuelve la misma respuesta en vez de registrar dos veces.

**Volver a consultar sin registrar**: una búsqueda exacta **sin** \`activity\` solo se responde si tu rescate ya registró a esa persona; si no, responde \`422 activity_required\`.

## Adjuntar el contrato firmado: \`POST /api/v1/activities/{id}/contract\`
Después de registrar una adopción o tránsito, mandá el contrato firmado: el cuerpo de la llamada **es el archivo** (PDF, PNG o JPG, hasta 5 MB) con su \`Content-Type\` (\`application/pdf\`, \`image/png\` o \`image/jpeg\`). Lo guardamos nosotros, de forma privada: en el perfil aparece "Ver contrato firmado" para tu rescate y los administradores. Un contrato no se reemplaza; si te equivocaste, anulá la actividad y registrala de nuevo.

\`\`\`
curl -X POST https://buenadoptante.org/api/v1/activities/{activityId}/contract \\
  -H "Authorization: Bearer ba_live_…" -H "Content-Type: application/pdf" \\
  --data-binary @contrato-firmado.pdf
\`\`\`

## Anular una actividad: \`POST /api/v1/activities/{id}/void\`
Solo actividades guardadas por tu propia clave. Se quitan también las respuestas del formulario y los datos de contacto que esa llamada agregó.

## Probar sin guardar: header \`X-Dry-Run: 1\` (solo staging)
Mientras armás tu integración, agregá \`X-Dry-Run: 1\` a una búsqueda: responde exactamente lo mismo (\`found\`, \`not_found\`, \`ambiguous\`, \`risk\`…), pero **no guarda nada**: ni actividad, ni perfil, ni datos de contacto, ni avisos. La respuesta trae el header \`X-Dry-Run: 1\` y no incluye \`activity\`.

- **Funciona solo en staging, con una clave \`ba_test_…\`.**
- **En producción no funciona**: con cualquier clave, la llamada se rechaza con \`403 dry_run_not_allowed\` (no se guarda nada, tampoco). En producción cada búsqueda exacta queda registrada.
- No vale para anular una actividad ni para adjuntar un contrato (\`422 dry_run_not_allowed\`).

\`\`\`
curl -X POST https://staging.buenadoptante.org/api/v1/search \\
  -H "Authorization: Bearer ba_test_…" -H "Content-Type: application/json" \\
  -H "X-Dry-Run: 1" -H "Idempotency-Key: prueba-1" \\
  -d '{"mode":"exact","person":{"fullName":"María José Pérez","phone":"11 6462-2274"},"activity":{"activityType":"adoption_request"}}'
\`\`\`

## Probar la conexión: \`GET /api/v1/me\`
Muestra a qué rescatista pertenece la clave y cuánto del cupo diario se usó.

## Cupos
Cada clave tiene un cupo diario de búsquedas exactas y otro (menor) de búsquedas fuzzy. Se reinician a las 00:00 UTC. Al llegar al cupo, la respuesta es \`429\` con \`Retry-After\`.
`.trim();

// ── Example answers: one per rating / alert situation a partner must handle ──

type Level = 0 | 1 | 2 | 3 | 4 | 5;
const LABELS = ['not_rated', 'dangerous', 'poor', 'average', 'good', 'excellent'] as const;
const rating = (avg: number | null) => {
    const level = (avg === null ? 0 : Math.min(5, Math.max(1, Math.round(avg)))) as Level;
    return { rating: avg, ratingLevel: level, ratingLabel: LABELS[level] };
};
const noRisk = { worstRating: rating(null), flags: [] as string[], profilesMatched: 0 };

/** Exported for the test that checks every example against the response schema. */
export function responseExamples(origin: string) {
    const url = (id: string) => `${origin}/adopter/${id}`;
    const profile = (id: string, avg: number | null, extra: Record<string, unknown> = {}) => ({
        profileId: id, url: url(id), ...rating(avg), matchedOn: ['phone'], nameMatchedAs: 'profile',
        flags: [], tooManyRequests: null, tooManyAdoptions: null,
        records: { adoption_request: 2, adoption: 1 }, lastRecordAt: '2026-08-30', ...extra,
    });
    const saved = (id: string, created = false, contactsAdded: string[] = []) => ({
        activityId: 'r_9f3c1e', activityUrl: `${url(id)}?record=r_9f3c1e`, profileId: id, profileUrl: url(id), profileCreated: created, contactsAdded,
    });
    return {
        found_excellent: {
            summary: 'found — persona conocida, 5★ excelente, sin alertas',
            value: {
                requestId: 'b1d0c8e2-0000-4000-8000-000000000001', mode: 'exact', result: 'found',
                profile: profile('a_ok', 4.8, { flags: ['verified_identity'] }),
                risk: { worstRating: rating(4.8), flags: [], profilesMatched: 1 },
                activity: saved('a_ok', false, ['email']),
            },
        },
        found_dangerous: {
            summary: 'found — 1★ peligroso, con alertas: no entregues el animal',
            value: {
                requestId: 'b1d0c8e2-0000-4000-8000-000000000002', mode: 'exact', result: 'found',
                profile: profile('a_bad', 1.3, {
                    matchedOn: ['phone', 'email'], flags: ['inaccurate'],
                    tooManyRequests: { count: 4, periodDays: 30 },
                    records: { adoption_request: 6, returned_pet: 2, observation: 1 },
                }),
                risk: { worstRating: rating(1.3), flags: ['inaccurate', 'too_many_requests'], profilesMatched: 1 },
                activity: saved('a_bad'),
            },
        },
        found_shared_phone_risk: {
            summary: 'found — la persona está bien (4★), pero su teléfono también es de alguien 1★: risk lo muestra',
            value: {
                requestId: 'b1d0c8e2-0000-4000-8000-000000000003', mode: 'exact', result: 'found',
                profile: profile('a_ok', 4.2),
                otherMatches: { count: 1, urls: [url('a_relative')], worstRating: rating(1) },
                risk: { worstRating: rating(1), flags: ['too_many_adoptions'], profilesMatched: 2 },
                activity: saved('a_ok'),
            },
        },
        found_not_rated: {
            summary: 'found — conocida pero nunca calificada (not_rated): no es buena ni mala señal',
            value: {
                requestId: 'b1d0c8e2-0000-4000-8000-000000000004', mode: 'exact', result: 'found',
                profile: profile('a_new', null, { records: { adoption_request: 1 }, lastRecordAt: '2026-09-02' }),
                risk: { worstRating: rating(null), flags: [], profilesMatched: 1 },
                activity: saved('a_new'),
            },
        },
        not_found: {
            summary: 'not_found — nadie la registró: se crea su perfil con esta actividad',
            value: {
                requestId: 'b1d0c8e2-0000-4000-8000-000000000005', mode: 'exact', result: 'not_found',
                risk: noRisk,
                activity: saved('a_created', true),
            },
        },
        ambiguous_name_mismatch: {
            summary: 'ambiguous — el teléfono es de otra persona (otro nombre), calificada 2★',
            value: {
                requestId: 'b1d0c8e2-0000-4000-8000-000000000006', mode: 'exact', result: 'ambiguous',
                reason: 'name_mismatch', candidates: 1, candidateUrls: [url('a_other')], worstRating: rating(2),
                risk: { worstRating: rating(2), flags: ['possible_duplicate'], profilesMatched: 1 },
                activity: saved('a_created2', true),
            },
        },
        ambiguous_multiple_profiles: {
            summary: 'ambiguous — el email está en dos perfiles con el mismo nombre; se guardó en el que mejor coincide',
            value: {
                requestId: 'b1d0c8e2-0000-4000-8000-000000000007', mode: 'exact', result: 'ambiguous',
                reason: 'multiple_profiles', candidates: 2, candidateUrls: [url('a_one'), url('a_two')], worstRating: rating(3),
                risk: { worstRating: rating(3), flags: ['duplicate'], profilesMatched: 2 },
                activity: saved('a_one'),
            },
        },
        dry_run: {
            summary: 'X-Dry-Run: 1 (solo staging) — la misma respuesta, sin activity: no se guardó nada',
            value: {
                requestId: 'b1d0c8e2-0000-4000-8000-000000000008', mode: 'exact', result: 'not_found',
                risk: noRisk,
            },
        },
    };
}

export function buildOpenApi(origin: string) {
    const error = { description: 'Error', content: { 'application/json': { schema: schema(errorResponseSchema) } } };
    const errors = {
        '400': { ...error, description: 'Invalid JSON' },
        '401': { ...error, description: 'Missing, unknown or revoked key' },
        '403': { ...error, description: 'The key lacks a scope, or X-Dry-Run was sent in production (dry_run_not_allowed)' },
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
                    }, {
                        name: 'X-Dry-Run', in: 'header', required: false,
                        description: 'STAGING ONLY, with a ba_test_ key: `1` answers exactly the same but saves nothing (no activity in the answer). In production it is refused with 403 dry_run_not_allowed, for every key.',
                        schema: { type: 'string', enum: ['1'] },
                    }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: schema(searchRequestSchema, 'input'),
                                examples: {
                                    minimal: {
                                        summary: 'Mínimo: registrar una solicitud (nombre + un contacto + tipo)',
                                        value: { mode: 'exact', person: { fullName: 'María José Pérez', phone: '11 6462-2274' }, activity: { activityType: 'adoption_request' } },
                                    },
                                    complete_request: {
                                        summary: 'Completo: una solicitud con todos los datos y las respuestas de tu formulario',
                                        value: {
                                            mode: 'exact',
                                            person: {
                                                fullName: 'María José Pérez', email: 'maria@example.com', phone: '+54 9 11 6462-2274',
                                                documentId: { value: '30.123.456', country: 'AR' }, address: 'Av. Siempreviva 742, CABA',
                                                socials: [{ platform: 'instagram', handle: '@mariajose' }, { platform: 'facebook', handle: 'facebook.com/mariajose.perez' }],
                                            },
                                            activity: {
                                                activityType: 'adoption_request', externalId: 'jotform-5512', animalName: 'Luna', species: 'dog',
                                                date: '2026-10-12', notes: 'Llamó dos veces preguntando por Luna.',
                                                formContent: { '¿Tenés patio?': 'Sí', '¿Quiénes viven en la casa?': ['2 adultos', '1 niño'], mascotas: [{ tipo: 'gato', edad: 3, castrado: true }] },
                                            },
                                        },
                                    },
                                    complete_adoption: {
                                        summary: 'Completo: una adopción con los datos del animal (species obligatorio; después adjuntá el contrato)',
                                        value: {
                                            mode: 'exact',
                                            person: { fullName: 'María José Pérez', phone: '+54 9 11 6462-2274', email: 'maria@example.com', documentId: { value: '30.123.456', country: 'AR' } },
                                            activity: {
                                                activityType: 'adoption', externalId: 'adopcion-2026-118',
                                                animalName: 'Luna', species: 'cat', age: '2 años', sex: 'female', neutered: true,
                                                color: 'atigrada', microchip: '985112345678901',
                                                date: '2026-10-12', rating: 5, notes: 'Entrega en domicilio, todo en orden.',
                                            },
                                        },
                                    },
                                    exact_lookup: {
                                        summary: 'Volver a consultar a alguien que tu rescate ya registró (no guarda nada)',
                                        value: { mode: 'exact', person: { fullName: 'María José Pérez', email: 'maria@example.com' } },
                                    },
                                    fuzzy: {
                                        summary: 'Fuzzy: como la búsqueda de la página de inicio',
                                        value: { mode: 'fuzzy', person: { fullName: 'María Pérez', socials: [{ platform: 'instagram', handle: '@mariajose' }] } },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'exact → found / not_found / ambiguous; fuzzy → ranked results',
                            content: { 'application/json': { schema: { oneOf: [schema(exactResponseSchema), schema(fuzzyResponseSchema)] }, examples: responseExamples(origin) } },
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
            '/api/v1/activities/{id}/contract': {
                post: {
                    summary: 'Adjuntar el contrato firmado a una adopción o tránsito',
                    operationId: 'attachContract',
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '`activity.activityId` of an adoption / foster this key saved' }],
                    requestBody: {
                        required: true,
                        description: 'The file itself (≤5 MB).',
                        content: {
                            'application/pdf': { schema: { type: 'string', format: 'binary' } },
                            'image/png': { schema: { type: 'string', format: 'binary' } },
                            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
                        },
                    },
                    responses: {
                        '201': { description: 'Stored', content: { 'application/json': { schema: schema(contractResponseSchema) } } },
                        '401': errors['401'], '403': errors['403'], '404': errors['404'],
                        '409': { ...error, description: 'This activity already has a contract' },
                        '413': { ...error, description: 'Larger than 5 MB' },
                        '415': { ...error, description: 'Not a PDF, PNG or JPEG' },
                        '422': errors['422'],
                    },
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
