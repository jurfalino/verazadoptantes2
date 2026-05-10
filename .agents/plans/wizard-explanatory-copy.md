# Wizard explanatory copy — record type + rating-aware

## Context

Today, when the adopter-profile activity wizard (`AdoptionFormWizard`) opens with a preselected record type (via VisitIntentCard), step 1 shows a small badge: `[icon] Solicitud`. Functional but flat — it doesn't tell the rescuer *what they should do* with this person, given what we know about them.

This change replaces that badge with explanatory copy that varies by:
1. **Record type** (5 types: adoption, adoption_request, observation, follow_up, returned_pet)
2. For `adoption` and `adoption_request`: the **adopter's average rating bucket** (`null` / 1 / 2 / 3 / 4-5)

Rating-1 / Rating-2 cases get strong warnings; rating 4-5 gets a calmer "good references — still recommend a contract"; null (new adopter) gets a "no history yet, your record will be the first" framing.

The wizard is mounted only on the profile page (in `AdopterProfileV2` and `VisitIntentCard`), so `avgRating` is in scope and "scroll to history below" works as a real DOM anchor.

## Scope boundaries

- **Edit form (`AdoptionFormEditV2`) is NOT touched.** Edits keep the small chip — explanatory copy would feel preachy for typo fixes.
- **Manual-open chip-grid path is NOT touched.** When the user lands on the wizard with no preselected type, there's no record type yet to explain.
- **The "available" record type** doesn't apply to adopter activity logs — out of scope.

## Final copy matrix (signed off)

### `adoption_request` — title: "{name} te pidió un animal en adopción."

| Bucket | Body |
|---|---|
| `null` | {name} aún no tiene calificaciones registradas en la plataforma. Antes de entregarle un animal te recomendamos hacer una entrevista detallada, pedir referencias y, si procedés, firmar un contrato de adopción. Dejá constancia de este pedido para referencia futura. |
| `1` | En base a las calificaciones registradas en su perfil, **no se recomienda entregarle animales en adopción.** Revisá el {historyLink}historial de actividad más abajo{/historyLink} para leer comentarios y contactar a quienes dejaron experiencias previas con {name}. Igualmente, dejá registrado este pedido para referencia futura. |
| `2` | Las calificaciones en su perfil indican que {name} **puede representar un riesgo** como adoptante. Revisá el {historyLink}historial más abajo{/historyLink} para más contexto y, si decidís proceder, hacé un seguimiento especialmente cuidadoso. Dejá registrado este pedido para referencia futura. |
| `3` | Las calificaciones de {name} son mixtas. Si decidís entregarle un animal, te recomendamos hacerlo con un seguimiento adecuado. Revisá el {historyLink}historial más abajo{/historyLink} para más contexto, y dejá registrado este pedido para referencia futura. |
| `4-5` | {name} tiene buenas referencias. Aun así, te recomendamos siempre firmar un contrato de adopción y hacer seguimiento. Al entrevistar a {name} podés contrastar sus respuestas con la información registrada acá — sin mencionarle que ya conocés su historial. |

### `adoption` — title: "Le diste a {name} un animal en adopción."

| Bucket | Body |
|---|---|
| `null` | Como {name} aún no tiene calificaciones previas, este registro es el primero — tu seguimiento será especialmente valioso para quienes en el futuro evalúen entregarle un animal. Compartí acá lo que observes en las próximas semanas. |
| `1` | {name} tiene calificaciones muy negativas en la plataforma. **El animal puede estar en riesgo.** Hacé seguimiento lo antes posible y compartí acá tus observaciones. |
| `2` | {name} no tiene muy buenas calificaciones como adoptante. Hacé un **seguimiento cercano** de la adopción y compartí acá tus observaciones. |
| `3` | {name} tiene calificaciones mixtas como adoptante. Hacé un seguimiento adecuado y compartí acá tus observaciones. |
| `4-5` | {name} tiene buenas referencias como adoptante. Aun así, te recomendamos hacer un seguimiento periódico y registrar acá cualquier observación que surja con el tiempo. |

### `follow_up` — title: "Voy a registrar un seguimiento de un animal que le di a {name} en adopción."
Compartí lo que observaste durante el seguimiento: condiciones de vida del animal, contacto con {name}, fotos si tenés. Estas observaciones ayudan a otras personas a evaluar a {name} con información de primera mano.

### `returned_pet` — title: "{name} te devolvió un animal que le habías dado (vos u otra persona) en adopción."
Asegurate de ser claro e imparcial al describir el hecho y las circunstancias. Esta información será visible para otros rescatistas que evalúen futuras adopciones con {name}.

### `observation` — title: "Quiero registrar una observación sobre {name}."
Ya sea positiva o negativa, asegurate de ser claro e imparcial al describir el hecho y las circunstancias. Si lo que compartís implica maltrato animal, recordá que debe estar respaldado por una **denuncia policial** según la ley aplicable en tu país.

## i18n key shape

```
wizard.guidance.adoption_request.title
wizard.guidance.adoption_request.body.none
wizard.guidance.adoption_request.body.1
wizard.guidance.adoption_request.body.2
wizard.guidance.adoption_request.body.3
wizard.guidance.adoption_request.body.4_5
wizard.guidance.adoption.title
wizard.guidance.adoption.body.{none,1,2,3,4_5}
wizard.guidance.follow_up.title
wizard.guidance.follow_up.body
wizard.guidance.returned_pet.title
wizard.guidance.returned_pet.body
wizard.guidance.observation.title
wizard.guidance.observation.body
```

Token conventions inside string values:
- `{name}` — adopter name interpolation
- `**…**` — bold span
- `{historyLink}…{/historyLink}` — clickable scroll anchor (only used in 3 strings: request body 1/2/3)

## Component shape

`src/components/RecordTypeGuidance.tsx` — `'use client'`.

Props: `recordType`, `adopterName`, `avgRating: number | null`.

Internals:
- `ratingBucket(avg) → 'none' | '1' | '2' | '3' | '4_5'`
- `needsRatingVariant(recordType) → boolean` (true for `adoption` + `adoption_request`)
- Small renderer that splits the body string on `**…**` and `{historyLink}…{/historyLink}`, returning a `React.ReactNode[]`. The history link is a `<button>` calling `document.getElementById('adoption-history')?.scrollIntoView({behavior:'smooth'})`.

Layout: title row with record-type chip on the right (uses existing `getRecordTypeColors` / `getRecordTypeIcon` from `src/lib/recordTypeColors.ts`), body paragraph below.

## Files modified

| File | Change |
|---|---|
| `src/components/RecordTypeGuidance.tsx` | NEW |
| `src/components/AdoptionFormWizard.tsx` | Add `adopterName`+`avgRating` props; replace the badge in the `initialRecordType ? …` branch (lines ~413-440) with `<RecordTypeGuidance>` |
| `src/components/AdopterProfileV2.tsx` | Pass props into the 2 mount sites |
| `src/components/VisitIntentCard.tsx` | Thread `adopterName`+`avgRating` into its wizard mount |
| `src/components/AdoptionHistory.tsx` | Ensure `id="adoption-history"` on the root section |
| `src/i18n/locales/es.ts` | Add ~15 keys |
| `src/i18n/locales/en.ts` | Same keys, EN drafts |

## Verification

Walk through each combination on staging:
1. Profile with rating 1 → all 4 wizard entry points (request/adoption/follow_up/returned_pet/observation) show the right copy. History link scrolls to timeline.
2. Profile with rating 3 → mixed-tone copy.
3. Profile with rating 5 → calm copy, no bold warnings.
4. Brand-new profile (no records) → `none` variant fires for adoption/request flows.
5. Edit existing record (timeline → ✏️) → no new copy appears, existing chip stays.
6. `npx tsc --noEmit` clean.
7. `npm run lint` no new warnings.

## Out of scope

- Inline preview of past comments / external links (the copy says "leer los comentarios" — for now this means scrolling to the timeline; an inline preview pane could be a follow-up).
- Editorial pass on EN beyond literal translation.
- Touching domain constants (RECORD_TYPES, FLAG_REASONS).
- Edit form (AdoptionFormEditV2).
