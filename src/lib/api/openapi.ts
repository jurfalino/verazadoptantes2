/**
 * OpenAPI 3.1 document for the third-party API, generated from the same zod
 * schemas the routes validate with (src/lib/api/schemas.ts).
 */
import { z } from 'zod';
import { exactScenarios, DEFAULT_ALERT_CONFIG, type AlertConfig } from './docScenarios';
import { environmentForHost } from './keys';
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

### Marcas (\`flags\`)
| Marca | Qué significa |
|---|---|
| \`inaccurate\` | Alguien marcó que los datos de esa persona no son confiables. |
| \`duplicate\` | Un rescatista marcó el perfil como duplicado de otro. |
| \`possible_duplicate\` | BuenAdoptante detectó que puede ser la misma persona que otro perfil. |

### Alertas (\`alerts\`)
Lo que BuenAdoptante calcula de la actividad de la persona. Cada alerta trae \`type\`, \`count\` y \`periodDays\`:

| \`type\` | Qué significa |
|---|---|
| \`too_many_requests\` | Pidió adoptar en muchos rescates **distintos** en poco tiempo: \`count\` rescates en \`periodDays\` días (varias solicitudes a un mismo rescate cuentan una vez). |
| \`too_many_adoptions\` | Adoptó muchos animales en poco tiempo: \`count\` adopciones en \`periodDays\` días. |

\`profile.alerts\` son las de esa persona; \`risk.alerts\` junta las de **todos** los perfiles que coincidieron, cada una con su \`profileId\`.

\`profile.flags\` puede traer además \`verified_identity\` y \`verified_address\` (identidad o domicilio verificados): son buenas señales y por eso no aparecen en \`risk\`.

Más abajo, en **Búsqueda exacta: qué pedido da cada respuesta**, hay un escenario por cada calificación (5★ a 1★ y sin calificar) y por cada situación con alertas: qué hay registrado, el pedido exacto y la respuesta.

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

Un pedido completo manda todos los datos que tengas: más datos de contacto ayudan a encontrar a la persona aunque haya cambiado de teléfono. Ver **Ejemplos de pedidos** más abajo: una solicitud completa (con las respuestas de tu formulario) y una adopción completa (con los datos del animal).

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

// ── Example requests ──
// Also written out in the guide (## Ejemplos): the explorer hides these in a dropdown.
export const REQUEST_EXAMPLES = {
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
};

const json = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/** The examples part of the guide: request examples, then every exact-search scenario written out. */
export function examplesGuide(origin: string, cfg: AlertConfig = DEFAULT_ALERT_CONFIG): string {
    const live = environmentForHost(new URL(origin).host) === 'live';
    const curl = (body: unknown, dryRun: boolean) => [
        `curl -X POST ${origin}/api/v1/search \\`,
        `  -H "Authorization: Bearer ${live ? 'ba_live_…' : 'ba_test_…'}" \\`,
        '  -H "Content-Type: application/json" \\',
        '  -H "Idempotency-Key: 3f6c1d2e-un-valor-nuevo-en-cada-llamada" \\',
        ...(dryRun && !live ? ['  -H "X-Dry-Run: 1" \\'] : []),
        `  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`,
    ].join('\n');
    const fence = (lang: string, text: string) => `\`\`\`${lang}\n${text}\n\`\`\``;
    const req = REQUEST_EXAMPLES as Record<string, { summary: string; value: unknown }>;
    return [
        '## Ejemplos de pedidos',
        'A \`POST /api/v1/search\`, con \`Authorization\`, \`Content-Type: application/json\` e \`Idempotency-Key\`.',
        ...Object.values(req).map(e => `### ${e.summary}\n${json(e.value)}`),
        '## Búsqueda exacta: qué pedido da cada respuesta',
        'Cada escenario muestra qué hay registrado en BuenAdoptante, la llamada exacta que hacés y la respuesta que recibís. ' +
        'Mirá siempre \`risk\`: es la peor señal de **todos** los perfiles que coincidieron con el email, teléfono o documento.',
        '**Los headers importan:** toda búsqueda exacta que registra una actividad necesita \`Idempotency-Key\`, con **un valor nuevo en cada llamada** (por ejemplo un UUID). Sin él la respuesta es \`422 idempotency_key_required\`.',
        ...(live ? [] : [
            '**En staging estas personas existen**, así que cada llamada devuelve exactamente la respuesta de su escenario. ' +
            'Para probarlas sin guardar nada, agregá \`-H "X-Dry-Run: 1"\`: la respuesta es la misma, sin \`activity\`. Sin ese header la llamada se guarda (suma la actividad, y la próxima respuesta ya cambia). ' +
            'Un admin las vuelve a dejar como en esta página desde Admin → API → «Personas de ejemplo».',
        ]),
        ...exactScenarios(origin, new Date(), cfg).map((sc, i) => [
            `### ${i + 1}. ${sc.title}`,
            `**Qué hay registrado:** ${sc.registered}`,
            '**Llamada**',
            fence('bash', curl(sc.request, sc.dryRun)),
            '**Respuesta** (\`200\`)',
            json(sc.response),
            `**Por qué:** ${sc.why}`,
        ].join('\n\n')),
    ].join('\n\n');
}

/** `cfg`: this environment's "too many" thresholds, so the documented answers are the ones it gives. */
export function buildOpenApi(origin: string, cfg: AlertConfig = DEFAULT_ALERT_CONFIG) {
    const scenarios = exactScenarios(origin, new Date(), cfg);
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
        info: { title: 'BuenAdoptante API', version: '1.0.0', description: `${GUIDE}\n\n${examplesGuide(origin, cfg)}` },
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
                        name: 'Idempotency-Key', in: 'header', required: true,
                        description: 'Required whenever `activity` is sent (without it: 422 idempotency_key_required). A NEW value on every call, e.g. a UUID; a retry with the same key gets the same answer instead of a second activity. Harmless on a look-up without activity.',
                        schema: { type: 'string', maxLength: 200 },
                    }, {
                        name: 'X-Dry-Run', in: 'header', required: false,
                        description: 'STAGING ONLY, with a ba_test_ key: `1` answers exactly the same but saves nothing (no activity in the answer). In production it is refused with 403 dry_run_not_allowed, for every key.',
                        // No enum/const: the explorer would pre-fill it into every generated curl.
                        schema: { type: 'string' },
                    }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: schema(searchRequestSchema, 'input'),
                                examples: {
                                    ...REQUEST_EXAMPLES,
                                    ...Object.fromEntries(scenarios.map((sc, i) => [`scenario_${sc.key}`, { summary: `Escenario ${i + 1}: ${sc.title}`, value: sc.request }])),
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'exact → found / not_found / ambiguous; fuzzy → ranked results',
                            content: { 'application/json': { schema: { oneOf: [schema(exactResponseSchema), schema(fuzzyResponseSchema)] }, examples: Object.fromEntries(scenarios.map((sc, i) => [`scenario_${sc.key}`, { summary: `Escenario ${i + 1}: ${sc.title}`, value: sc.response }])) } },
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
