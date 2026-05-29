# Rating labels + click-to-explain popover

## Context

Hoy las ratings se muestran como estrellas (`StarRating`) o como pill numérica (`RatingBadge`) sin texto que diga *qué significa* el número. El usuario tiene que recordar que 1=peligroso y 5=excelente. En los resultados de búsqueda — donde el rating es la información más importante para tomar la decisión de entregar (o no) un animal — la falta de label es especialmente costosa: usuarios nuevos no saben si "⭐ 2.0" es bueno o malo.

Este plan agrega:
1. **Etiqueta corta** ("Peligroso", "Riesgoso", "Regular", "Bueno", "Excelente") en **todos** los sitios de visualización y edición.
2. **Etiqueta larga** ("Adoptante Peligroso", "Buen Adoptante", …) **sólo** en cards de resultado de búsqueda.
3. **Popover de explicación** que se abre al clickear el rating en resultados de búsqueda — muestra los 5 niveles con su color y texto explicativo, con el nivel actual resaltado. Pensado como herramienta educativa para entender la escala completa.
4. Renombrar el nivel 3: `Promedio` → `Regular` (ES), `Average` → `Fair` (EN).

No agregamos un campo de rating editable a nivel del adoptante — el promedio sigue calculándose desde las interacciones registradas (`computeAvgRating` en `src/domain/ratings.ts`).

## Decisiones de scope (confirmadas con el usuario)

- **Etiqueta larga** sólo en search results (cards). Listados densos (my-adopters, my-adoptions, AdoptionHistory, admin) usan etiqueta corta.
- **Popover** muestra los 5 niveles, con el actual resaltado.
- **Nivel 3**: ES `Regular` + EN `Fair`.

## Cambios

### 1. Centralizar metadata de rating

**Archivo:** `src/domain/ratings.ts` (extender)

Agregar:
```ts
export const RATING_LEVELS = [1, 2, 3, 4, 5] as const;
export type RatingLevel = typeof RATING_LEVELS[number];

export const RATING_LABEL_KEYS: Record<RatingLevel, string> = {
  1: 'dangerous',
  2: 'poor',
  3: 'average',
  4: 'good',
  5: 'excellent',
};

export function getRatingLabelKey(rating: number): string {
  const r = Math.max(1, Math.min(5, Math.round(rating))) as RatingLevel;
  return RATING_LABEL_KEYS[r];
}
```

Eliminar la duplicación de este mapping que existe hoy en:
- `src/components/StarRating.tsx:29-35`
- `src/lib/ratingColors.ts:18-28` (`getRatingDescription`) — re-exportar desde `ratings.ts` o reemplazar usos.

### 2. i18n: nuevas keys y rename de nivel 3

**Archivos:** `src/i18n/locales/es.ts:542-554` y `src/i18n/locales/en.ts:543-555`

Bajo el namespace `ratings`:

```ts
// ES
ratings: {
  // Etiquetas cortas (existentes — solo cambia 'average')
  dangerous: 'Peligroso',
  poor: 'Riesgoso',
  average: 'Regular',          // ← cambia de 'Promedio'
  good: 'Bueno',
  excellent: 'Excelente',
  // Nuevo: etiqueta larga para cards de búsqueda
  search_label: {
    dangerous: 'Adoptante Peligroso',
    poor: 'Adoptante Riesgoso',
    average: 'Adoptante Regular',
    good: 'Buen Adoptante',
    excellent: 'Excelente Adoptante',
  },
  // Nuevo: explicación para popover
  explanation: {
    dangerous: 'No se recomienda entregarle animales en adopción.',
    poor: 'Solo entregar animales en adopción bajo estricta evaluación y seguimiento.',
    average: 'Solo entregar animales en adopción con la adecuada evaluación y seguimiento.',
    good: 'Solo entregar animales en adopción con la adecuada evaluación y seguimiento.',
    excellent: 'Se recomienda como adoptante.',
  },
  // Título del popover
  scale_title: 'Escala de calificación',
}
```

```ts
// EN — equivalentes (cambia 'average')
ratings: {
  dangerous: 'Dangerous',
  poor: 'Risky',
  average: 'Fair',             // ← cambia de 'Average'
  good: 'Good',
  excellent: 'Excellent',
  search_label: {
    dangerous: 'Dangerous Adopter',
    poor: 'Risky Adopter',
    average: 'Fair Adopter',
    good: 'Good Adopter',
    excellent: 'Excellent Adopter',
  },
  explanation: {
    dangerous: 'Do not place animals with this adopter.',
    poor: 'Only place animals under strict evaluation and follow-up.',
    average: 'Place animals only with proper evaluation and follow-up.',
    good: 'Place animals only with proper evaluation and follow-up.',
    excellent: 'Recommended adopter.',
  },
  scale_title: 'Rating scale',
}
```

**Verificar antes:** `grep -r "ratings.average\|Promedio" src/` para asegurar que ningún test e2e dependa de la string actual. Si alguno la usa, actualizar en el mismo commit (ver memoria `feedback_grep_tests_before_deletion.md`).

### 3. Extender `RatingBadge` con prop `label`

**Archivo:** `src/components/RatingBadge.tsx`

```ts
interface RatingBadgeProps {
  rating: number | string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'badge' | 'inline';
  label?: 'none' | 'short' | 'search';  // ← nuevo
}
```

- `'none'` (default) — comportamiento actual, no rompe nada.
- `'short'` — agrega texto corto (ej. "Bueno") al lado del número, usando `t(\`ratings.${getRatingLabelKey(numRating)}\`)`.
- `'search'` — usa `t(\`ratings.search_label.${getRatingLabelKey(numRating)}\`)` — etiqueta larga.

Cuando `variant='inline'` + `label='short'`: `⭐ 4.0 Bueno` con la misma clase de color.
Cuando `variant='badge'` + `label='search'`: pill muestra "⭐ 4.0 · Buen Adoptante" — ancho aumenta, ok porque las cards de búsqueda tienen espacio.

### 4. Pasar `showLabel` a los 4 sitios de edición de `StarRating`

`StarRating` ya tiene `showLabel` implementado (`src/components/StarRating.tsx:69-73`). Solo activarlo en los 4 sitios:

| File:line | Acción |
|---|---|
| `src/components/AdoptionFormWizard.tsx:440` | `<StarRating ... showLabel />` |
| `src/components/AdoptionFormEditV2.tsx:683` | `<StarRating ... showLabel />` y **eliminar** la línea siguiente "1=Dangerous, 5=Excellent" (queda redundante) |
| `src/components/ReportWizard.tsx:351` | `<StarRating ... showLabel />` |
| `src/components/ImportWizard.tsx:1295` | `<StarRating ... showLabel />` |

Revisar si hay un `<label>` externo que ya diga lo mismo y eliminarlo para evitar duplicación.

### 5. Nuevo componente `RatingExplainer` (popover)

**Archivo nuevo:** `src/components/RatingExplainer.tsx`

Wrapper clickeable que envuelve cualquier hijo (típicamente un `RatingBadge`). Al click abre un popover anclado al trigger:

- **Trigger**: el `children` (el badge), envuelto en un `<button>` con `aria-label={t('ratings.scale_title')}`.
- **Popover**: lista los 5 niveles. Cada fila: estrella(s) llenas + label corto + explicación. Fila del rating actual con `ring-2` del color correspondiente. Cierra con click fuera + tecla Escape.
- **Mobile**: el popover se monta como bottom-sheet (`fixed inset-x-0 bottom-0 sm:absolute sm:inset-auto sm:mt-2`) — mismo patrón que la `NotificationBell` de Phase 1 del plan mobile remediation, ya validado.
- **z-index**: dentro del rango definido por `docs/design-style-guide.md` para overlays (typically z-50).

Reusa `getRatingColors()` (`src/lib/ratingColors.ts`) para colores y `RATING_LEVELS` + i18n para textos. Sin dependencias nuevas.

### 6. Aplicar a sitios de visualización

**Solo en search results — wrap con `RatingExplainer` y `label="search"`:**

| File:line | Cambio |
|---|---|
| `src/components/SearchSection.tsx:419` | `<RatingExplainer><RatingBadge rating={avgRating} label="search" /></RatingExplainer>` |
| `src/components/ReportWizard.tsx:192` | idem |
| `src/components/ReportWizard.tsx:288` | idem |
| `src/components/AdoptionWizard.tsx:370` | idem |
| `src/components/AdoptionWizard.tsx:466` | idem |

**En listados — solo `label="short"` (sin wrapper):**

| File:line | Cambio |
|---|---|
| `src/app/my-adopters/page.tsx:315` | agregar `label="short"` |
| `src/app/my-adopters/page.tsx:382` | idem |
| `src/components/AdminAdopterList.tsx:221` | idem |
| `src/app/my-adoptions/page.tsx:261` | idem |
| `src/app/my-adoptions/page.tsx:315` | idem |
| `src/components/AdoptionHistory.tsx:220` | idem |

`src/app/demo-profile/page.tsx:116` — ratings hardcodeadas, también pasar `label="short"` para que el demo muestre la nueva UX.

## Archivos a modificar

**Lógica / componentes:**
- `src/domain/ratings.ts` — agregar `RATING_LEVELS`, `RATING_LABEL_KEYS`, `getRatingLabelKey`
- `src/components/RatingBadge.tsx` — nuevo prop `label`
- `src/components/StarRating.tsx` — eliminar duplicación del label map (usar el de `ratings.ts`)
- `src/lib/ratingColors.ts` — reemplazar `getRatingDescription` por re-export desde `ratings.ts`
- `src/components/RatingExplainer.tsx` — **nuevo**

**i18n:**
- `src/i18n/locales/es.ts`
- `src/i18n/locales/en.ts`

**Edit sites (1 línea cada uno):**
- `src/components/AdoptionFormWizard.tsx`
- `src/components/AdoptionFormEditV2.tsx` (también borrar helper text redundante)
- `src/components/ReportWizard.tsx`
- `src/components/ImportWizard.tsx`

**View sites (1 línea o wrap cada uno):**
- `src/components/SearchSection.tsx`
- `src/components/ReportWizard.tsx` (2 instancias)
- `src/components/AdoptionWizard.tsx` (2 instancias)
- `src/app/my-adopters/page.tsx` (2 instancias)
- `src/app/my-adoptions/page.tsx` (2 instancias)
- `src/components/AdminAdopterList.tsx`
- `src/components/AdoptionHistory.tsx`
- `src/app/demo-profile/page.tsx`

## Reglas del proyecto a respetar

- **i18n**: actualizar **ambos** locales (`es.ts` + `en.ts`) en el mismo commit. Default es `es` — keys faltantes se ven crudas (`ratings.search_label.good`).
- **Tests**: `grep` por strings actuales en `tests/` antes de modificar i18n. Ver memoria `feedback_grep_tests_before_deletion.md`.
- **Theming**: rojo/naranja/amber/lime/verde no están remapeados en Azul Noche (memoria `project_theming.md`). Phase 2 del plan mobile incluye remaps — coordinarse: si este trabajo va antes, el popover en dark mode tendrá contraste pobre. Aceptable temporalmente.
- **Logging**: el popover no hace requests, no necesita logger.
- **Domain layer**: `RATING_LEVELS` y `getRatingLabelKey` viven en `src/domain/ratings.ts` — pure functions, sin imports de DB ni de server (cumple la regla del CLAUDE.md).

## Versión y deploy

- Bump: `2.12.5 → 2.12.6` (no breaking, mejora UX).
- Commit: `v2.12.6: rating labels + click-to-explain popover`.
- Push directo a `staging` — pipeline corre type-check, lint (ratchet 122), e2e, deploy a `staging.verazadoptantes2.pages.dev`.

## Verificación end-to-end

1. **Type check**: `npx tsc --noEmit` → sin errores.
2. **Lint ratchet**: `npm run lint` → no superar 122 warnings.
3. **i18n manual** (ES default): ir a `/` logueado, hacer una búsqueda → cards muestran "Buen Adoptante" debajo del número, no la key cruda `ratings.search_label.good`.
4. **i18n EN**: cambiar idioma a English → mismas cards muestran "Good Adopter".
5. **Popover (desktop)**: click sobre rating en card de búsqueda → popover muestra los 5 niveles con la fila del rating actual resaltada con `ring-2`. Click fuera o Escape lo cierran.
6. **Popover (mobile)**: 375px viewport → popover aparece como bottom-sheet desde `bottom-0`, no se sale del viewport.
7. **Listados**: ir a `/my-adopters` y `/my-adoptions` → cada fila muestra rating + etiqueta corta ("Bueno") sin popover (no clickeable).
8. **Edición**: abrir wizard de adopción → al lado de las estrellas aparece el label corto del nivel seleccionado, cambia en tiempo real al clickear estrellas.
9. **Editor existente** (`AdoptionFormEditV2`): el helper text "1=Dangerous, 5=Excellent" ya no está (reemplazado por el showLabel inline).
10. **Theming**: cambiar a Azul Noche → verificar contraste del popover (esperado: bajo, será fix de Phase 2 mobile remediation).
11. **Playwright**: `npx playwright test` → todos los tests pasan, especialmente los que renderean el rating.
12. **Pipeline**: `gh run list --branch staging --workflow ci.yml --limit 1` → verde.
