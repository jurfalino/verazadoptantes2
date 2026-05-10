# Wizard step-1 copy — flag-aware enrichment

## Context

v2.14.9 added rating-bucket-aware copy in the `RecordTypeGuidance` block (step 1 of the activity wizard). The base body string now varies for `adoption` and `adoption_request` based on the adopter's `avgRating` bucket (`none`, `1`, `2`, `3`, `4_5`).

This change adds a second axis: density-based flags. When the adopter has `tooManyAdoptions` or `tooManyRequests` (already-computed flags from the `AdopterFlags` shape, threshold-driven via `computeMaxDensityPeriod` + `adoptionConfig`), we layer additional alert copy on top of the base body.

## Decisions (all signed off)

| # | Question | Choice |
|---|---|---|
| Q1 | Layered (base + flag overlay) vs. replacement | **Layered** |
| Q2 | Surface other flags too (`inaccurate`, `systemDuplicate`, `verified_*`)? | **No** — only `tooManyAdoptions` + `tooManyRequests` for now |
| Q3 | Visual: separate card below body vs. inline paragraph | **Both, behind a feature flag** |
| Q4 | When both flags fire, render both? | **Yes**, in order: tooManyAdoptions first, then tooManyRequests |
| Q5 | Use `actualSpanDays` or `periodDays` in the copy? | **`actualSpanDays`** (tighter cluster reads more alarming) |

## Final copy (sign-off received)

The `{name}` and `{count}` / `{days}` tokens follow existing convention.

### `tooManyAdoptions` (request flow) — *they're asking AGAIN*
> Atención: {name} ya tiene {count} adopciones registradas en los últimos {days} días. Te lo dijo en la entrevista?
> Algunas veces, cuando una persona adopta demasiados animales en un corto periodo de tiempo, no es con buenas intenciones.

### `tooManyAdoptions` (adoption flow) — *already happened, focus on follow-up*
> Tené en cuenta: {name} acumuló {count} adopciones en los últimos {days} días. Te lo dijo en la entrevista?
> Algunas veces, cuando una persona adopta demasiados animales en un corto periodo de tiempo, no es con buenas intenciones.

### `tooManyRequests` (request flow) — *they're shopping around*
> {name} tiene {count} pedidos de adopción activos en los últimos {days} días. Confirmá que sigue interesado y no está pidiendo a varios rescatistas a la vez.

### `tooManyRequests` (adoption flow)
> {name} tiene {count} pedidos de adopción activos en los últimos {days} días.
> Algunas veces, cuando una persona adopta demasiados animales en un corto periodo de tiempo, no es con buenas intenciones.

## Feature flag

`WIZARD_ALERTS_AS_CARD` — admin-toggleable, default `true`.

- **`true` (card layout)**: each fired alert renders as its own card below the base body. Warning amber/orange styling, distinct visual emphasis.
- **`false` (inline layout)**: the alert text(s) are appended to the body as additional paragraphs inside the same card. No separate styling — flows as continuation of the rating-based message.

Standard 4-place plumbing per CLAUDE.md:
- `src/config/features.ts`
- `src/app/api/admin/config/route.ts`
- `src/app/admin/config/page.tsx`
- `src/i18n/locales/{es,en}.ts` (label + desc)

## Data flow

```
src/app/adopter/[id]/page.tsx (SSR)
  ├─ getFeatureFlag('WIZARD_ALERTS_AS_CARD')  → boolean
  └─ adoptions[], adoptionConfig already in scope
        ↓ pass as props
AdopterProfileV2
  ├─ computeMaxDensityPeriod(adoptions, 'adoption')   → adoptionsDensity
  ├─ computeMaxDensityPeriod(adoptions, 'adoption_request') → requestsDensity
  └─ Build tooManyAdoptions + tooManyRequests objects (or null) when over threshold
        ↓ pass as props (also pass wizardAlertsAsCard)
VisitIntentCard
        ↓ forwards props
AdoptionFormWizard
        ↓ forwards props (only when initialRecordType is set, i.e. step 1 with guidance card)
RecordTypeGuidance
  ├─ If recordType is adoption|adoption_request:
  │   ├─ Render base body (existing rating-bucket copy)
  │   ├─ If tooManyAdoptions: render alert (in chosen layout)
  │   └─ If tooManyRequests:  render alert (in chosen layout)
  └─ Other record types: unchanged
```

The density computation has to live somewhere with access to the full `adoptions` list. `AdopterProfileV2` already has it; `AdopterForm` already does the same `computeMaxDensityPeriod` call. We mirror that pattern in `AdopterProfileV2` (one new `useMemo` block).

## Files modified

| File | Change |
|---|---|
| `src/config/features.ts` | + `WIZARD_ALERTS_AS_CARD: true` |
| `src/app/api/admin/config/route.ts` | + key in GET response |
| `src/app/admin/config/page.tsx` | + flag in UI list + state |
| `src/i18n/locales/es.ts` | + 4 alert keys + 2 admin labels |
| `src/i18n/locales/en.ts` | same |
| `src/components/RecordTypeGuidance.tsx` | accept `tooManyAdoptions`, `tooManyRequests`, `alertLayout` props; render alerts |
| `src/components/AdoptionFormWizard.tsx` | accept + forward those props |
| `src/components/VisitIntentCard.tsx` | accept + forward those props |
| `src/components/AdopterProfileV2.tsx` | compute densities, forward props down to wizard mounts |
| `src/app/adopter/[id]/page.tsx` | fetch the feature flag, pass to AdopterProfileV2 |

## Out of scope

- Other flags (`inaccurate`, `systemDuplicate`, `verified_*`) — explicit Q2 = no.
- Edit form (`AdoptionFormEditV2`) — the copy block is creation-only per the v2.14.9 plan.
- Changing the existing density computation thresholds (`adoptionConfig.threshold` / `.requestsThreshold` / `.periodDays` / `.requestsPeriodDays`) — those stay admin-tunable in `/admin/config` as today.

## Verification

1. Profile with `tooManyAdoptions` only — both flows render the adoption-flavored alert.
2. Profile with `tooManyRequests` only — same for that flag.
3. Profile with both — both alerts render, adoption first, requests second.
4. Profile with neither — no alerts; only the base body (current v2.14.9 behavior).
5. Toggle `WIZARD_ALERTS_AS_CARD` in `/admin/config` — alerts switch from card layout to inline appended paragraphs without a refresh of the wizard's parent state.
6. `npx tsc --noEmit` clean.
