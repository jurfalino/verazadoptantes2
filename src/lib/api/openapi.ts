/**
 * OpenAPI 3.1 document for the third-party API, generated from the same zod
 * schemas the routes validate with (src/lib/api/schemas.ts).
 */
import { z } from 'zod';
import { exactScenarios, DEFAULT_ALERT_CONFIG, REQUEST_EXAMPLES, type AlertConfig, type Scenario } from './docScenarios';
import { environmentForHost } from './keys';
import {
    errorResponseSchema, contractResponseSchema, exactResponseSchema, fuzzyResponseSchema, meResponseSchema, pastCallResponseSchema,
    searchRequestSchema, voidResponseSchema,
} from './schemas';

const schema = (s: z.ZodType, io: 'input' | 'output' = 'output') => {
    const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io, unrepresentable: 'any' }) as Record<string, unknown>;
    void _drop;
    return rest;
};

/** The guide on the docs page, for this environment (its host, its key prefix, dry run only off production). */
function guide(origin: string, live: boolean): string {
    const key = live ? 'ba_live_…' : 'ba_test_…';
    const B = '\\';
    const fence = (text: string) => '```bash\n' + text + '\n```';
    const post = (path: string, body: unknown, extra: string[] = []) => fence([
        `curl -X POST ${origin}${path} ${B}`,
        `  -H "Authorization: Bearer ${key}" ${B}`,
        `  -H "Content-Type: application/json" ${B}`,
        ...extra.map(h => `  -H "${h}" ${B}`),
        `  -d '${JSON.stringify(body)}'`,
    ].join('\n'));
    const get = (path: string) => fence(`curl ${origin}${path} ${B}\n  -H "Authorization: Bearer ${key}"`);
    const maria = { fullName: 'María José Pérez', phone: '11 5550-3101' };
    return `
API para que las herramientas de tu rescate (formulario propio, planilla, sistema de gestión) consulten y registren adoptantes en BuenAdoptante.

## Empezar en 3 pasos
0. **Creá tu clave** en [${origin}/developers](${origin}/developers): iniciá sesión, aceptá las condiciones de uso y creala (la ves una sola vez).
1. **Probá tu clave:**
${get('/api/v1/me')}
2. **Buscá a alguien sin registrar nada** (\`mode: "fuzzy"\`):
${post('/api/v1/search', { mode: 'fuzzy', person: { fullName: 'María Pérez' } })}
3. **Registrá una solicitud** (\`mode: "exact"\`). \`externalId\` es tu id de ese registro${live ? '' : '; en staging, con `X-Dry-Run: 1` no se guarda nada'}:
${post('/api/v1/search', { mode: 'exact', person: maria, activity: { activityType: 'adoption_request', externalId: 'mi-formulario-1234' } }, live ? [] : ['X-Dry-Run: 1'])}

## Autenticación
**Cómo conseguir una clave:** creala vos en [${origin}/developers](${origin}/developers) — iniciá sesión, aceptá las condiciones de uso y creá la clave; se muestra una sola vez (si la perdés, la regenerás ahí). Allí también ves tus llamadas y podés revocarla. ${live ? 'Para probar, creá también una clave en staging.' : 'Acá en staging te da una clave de prueba (`ba_test_…`).'} Cada clave tiene un cupo de 100 búsquedas exactas y 50 fuzzy por día; si necesitás más, escribinos.

Cada clave pertenece a un rescatista. Enviala en cada llamada: \`Authorization: Bearer ba_live_…\` en producción, \`Bearer ba_test_…\` en staging (cada ambiente tiene sus propias claves). Si la clave no sirve, \`401 unauthorized\` dice por qué: que falta, que está mal escrita, que es de otro ambiente, o que no existe o fue revocada.

## Dos maneras de buscar: \`POST /api/v1/search\`
| \`mode\` | Para qué | ¿Guarda algo? |
|---|---|---|
| \`fuzzy\` | **Buscar** a alguien con cualquier dato, como la página de inicio. Devuelve una lista ordenada por relevancia, cada una con su calificación, marcas y alertas. | **Nunca.** |
| \`exact\` | **Registrar** algo de una persona (una solicitud, una adopción…): con nombre y apellido **más** email, teléfono o documento, la identifica y guarda la actividad. | **Siempre.** |

Datos de la persona que podés mandar:

| Campo | Ejemplo |
|---|---|
| \`fullName\` | María José Pérez |
| \`email\` | mariajose.demo@example.com |
| \`phone\` | +54 9 11 5550-3101 (cualquier formato) |
| \`documentId.value\` | 99.555.310 (DNI, CI, CPF, RUT…) |
| \`address\` | Av. Siempreviva 742, CABA (solo la usa fuzzy) |
| \`socials\` | [{ "platform": "instagram", "handle": "@mariajose.demo" }] (solo la usa fuzzy) |

## Búsqueda exacta: registrar una actividad
Mandá \`activity\` con su tipo (\`activityType\`: \`adoption_request\`, \`adoption\`, \`foster\`, \`follow_up\`, \`returned_pet\` u \`observation\`) y **\`externalId\`: tu propio id de ese registro** (el número de respuesta de tu formulario, la fila de tu planilla…). Lo demás es opcional: el animal (\`animalName\`, \`species\`), la fecha, notas y la calificación (si no la tenés, no la mandes: nunca se infiere).

**\`externalId\` hace que un reintento no registre dos veces.** Si se corta la conexión y mandás de nuevo la misma llamada con el mismo \`externalId\`, recibís la respuesta original (\`replayed: true\`) y no se guarda nada nuevo. El mismo \`externalId\` con otro contenido se rechaza (\`409 external_id_reused\`, con el \`activityId\` de lo que ya se guardó). Anular una actividad libera su \`externalId\`.

**Adopción o tránsito** (\`adoption\`, \`foster\`): el animal queda en tu lista de animales, así que \`species\` es **obligatorio**. Podés sumar sus datos: \`age\` (como lo escribirías: "2 años", "3 meses") o \`birthDate\`, \`sex\` (\`female\` / \`male\`), \`neutered\`, \`color\` y \`microchip\`. En un \`adoption_request\` podés mandar en \`formContent\` **todas las respuestas de tu formulario**, con la forma que tengan (cualquier objeto JSON, hasta 50 KB). Si la persona llena un formulario por cada animal, mandá una actividad por cada uno.

La respuesta dice dos cosas por separado:

**\`match\`: qué había en BuenAdoptante antes de tu llamada**
- \`found\`: una persona conocida; viene en \`profile\` (calificación, marcas, alertas, link a su perfil).
- \`not_found\`: nadie tiene ese email, teléfono o documento.
- \`ambiguous\`: el dato es de más de un perfil, o de alguien con otro nombre (por ejemplo un teléfono familiar); vienen en \`candidates\`.

**\`saved.action\`: qué hizo tu llamada** (siempre viene)
| \`match\` | \`saved.action\` | Qué pasó |
|---|---|---|
| \`found\` | \`added_to_profile\` | La actividad se sumó al perfil de esa persona. |
| \`not_found\` | \`created_profile\` | Se creó su perfil, con esta actividad. |
| \`ambiguous\` | \`added_to_best_match\` | Varios perfiles encajan con el nombre: se sumó al que mejor coincide. |
| \`ambiguous\` | \`created_profile_for_review\` | El dato es de alguien con otro nombre: se creó un perfil nuevo que un admin revisa como posible duplicado. |

\`saved\` trae además \`activityId\` (para adjuntar el contrato o anularla), los links al perfil y \`contactsAdded\` (los datos de contacto que mandaste y la persona no tenía, que se agregaron a su perfil).

\`profile.registeredByYourRescue\` dice si tu rescate ya le había registrado algo (por ejemplo, si una llamada tuya anterior creó ese perfil) y \`profile.createdAt\` desde cuándo existe.

## Riesgo: qué mirar antes de entregar un animal
**Mirá siempre \`risk\`**: la peor calificación (\`worstRating\`), las marcas (\`flags\`) y las alertas (\`alerts\`) de **todos** los perfiles que coincidieron con el email, teléfono o documento — también los de \`otherMatches\` y \`candidates\` —, sea cual sea el resultado.

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

\`profile.flags\` puede traer además \`verified_identity\` y \`verified_address\` (identidad o domicilio verificados): son buenas señales y por eso no aparecen en \`risk\`.

### Alertas (\`alerts\`)
Lo que BuenAdoptante calcula de la actividad de la persona. Cada alerta trae \`type\`, \`count\` y \`periodDays\`:

| \`type\` | Qué significa |
|---|---|
| \`too_many_requests\` | Pidió adoptar en muchos rescates **distintos** en poco tiempo: \`count\` rescates en \`periodDays\` días (varias solicitudes a un mismo rescate cuentan una vez). |
| \`too_many_adoptions\` | Adoptó muchos animales en poco tiempo: \`count\` adopciones en \`periodDays\` días. |

\`profile.alerts\` son las de esa persona; \`risk.alerts\` junta las de **todos** los perfiles que coincidieron, cada una con su \`profileId\`. Si no pudimos leer las calificaciones, la respuesta es \`503 temporarily_unavailable\` y no se guarda nada: nunca te respondemos «sin calificar» por un error nuestro.

## Adjuntar el contrato firmado: \`POST /api/v1/activities/{activityId}/contract\`
Después de registrar una adopción o tránsito, mandá el contrato firmado: el cuerpo de la llamada **es el archivo** (PDF, PNG o JPG, hasta 5 MB) con su \`Content-Type\`. Lo guardamos de forma privada: en el perfil aparece "Ver contrato firmado" para tu rescate y los administradores. Un contrato no se reemplaza; si te equivocaste, anulá la actividad y registrala de nuevo.

${fence(`curl -X POST ${origin}/api/v1/activities/{activityId}/contract ${B}\n  -H "Authorization: Bearer ${key}" -H "Content-Type: application/pdf" ${B}\n  --data-binary @contrato-firmado.pdf`)}

## Anular una actividad: \`POST /api/v1/activities/{activityId}/void\`
Solo actividades guardadas por tu propia clave. Se quitan también las respuestas del formulario y los datos de contacto que esa llamada agregó, y su \`externalId\` queda libre.

## Ver qué hizo una llamada anterior
¿Se cortó tu script y no sabés si la adopción se guardó? Pedí lo que hizo esa llamada (solo las de tu clave):
- por su \`requestId\` (viene en cada respuesta y en el header \`x-request-id\`):
${get('/api/v1/requests/{requestId}')}
- o por tu \`externalId\`:
${get('/api/v1/requests?externalId=mi-formulario-1234')}

La respuesta trae el estado de esa llamada, el \`activityId\` que guardó, si fue anulada y la respuesta que recibió (durante 90 días).

## Probar sin guardar: header \`X-Dry-Run: 1\` (solo staging)
Mientras armás tu integración, agregá \`X-Dry-Run: 1\` a una búsqueda exacta: responde lo mismo (\`match\`, \`profile\`, \`risk\`…) y en \`saved.action\` dice **lo que haría** (\`created_profile\`, \`added_to_profile\`…), con \`saved.dryRun: true\`, pero **no guarda nada**: ni actividad, ni perfil, ni datos de contacto, ni avisos.

- **Funciona solo en staging, con una clave \`ba_test_…\`.**
- **En producción no funciona**: con cualquier clave, la llamada se rechaza con \`403 dry_run_not_allowed\` (no se guarda nada, tampoco). En producción cada búsqueda exacta queda registrada; para buscar sin registrar, usá \`fuzzy\`.
- No vale para anular una actividad ni para adjuntar un contrato.

## Cupos
Cada clave tiene un cupo diario de búsquedas exactas y otro de fuzzy, que se reinician a las 00:00 UTC. Solo cuentan las búsquedas que se hicieron: una llamada rechazada (4xx) o un reintento que devuelve la respuesta original no cuentan. **Cada respuesta de búsqueda trae lo que te queda**: \`RateLimit-Limit\`, \`RateLimit-Remaining\` y \`RateLimit-Reset\` (segundos hasta que se reinicia). Al llegar al cupo: \`429 daily_cap_reached\` con \`Retry-After\`. Además hay un techo de llamadas de cualquier tipo por día (\`429 daily_call_ceiling_reached\`), para cortar un programa que quedó en un bucle. \`GET /api/v1/me\` muestra los dos.

## Errores
Toda respuesta de error trae \`error.code\` (estable: tu código puede decidir según él), \`error.message\` (en inglés, para vos), \`error.docUrl\` (esta sección), y cuando aplica \`error.field\` (el campo con el problema) y \`error.details\` (**todos** los problemas que encontramos, no solo el primero). Los conflictos (\`409\`) traen además \`originalRequestId\`, \`activityId\` y \`profileId\` de lo que ya se guardó.

| \`code\` | Qué pasó | Qué hacer |
|---|---|---|
| \`invalid_json\` | El cuerpo no es JSON válido. | Revisá comillas y comas. |
| \`invalid_request\` | Un campo no tiene el formato esperado. | Mirá \`error.details\`: cada problema con su campo. |
| \`unauthorized\` | Falta la clave, está mal escrita, es de otro ambiente, o no existe o fue revocada. | El mensaje dice cuál. |
| \`access_blocked\` | La persona dueña de la clave fue bloqueada de la API. | Escribinos si creés que es un error. |
| \`access_not_approved\` | El acceso a la API de la persona dueña de la clave no está aprobado. | Pedí acceso en /developers. |
| \`forbidden\` | La clave no tiene el permiso para eso. | Pedile a BuenAdoptante el permiso (\`search\`, \`search:fuzzy\`, \`record:write\`). |
| \`not_found\` | Ese id no existe para tu clave. | Revisá el id. |
| \`exact_requires_name_and_identifier\` | \`exact\` necesita nombre y apellido más email, teléfono o documento. | Completá los datos, o usá \`fuzzy\`. |
| \`full_name_required\` | \`fullName\` no tiene nombre y apellido. | Mandá el nombre completo. |
| \`invalid_email\` | El email no se puede leer. | Corregilo o no lo mandes. |
| \`invalid_phone\` | El teléfono no se puede leer. | Corregilo o no lo mandes. |
| \`invalid_document_id\` | El documento no se puede leer (mínimo 5 caracteres, 4 dígitos). | Corregilo o no lo mandes. |
| \`fuzzy_requires_a_field\` | Una búsqueda fuzzy sin ningún dato. | Mandá al menos un dato de la persona. |
| \`activity_required\` | Una búsqueda exacta sin \`activity\`: \`exact\` siempre registra. | Mandá \`activity\`; para solo buscar, usá \`mode: "fuzzy"\`. |
| \`external_id_required\` | Falta \`activity.externalId\`. | Mandá tu id de ese registro. |
| \`activity_requires_exact\` | \`activity\` en una búsqueda fuzzy (fuzzy no registra). | Sacala, o usá \`exact\`. |
| \`form_content_requires_adoption_request\` | \`formContent\` en otro tipo de actividad. | Solo va en \`adoption_request\`. |
| \`species_required\` | Una adopción o tránsito sin especie. | Mandá \`species\`. |
| \`animal_details_require_placement\` | Datos del animal (edad, sexo…) en otro tipo de actividad. | Solo van en \`adoption\` o \`foster\`. |
| \`invalid_age\` | \`age\` y \`birthDate\` juntos, o un nacimiento posterior a la fecha. | Mandá uno de los dos, bien. |
| \`example_data\` | En producción, una persona de los ejemplos de esta documentación. | Mandá una persona real; los ejemplos se prueban en staging. |
| \`contract_not_allowed\` | Contrato sobre algo que no es una adopción o tránsito de tu clave. | Usá el \`activityId\` de una adopción o tránsito. |
| \`contract_exists\` | Esa actividad ya tiene contrato. | Anulala y registrala de nuevo. |
| \`unsupported_media_type\` | El archivo no es PDF, PNG ni JPG (o no coincide con su \`Content-Type\`). | Mandá el archivo correcto. |
| \`payload_too_large\` | El cuerpo pasa el tamaño máximo. | Achicalo (contratos: 5 MB; resto: 64 KB). |
| \`dry_run_not_allowed\` | \`X-Dry-Run\` en producción, al anular o al adjuntar un contrato. | Probá en staging, con una búsqueda. |
| \`external_id_reused\` | Ese \`externalId\` ya se guardó con otro contenido. | Usá otro \`externalId\`, o anulá \`error.activityId\` primero. |
| \`external_id_expired\` | Ese \`externalId\` se guardó hace más de 90 días. | Usá uno nuevo. |
| \`request_in_progress\` | La misma llamada todavía se está procesando. | Reintentá en unos segundos (\`Retry-After\`). |
| \`partially_saved\` | Una llamada anterior con ese \`externalId\` se cortó a mitad. | Anulá \`error.activityId\` (o avisá a un admin) y reenviá. |
| \`record_changed\` | Al anular: el animal se volvió a entregar después. | Avisá a un admin. |
| \`daily_cap_reached\` | Llegaste al cupo de búsquedas del día. | Esperá al reinicio (\`Retry-After\`); \`RateLimit-Remaining\` te avisa antes. |
| \`daily_call_ceiling_reached\` | Demasiadas llamadas de cualquier tipo hoy. | Revisá que tu programa no esté en un bucle. |
| \`temporarily_unavailable\` | No pudimos leer las calificaciones; no se guardó nada. | Reintentá (\`Retry-After\`). |
| \`api_disabled\` | La API no está habilitada en este ambiente. | Consultá a BuenAdoptante. |
| \`server_error\` | Un error nuestro. | Reintentá; si sigue, avisanos con \`error.errorId\`. |

## Cambios y versiones
Esta es la versión 1 (\`/api/v1\`). **Sin aviso** pueden aparecer campos nuevos en las respuestas y valores nuevos en las listas (\`code\`, \`saved.action\`, \`flags\`, \`alerts\`…): tu código tiene que tolerarlos. Un cambio que rompa algo existente va a \`/api/v2\`, con aviso previo. La documentación usa el español para explicar y el inglés para los nombres de campos y los mensajes de error, a propósito: los nombres no cambian con el idioma.
`.trim();
}

const json = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/**
 * The exact scenarios as this environment shows them: on staging every call is
 * a dry run (X-Dry-Run: 1), so the answer shown is the dry-run answer — the
 * same, with `saved.action` = what it would do and no ids. In production, the
 * real answer.
 */
export function shownScenarios(origin: string, cfg: AlertConfig = DEFAULT_ALERT_CONFIG): Array<Scenario & { dryRunCall: boolean }> {
    const live = environmentForHost(new URL(origin).host) === 'live';
    return exactScenarios(origin, new Date(), cfg).map(sc => {
        const dryRunCall = sc.dryRun || !live;
        const saved = sc.response.saved as { action: string };
        return { ...sc, dryRunCall, response: dryRunCall ? { ...sc.response, saved: { action: saved.action, dryRun: true } } : sc.response };
    });
}

/** The examples part of the guide: request examples, then every exact-search scenario written out. */
export function examplesGuide(origin: string, cfg: AlertConfig = DEFAULT_ALERT_CONFIG): string {
    const live = environmentForHost(new URL(origin).host) === 'live';
    const curl = (body: unknown, dryRun: boolean) => [
        `curl -X POST ${origin}/api/v1/search \\`,
        `  -H "Authorization: Bearer ${live ? 'ba_live_…' : 'ba_test_…'}" \\`,
        '  -H "Content-Type: application/json" \\',
        ...(dryRun ? ['  -H "X-Dry-Run: 1" \\'] : []),
        `  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`,
    ].join('\n');
    const fence = (lang: string, text: string) => `\`\`\`${lang}\n${text}\n\`\`\``;
    const req = REQUEST_EXAMPLES as Record<string, { summary: string; value: { mode: string } }>;
    return [
        '## Ejemplos de pedidos',
        live
            ? 'Llamadas completas, listas para copiar (cambiá la clave y los datos: en producción los datos de estos ejemplos se rechazan, \`422 example_data\`).'
            : 'Llamadas completas, listas para copiar. En staging llevan \`X-Dry-Run: 1\`: responden igual que una llamada real y no guardan nada. Sacalo para guardar de verdad.',
        ...Object.values(req).map(e => `### ${e.summary}\n${fence('bash', curl(e.value, !live && e.value.mode === 'exact'))}`),
        '## Búsqueda exacta: qué pedido da cada respuesta',
        'Cada escenario muestra qué hay registrado en BuenAdoptante, la llamada exacta que hacés y la respuesta que recibís. ' +
        'Mirá siempre \`risk\`: es la peor señal de **todos** los perfiles que coincidieron con el email, teléfono o documento.',
        ...(live ? [] : [
            '**En staging estas personas existen**, así que cada llamada devuelve exactamente la respuesta de su escenario. ' +
            'Las llamadas llevan \`X-Dry-Run: 1\`: \`saved.action\` dice lo que haría y no se guarda nada, así podés repetirlas. ' +
            'Sin ese header la llamada se guarda: \`saved\` trae además \`activityId\` y los links, y la persona ya no queda como en esta página. ' +
            'Un admin las vuelve a dejar como estaban desde Admin → API → «Personas de ejemplo».',
        ]),
        ...shownScenarios(origin, cfg).map((sc, i) => [
            `### ${i + 1}. ${sc.title}`,
            `**Qué hay registrado:** ${sc.registered}`,
            '**Llamada**',
            fence('bash', curl(sc.request, sc.dryRunCall)),
            '**Respuesta** (\`200\`)',
            json(sc.response),
            `**Por qué:** ${sc.why}`,
        ].join('\n\n')),
    ].join('\n\n');
}

/** `cfg`: this environment's "too many" thresholds, so the documented answers are the ones it gives. */
export function buildOpenApi(origin: string, cfg: AlertConfig = DEFAULT_ALERT_CONFIG) {
    const live = environmentForHost(new URL(origin).host) === 'live';
    const scenarios = shownScenarios(origin, cfg);
    const error = { description: 'Error', content: { 'application/json': { schema: schema(errorResponseSchema) } } };
    const errors = {
        '400': { ...error, description: 'Invalid JSON' },
        '401': { ...error, description: 'No key, a malformed header, a key of the other environment, or an unknown / revoked key (the message says which)' },
        '403': { ...error, description: 'The key lacks a scope, or X-Dry-Run was sent in production (dry_run_not_allowed)' },
        '404': { ...error, description: 'Not found, or the API is disabled' },
        '409': { ...error, description: 'external_id_reused / external_id_expired / request_in_progress / partially_saved — with originalRequestId, activityId, profileId' },
        // error.code is one of the enum in the error schema; clients should also tolerate codes added later.
        '422': { ...error, description: 'Validation failed: error.code, error.field and every problem in error.details' },
        '429': { ...error, description: 'daily_cap_reached or daily_call_ceiling_reached (see Retry-After)' },
        '500': { ...error, description: 'Server error (quote error.errorId)' },
        '503': { ...error, description: 'temporarily_unavailable: the ratings could not be read; nothing was saved (see Retry-After)' },
    };
    return {
        openapi: '3.1.0',
        info: { title: 'BuenAdoptante API', version: '1.0.0', description: `${guide(origin, live)}\n\n${examplesGuide(origin, cfg)}` },
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
                        name: 'X-Dry-Run', in: 'header', required: false,
                        description: 'STAGING ONLY, with a ba_test_ key: `1` answers the same, with saved.action = what it WOULD do and saved.dryRun = true, and saves nothing. In production it is refused with 403 dry_run_not_allowed, for every key.',
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
                            description: 'exact → match (found / not_found / ambiguous) + saved.action; fuzzy → ranked results. Headers: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset.',
                            content: { 'application/json': { schema: { oneOf: [schema(exactResponseSchema), schema(fuzzyResponseSchema)] }, examples: Object.fromEntries(scenarios.map((sc, i) => [`scenario_${sc.key}`, { summary: `Escenario ${i + 1}: ${sc.title}`, value: sc.response }])) } },
                        },
                        ...errors,
                    },
                },
            },
            '/api/v1/requests/{requestId}': {
                get: {
                    summary: 'Ver qué hizo una llamada anterior de esta clave',
                    operationId: 'pastCall',
                    parameters: [{ name: 'requestId', in: 'path', required: true, schema: { type: 'string' }, description: 'The requestId of that call (in its answer and its x-request-id header)' }],
                    responses: { '200': { description: 'OK', content: { 'application/json': { schema: schema(pastCallResponseSchema) } } }, '401': errors['401'], '404': errors['404'] },
                },
            },
            '/api/v1/requests': {
                get: {
                    summary: 'Ver qué guardó una llamada, por tu externalId',
                    operationId: 'pastCallByExternalId',
                    parameters: [{ name: 'externalId', in: 'query', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'OK', content: { 'application/json': { schema: schema(pastCallResponseSchema) } } }, '401': errors['401'], '404': errors['404'], '422': errors['422'] },
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
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '`saved.activityId` of an adoption / foster this key saved' }],
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
                    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '`saved.activityId` from the search response' }],
                    responses: {
                        '200': { description: 'Voided', content: { 'application/json': { schema: schema(voidResponseSchema) } } },
                        '401': errors['401'], '403': errors['403'], '404': errors['404'],
                    },
                },
            },
        },
    };
}
