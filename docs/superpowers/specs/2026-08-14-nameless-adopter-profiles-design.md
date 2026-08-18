# Perfiles de adoptante sin nombre — Diseño

**Fecha:** 2026-08-14
**Estado:** propuesta (pendiente de revisión del usuario → writing-plans)

## Problema y motivación

Hoy el nombre del adoptante es obligatorio en **5 capas** (DB `NOT NULL`, form manual
`<input required>` + `saveAdopterSchema`, `createAdopterApiSchema.name.min(1)`, wizard
`validateMappedRow`, y `_adopterFactory` que lanza error). Sin embargo hay casos reales
de adoptantes **anónimos** identificables solo por contacto: en el import VANA-2015,
**71 de 837** entradas no tienen nombre (63 con teléfono/email/Facebook, 8 sin nada).
Esos 71 quedan bloqueados ("Falta el nombre") y se saltean.

Además, el manejo actual de nombre vacío está **fragmentado e inconsistente**: distintas
superficies muestran `—`, `"Unknown"`, el UUID crudo, omiten el link en silencio, o
dejan un hueco en blanco / frase colgada ("adoptado por ", `Move "" from…`).

## Objetivos

1. Permitir **crear y mostrar** perfiles de adoptante sin nombre, identificados por contacto.
2. Que la ausencia de nombre sea una **elección explícita** del rescatista, no un bypass fácil.
3. Un **fallback único y honesto** ("Sin nombre") en todas las superficies, distinguible de
   "adoptante borrado".
4. Garantizar **identificabilidad mínima**: ningún registro con nombre **y** contacto vacíos.

## No-objetivos

- No se toca la ruta de **auto-submisión** (formulario/contrato que llena el propio
  adoptante): ahí el nombre sigue siendo obligatorio.
- No se agrega columna nueva a la DB (un `name = ''` satisface el `NOT NULL` actual).
- No se cambia dedup/tokenización: un registro sin nombre ya se indexa y encuentra por
  sus tokens de contacto (phone/email/social/id).

## Decisiones núcleo

### 1. Regla de identificabilidad mínima
Un adoptante necesita **nombre O al menos un contacto** (entrada `phone`/`email`/`social`/`id`).
Reemplaza "nombre obligatorio". Se valida en cliente y servidor de las rutas rescatista-autoría.

### 2. Alcance (qué rutas se relajan)
- **Se relaja:** alta manual (`AdopterForm` + `saveAdopterSchema`), API `/api/adopters`
  (`createAdopterApiSchema`) e import (`validateMappedRow`).
- **Se mantiene obligatorio:** `_adopterFactory` (form/contrato del adoptante) — sin cambios.
- **DB:** sin migración.

### 3. Fallback de display unificado
- Helper puro `adopterDisplayName(adopter): string` → devuelve `name` si tiene contenido,
  si no la etiqueta i18n `adopter.nameless` = **"Sin nombre"** (es) / "No name" (en) /
  "Sem nome" (pt). Para interpolación en frases, `aria-label`, `alt`, `title`, `<title>`.
- Helper `isNamelessAdopter(adopter): boolean`.
- Componente presentacional `<AdopterName adopter={...} />` para los lugares que muestran
  el nombre como elemento propio: renderiza el nombre real, o la etiqueta con estilo
  **placeholder** — `italic` + un color **atenuado theme-safe** (el mismo token de texto
  secundario/placeholder que ya usa la app; NO un `stone-400` crudo, que no está en el
  remap `[data-theme]` y rompería el modo oscuro), mismo tamaño/peso-contexto que el
  nombre. Se lee de un vistazo como "desconocido", nunca como un nombre literal.
- **Distinción borrado vs. sin-nombre:** el fallback aplica solo cuando el adoptante
  existe (`adopterId` presente). Un join nulo (adoptante borrado) mantiene su texto
  propio ("—"/"Unknown"), separado de "Sin nombre". Corrige `admin/flags`, que hoy los
  confunde.

### 4. Fricción intencional en el alta manual (UX)
El `<input>` del nombre deja de ser `required` (HTML), pero **guardar con nombre vacío no
es silencioso**:
- Si nombre vacío **y sin contacto** → error duro inline: *"Ingresá un nombre/alias o al
  menos un dato de contacto."* (no se puede guardar).
- Si nombre vacío **y con contacto** y el usuario NO indicó desconocerlo → feedback amable
  que pide completar el nombre, con una opción explícita **"No conozco el nombre"**
  (checkbox/acción). Recién al marcarla se habilita el guardado anónimo.
- Se guarda `name = ''` (sin flag extra en DB; la marca es solo el gate de intención).

### 5. Sub-identificador de contacto en superficies solo-nombre (incluido en v1)
Donde solo aparece el nombre (título del perfil, "¿la misma persona que X?", atribuciones),
si el adoptante es anónimo **y el que mira tiene acceso** al contacto, se anexa el mejor
contacto como sub-identificador (email > teléfono > social). Si el contacto está
enmascarado para ese viewer, **no** se anexa (quedaría inútil). Helper
`namelessSubIdentifier(adopter, viewerHasAccess): string | null` que usa el mismo
resultado de enmascarado ya calculado.

## Adaptación por superficie (del audit)

**Grupo A — Nombre + contexto al lado** (contacto/rating/avatar ya identifican; solo cambiar
el slot del nombre por `<AdopterName>`; sin riesgo de layout):
`AdopterResultCard`, `my-adopters` (filas/cards), `AdminAdopterList`, `DuplicateMergeModal`
(ProfileCard), `DuplicatePeek`, `StrongMatchStrip`, `AdopterPicker` (preview+filas),
`PendingDedup`, header de `AdopterForm`. Avatares ya caen a silueta/`?` — sin cambio.

**Grupo B — Solo-nombre** (usar `adopterDisplayName` para que las frases cierren; anexar el
sub-identificador de §5 cuando corresponde; **arreglar los guards que descartan en
silencio**):
- `my-adoptions`, `my-animals`: hoy `adopterName && adopterId ? …` tira el link si el nombre
  es falsy → cambiar a depender de `adopterId` y usar el fallback.
- `admin/data-requests` (UUID crudo) y `admin/flags` ("Unknown") → unificar al fallback,
  distinguiendo borrado.
- `AdopterForm` `<h1>` título, `ApplicantDetailPanel` `<h2>`, `AnimalApplicants`
  (fila + frases de compartir), `contract-results` subtítulo, `TransferOwnershipModal`,
  `DuplicateMergeModal` (confirm + bullets), `RequestPiiAccessModal`, `DeleteAdopterButton`,
  `PiiAccessRequestPanel`.

**Grupo C — Ya tolerantes** (alinear wording al mismo "Sin nombre"):
`OrgActivityFeed` (hoy "un perfil"), `VisitIntentCard`, `RecordTypeGuidance`.

## Cambios de edición / validación

| Capa | Archivo | Cambio |
|---|---|---|
| DB | `db/schema.ts` | ninguno (`''` es válido) |
| Form manual (cliente) | `AdopterForm.tsx` | sacar `required`; gate "No conozco el nombre"; validar nombre-O-contacto en submit |
| Form manual (server) | `validation.ts` `saveAdopterSchema` | `name` opcional; refine nombre-O-contacto |
| API / import | `validation.ts` `createAdopterApiSchema` | `name.min(1)` → opcional; refine nombre-O-contacto |
| Wizard import | `domain/importRow.ts` `validateMappedRow` | error solo si faltan **nombre y** todo contacto |
| Auto-submisión | `_adopterFactory.ts` | **sin cambio** (sigue obligatorio) |

## Manejo de errores / bordes

- Violación de identificabilidad (nombre y contacto vacíos): error claro, no se persiste.
- Import: filas sin nombre pero con contacto → **válidas** (dejan de marcarse "Falta el
  nombre"); filas sin nada → siguen inválidas con mensaje "Falta nombre y contacto".
- Búsqueda: `my-animals` filtra solo por `adopterName` (un anónimo no aparece ahí) — se
  amplía el filtro para incluir también el contacto del adoptante.
- a11y: `aria-label`/`alt`/`<title>` usan `adopterDisplayName` (nunca cadena vacía).

## Testing

- **e2e**: (1) alta manual con nombre vacío → aparece el gate; sin marcar "No conozco" no
  guarda; marcándolo (con un contacto) guarda y el perfil muestra "Sin nombre". (2) alta
  con nombre y contacto vacíos → rechazada. (3) import de un CSV con filas sin nombre pero
  con contacto → válidas e importadas. (4) el perfil anónimo aparece en búsqueda por su
  email/teléfono y la tarjeta muestra "Sin nombre".
- **unit**: `adopterDisplayName` / `isNamelessAdopter` / `namelessSubIdentifier`;
  `validateMappedRow` (nombre-O-contacto); refines de los schemas Zod.

## i18n (claves nuevas, es/en/pt)

`adopter.nameless` ("Sin nombre"), `adopter.name_or_contact_required`,
`adopter.dont_know_name` ("No conozco el nombre"), `adopter.name_empty_prompt`
(feedback amable). Actualizar todas las cadenas del Grupo B que hoy asumen nombre.
