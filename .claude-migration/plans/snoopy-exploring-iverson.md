# Per-animal applicant evaluation: in-place deep-dive panel on /my-animals

## Context

Today on `/my-animals`, each animal card has a "👥 N personas interesadas" disclosure (`src/components/AnimalApplicants.tsx`) listing the people who completed the public adoption form for that animal. Each row shows `name • ★ rating • date • [Enviar contrato]`. That's enough to *act* on a name the rescuer already trusts — but the actual decision ("which of these 3 people should get the contract?") requires comparing two things that live on two separate pages:

1. The **adopter profile** (`/adopter/[id]`) — rating breakdown, flags, prior adoption / request / observation history.
2. The **form answers** (`/form-results/[submissionId]`) — intent (self vs gift), household composition, species preferences, hours alone, safety details, household items, full Q&A.

Right now the rescuer ping-pongs between tabs: open profile A in a new tab, open form A in another, scan, repeat for B, repeat for C, then come back to /my-animals to click "Enviar contrato" on the chosen one. This is *the* friction blocker on the entire applicants flow — the contract step itself is one click, but the decision step is unsupported.

User-approved design decisions:
- **Comparison mental model**: deep dive, one applicant at a time, with Prev/Next navigation inside the panel to cycle without losing context.
- **Row density**: each disclosure row gets a flag-count badge + 1-line form-summary so obvious decisions can be made without ever opening the panel.

## Reused infrastructure (do not rebuild)

- `<RatingBadge>` + `<RatingExplainer>` — `src/components/RatingBadge.tsx`, `src/components/RatingExplainer.tsx`. Same pattern used on `/my-adopters` (v29) and homepage search results.
- `<FlagBadges>` rendering convention — `src/app/my-adopters/page.tsx:63-114`. Themed pill list with whitespace-nowrap, used for `inaccurate / duplicate / verified_identity / tooManyAdoptions / tooManyRequests`.
- `<DuplicatePeek>`'s side-panel chrome — `src/components/DuplicatePeek.tsx:144-238`. Fixed-inset overlay + slide-in panel (right on desktop `md:w-[28rem]`, bottom sheet on mobile), sticky header with close button, z-[60] over the nav. Pattern is general; copy it directly.
- `<FormAnswersPanel>` — `src/components/FormAnswersPanel.tsx`. Already parses `answersJson` into a structured display. The new panel embeds it.
- `<MiniShareModal>` — already in `AnimalApplicants.tsx:45-145`. Renders the contract-share URL options (Copy / WhatsApp / Email / Open). Reused unchanged by the new panel's "Enviar contrato" action.
- `createContractInvitation(animalId, adopterId)` — `src/app/actions/contract.ts`. The token-locked contract action. Unchanged.
- `computeAvgRating` — `src/domain/ratings.ts`. Used by `applicants.ts` already; the enriched fields below reuse the same domain function.
- `formatShortDate` — `src/lib/dates.ts`.

## Approach

### Layer 1 — Server enrichment

Extend `ApplicantSummary` in `src/app/actions/applicants.ts:19-29` with the at-a-glance signals the row and panel need. All fetched per-applicant via D1-safe `Promise.all(rows.map(async row => …))` (same pattern already in use at `applicants.ts:75`). Each row touches:

- `form_submissions` (already fetched at `applicants.ts:58-69`) — extract `intent`, `species`, `lifeStage`, `household` (JSON-decoded), `email`, `phone`, `address`, `selfieUrl`, `latitude`, `longitude`, `answersJson`.
- `adopters` (already fetched at `applicants.ts:79-82`) — also pull `addedBy`, `source`, `country`.
- `adoptions` (already fetched for `computeAvgRating` at `applicants.ts:84`) — add `adoptionCount` (records with `recordType='adoption'`), `requestCount` (`recordType='adoption_request'`), `observationCount`.
- `adopter_flags` (new per-row query) — fetch all unresolved flags for the linked adopter; build the same `AdopterFlags` shape `/my-adopters` uses so `<FlagBadges>` can render directly. Also compute the `tooManyAdoptions` / `tooManyRequests` density flags via the existing domain function (`src/domain/flags.ts:buildFlags`).

New `ApplicantSummary` shape:

```ts
interface ApplicantSummary {
    // existing
    submissionId, adopterId, adopterName, adopterRating, appliedAt, hasInvite, isSigned,
    // new — at-a-glance signals for the row
    flags: AdopterFlags | null,           // null when adopterId is null (orphan submission)
    adoptionCount: number,
    requestCount: number,
    intent: 'self' | 'gift' | null,
    species: string | null,
    lifeStage: string | null,
    // new — panel-only payload
    submission: {
        email, phone, address, selfieUrl, latitude, longitude,
        household: string[] | null,
        answersJson: string | null,        // pass-through to <FormAnswersPanel>
    },
    adopterContext: {                       // for the panel's profile section
        addedBy: string | null,
        source: string | null,
        country: string | null,
    } | null,
}
```

**Critical files**: `src/app/actions/applicants.ts`, `src/types/adopter.ts` (re-export `AdopterFlags` shape if needed), `src/app/api/my-animals/route.ts` (the inline `applicants` projection — verify nothing strips the new fields).

### Layer 2 — Denser row

`src/components/AnimalApplicants.tsx:207-251` per-applicant `<li>` gets two new inline elements between the name/rating area and the action button:

- **Flag count badge** — render only if any of `flags.inaccurate / duplicate / verified_identity / tooManyAdoptions / tooManyRequests` is set. Format: `⚠ 2` (themed `bg-rose-50 text-rose-700`) for negative flags, `✓` for `verified_identity`. Clicking the badge opens the panel directly to the flags section (anchor scroll inside the panel).
- **Form-summary one-liner** — small stone-500 text below the rating, formatted as `🏠 {intent_label} · {lifeStage_label} · {species_label}` — e.g., `🏠 Para sí · adultos · perros`. Each field is optional; render only what's present, joined by `·`. Truncate the whole line to one row with ellipsis.

The whole row becomes a clickable opener for the detail panel (currently only the name links out). Keep the right-aligned `Enviar contrato` / `Reenviar` / `Firmado` / `Ver formulario` action button as a per-row shortcut for "I already know who I want — skip the panel".

### Layer 3 — `<ApplicantDetailPanel>` (new)

The keystone. New component at `src/components/ApplicantDetailPanel.tsx`. Slides in from the right on desktop (~30rem wide), bottom sheet on mobile (~85vh). Z-index `z-[60]` so it sits above the nav (`z-50`). Background scrim + click-outside-to-close (unless an action is busy).

Props:
```ts
{
    applicants: ApplicantSummary[];      // the full disclosure list
    initialIndex: number;                  // which one to open
    animalId: string;
    animalName: string;
    onClose: () => void;
    onContractIssued?: (token: string, applicant: ApplicantSummary) => void;
}
```

Layout:

```
┌─────────────────────────────────────────┐
│  ← Anterior  ●○○  Siguiente →     [✕]   │ ← sticky header (paging + close)
├─────────────────────────────────────────┤
│  María López                            │ ← applicant name (large)
│  ★ 4.8 (12 calificaciones)              │ ← rating w/ RatingExplainer
│  📝 Formulario · hace 3 días            │ ← source pill + applied date
├─────────────────────────────────────────┤
│  PERFIL DEL ADOPTANTE                   │ ← collapsible section header
│  • Flags: ⚠ Duplicado · ✓ Identidad     │
│  • Actividad: 2 adopciones · 5 pedidos  │
│  • Agregado por: rescatista@email.com   │
│  • Origen del registro: Formulario      │
│  [Ver perfil completo →]                │
├─────────────────────────────────────────┤
│  RESPUESTAS DEL FORMULARIO              │ ← collapsible section header
│  • Intención: Para sí                   │
│  • Especie: Perros · Adultos             │
│  • Hogar: Niños · Mascotas · Patio       │
│  • Selfie: [thumbnail]                  │
│  • Geolocalización: 34.6°S, 58.4°W      │
│  [Ver formulario completo →]            │
│  ◢ Todas las respuestas (FormAnswersPanel embedded, collapsed by default)
├─────────────────────────────────────────┤
│ [Ver formulario] [Ver perfil]           │ ← secondary actions
│            [ ENVIAR CONTRATO ]          │ ← sticky primary action
└─────────────────────────────────────────┘
```

Behavioral details:
- **Prev / Next** cycles `initialIndex` through `applicants`. Disabled at the ends (no wraparound — keeps the "where am I in the list" mental model honest). Pagination dots in the middle of the header (`●○○`) show position. Keyboard: `←` / `→` arrows + `Esc` to close.
- **State preservation across cycling**: each applicant's collapsible sections (`PERFIL` / `RESPUESTAS`) default to expanded. No per-applicant state preserved across navigation — keep it fresh.
- **Primary action** stays sticky at the bottom and reflects per-applicant state:
  - `isSigned` → disabled `✓ Firmado` chip (matches current `AnimalApplicants.tsx:222-224`).
  - `hasInvite` → `Reenviar contrato`.
  - `!adopterId` → `Ver formulario` link (no contract option for orphan submissions; per v27).
  - Default → `Enviar contrato`.
- **On "Enviar contrato"**: fire the existing `createContractInvitation(animalId, applicant.adopterId)` (unchanged from `AnimalApplicants.tsx:179`). On success, swap the primary action's content for the existing `<MiniShareModal>` rendered inline at the bottom of the panel (instead of as a separate modal on top of the panel). The user copies the link, the toast confirms, and they can either dismiss the modal or hit "Siguiente" to keep evaluating.
- **"Ver perfil completo"** opens `/adopter/<adopterId>` in a new tab (so the panel stays open). Same for "Ver formulario completo" → `/form-results/<submissionId>`.

**Critical files:** `src/components/ApplicantDetailPanel.tsx` (new), `src/components/AnimalApplicants.tsx` (open-panel wiring + row densification), `src/app/actions/applicants.ts` (enriched payload), `src/app/api/my-animals/route.ts` (verify enriched fields flow through), `src/i18n/locales/{es,en}.ts`.

### i18n keys (ES + EN, both locale files)

- `myAnimals.applicants_panel_title` (`Evaluar postulante`)
- `myAnimals.applicants_panel_prev` / `applicants_panel_next` (`Anterior` / `Siguiente`)
- `myAnimals.applicants_panel_section_profile` (`Perfil del adoptante`)
- `myAnimals.applicants_panel_section_form` (`Respuestas del formulario`)
- `myAnimals.applicants_panel_view_full_profile` (`Ver perfil completo`)
- `myAnimals.applicants_panel_view_full_form` (`Ver formulario completo`)
- `myAnimals.applicants_panel_activity` (`{adoptions} adopciones · {requests} pedidos`)
- `myAnimals.applicants_panel_added_by` (`Agregado por {email}`)
- `myAnimals.applicants_row_summary_intent_self` / `_gift` (`Para sí` / `Como regalo`)
- `myAnimals.applicants_row_summary_lifestage_*` for `puppy / young / adult / senior / none`
- `myAnimals.applicants_row_summary_species_*` for `dog / cat / both / other`

## Verification

End-to-end on staging after deploy:

1. **Row densification** — Open `/my-animals` for an animal with 2+ applicants. Confirm each row shows: name • rating • flag-count badge (if any flags) • 1-line summary (`🏠 Para sí · adultos · perros`) • date • action button. Empty form fields render gracefully (no `· ·` artifacts).
2. **Open panel** — Click any applicant row (not the action button). Panel slides in from the right on desktop / bottom on mobile. Profile section shows rating with `RatingExplainer`, flags via the shared `<FlagBadges>` component, activity counters, source pill, added-by line. Form section shows intent, species, lifeStage, household items, selfie thumbnail, geolocation, plus an expandable `<FormAnswersPanel>`.
3. **Per-row state preservation** — Open the panel on an applicant with `hasInvite=true`. Primary action reads `Reenviar contrato`. Open one with `isSigned=true` → reads `✓ Firmado`, disabled. Open an orphan (`adopterId=null`) → primary action becomes `Ver formulario` link, no contract option.
4. **Prev / Next** — From an open panel, hit `Siguiente`. Panel content swaps to the next applicant in the list. Dots `●○○` → `○●○`. Hit `←` keyboard arrow at the end of the list → disabled (no wraparound, no jump). `Esc` closes the panel.
5. **Send contract from panel** — Click `Enviar contrato`. `MiniShareModal` content appears inline at the bottom of the panel with copy / WhatsApp / Email / Open options. Token URL works in incognito. State updates: `hasInvite` becomes true; navigating away and back shows `Reenviar` for that applicant.
6. **External-page escape hatches** — `Ver perfil completo` opens `/adopter/<id>` in a new tab. `Ver formulario completo` opens `/form-results/<submissionId>` in a new tab. Panel itself stays open in the original tab.
7. **D1-safety smoke** — Open `/my-animals` with 10+ animals each having 2-3 applicants. Confirm no N+1 explosion: the request finishes in <2s, no log warnings about D1 fallback hits.
8. **Dark mode** — Toggle theme to Azul Noche. Every shade used must be themed (`amber-50/100`, `rose-50/100`, `stone-*`, `teal-*` per `globals.css [data-theme]` block). Grep before adding any class.

## Risk callouts

- **D1 query explosion**: the new enrichment adds 1-2 extra per-applicant queries (flags + record counts). For an animal with 5 applicants this is ~10-15 queries. The `Promise.all` keeps them parallel but the API-route round-trip cost adds up across N animals. Mitigation: cap `getApplicantsForAnimal` to `limit 20` (matches current behavior); if perf shows up as a regression, batch the flag/count lookups into a single `IN (?)`-replacement loop above the per-animal fan-out in `/api/my-animals/route.ts`.
- **Orphan submissions** (`linked_adopter_id IS NULL`): the panel must gracefully handle missing profile data. Render the profile section as `<empty state>: 'Sin perfil vinculado'` with a link to `/admin/users` (the v32 orphan-recovery surface) for admins. The primary action stays as `Ver formulario` (per v27).
- **Focus management with Prev/Next**: each navigation should move focus to the panel's heading (`role="dialog"` aria-labelledby) so screen readers announce the new applicant. The `MiniShareModal`-inline state must release focus back to the primary action when dismissed.
- **Mobile keyboard interaction**: the sticky-bottom action bar should not be obscured by the mobile keyboard. Test with iOS Safari; if the keyboard pushes the bar off-screen, use `dvh` instead of `vh` on the panel's max-height.
- **Themed Tailwind discipline** (per memory `feedback_themed_colors_only`): every chip/badge/section background must use `[data-theme]`-mapped Tailwind shades. The denser-row flag badge specifically uses `bg-rose-50 text-rose-700` (themed) and `bg-teal-50 text-teal-700` (themed). No new `bg-*-50` / `hover:bg-*-100` outside the themed set.
- **State on cycling**: deliberately not preserving collapsible state between applicants — keeps the mental model simple ("I just opened this applicant, the sections are open"). If users complain about repetitive scroll, add a single sticky-default ref in the parent.
