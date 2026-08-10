# Visibility & access: always-on badge + explanatory modal

## Goal

Consolidate the profile's scattered visibility / access / provenance signals into a
single, always-present **badge** whose tap opens a **state-specific modal** — while
keeping pending access requests as a record-level actionable banner. Preserve the
card↔profile badge mirror. Confirmed with the user across the design conversation;
prototype: `badge-modal` artifact (teal chosen for the unlocked state).

**Precondition:** `ENABLE_PII_ACCESS_GATING` is ON in prod (confirmed). The one new
badge state only appears when gating is on; everything degrades to today's behavior
when it's off.

## The badge state model

Today (`AdopterProfileV2.tsx:144`) the badge is `'public' | 'protected' | null`, and
is **null** (invisible) for a viewer who has full access to a protected record. The
new model fills that gap with a third visible state and never goes null except for the
new-record form:

```ts
type VisibilityBadge = 'public' | 'protected-locked' | 'protected-unlocked' | null;

const visibilityBadge: VisibilityBadge =
    isNew                              ? null
  : displayedAdopter?.isPublic         ? 'public'            // 👁 eye, sky
  : !effectivePiiContext?.gatingOn      ? null               // gating off → no "protected" concept (unchanged)
  : effectivePiiContext?.masked         ? 'protected-locked'   // 🔒 closed padlock, neutral gray
  :                                       'protected-unlocked'; // 🔓 open padlock, TEAL
```

Mapping to existing signals (no new server computation needed for the badge itself):
- `protected-unlocked` = `gatingOn && !masked && !isPublic` = the viewer has full
  access (`nothingMasked` = privileged **or** holds an `all_contact` grant). This is
  exactly today's `null` case.
- `protected-locked` = `gatingOn && masked` = stranger or partial (search-unlocked)
  viewer. Unchanged from today.
- **Gate the new state on `gatingOn`** so a gating-off deploy keeps rendering no badge
  for non-public records (today's behavior) instead of a misleading "unlocked".

Color: unlocked uses the app **teal** accent (`--btn-primary-*` family / teal-soft),
NOT green — avoids colliding with the rating's good/bad green→red scale. Icon is an
open padlock (the "unlocked" meaning lives in the icon; color just says "active").

## Modal content by case (badge → modal)

The badge becomes a `<button>` (keyboard-focusable, `aria-haspopup="dialog"`); tapping
opens `VisibilityBadgeModal`. Content branches on the badge state + privilege:

| Badge | Modal title | Body |
|---|---|---|
| `public` | "Registro público" | scope line + **origin disclaimer** (`adopter.public_profile_source_notice`) + `Ver fuente original →` (`sourceUrl`) |
| `protected-locked` | "Datos de contacto protegidos" | what "protected" means + **"Solicitar acceso a contacto"** button (or "Solicitud pendiente" state) |
| `protected-unlocked` **+ privileged** | "Tenés acceso a este registro" | reason line + **"Quién tiene acceso"** ledger (revocable grants, org-mates, search-match) |
| `protected-unlocked` **+ grantee only** | "Tenés acceso a este registro" | reason line ("acceso otorgado…") + "el responsable puede revocarlo"; **no ledger** |

The privileged-vs-grantee split is load-bearing: `PiiAccessGrantsDisclosure` is
custodians-only (owner ∨ org-mate ∨ admin ∨ mod = `piiContext.privileged`). A grantee
gets the teal badge but must NOT see the guest list.

Reason line inputs (already available in `AdopterProfileV2` scope): `isOwner`
(`adopter.addedBy === currentUser`), `isOrgMateOfOwner`, `isAdmin`, `attribution.orgName`.
Grantee "otorgado el {date} por {who}" precision needs the viewer's own grant row —
see Data plumbing (optional).

## What moves / is retired

- **Remove** `PublicProfileSourceNotice` from the page render (`AdopterProfileV2.tsx:368-370`);
  its copy moves into the `public` modal. ⚠️ Tradeoff: today it's an always-visible,
  non-dismissible defensive banner; behind a tap it's less prominent. User approved
  moving it into the modal — flag for final sign-off. (Keep the component file; the
  modal reuses its copy + the `safeSourceUrl` http(s) guard.)
- **Remove** `PiiAccessGrantsDisclosure` as a standalone mid-page collapsible
  (`AdopterProfileV2.tsx:417-419`); its content renders inside the `protected-unlocked`
  privileged modal (always-open, not a collapsible).
- **Keep** `PiiAccessRequestPanel` exactly where it is — record-level, above the header
  (`AdopterProfileV2.tsx:414-416`). Pending requests are an actionable task, not
  reference info, so they stay visible and are NOT folded into the modal. Optional
  polish: restyle to a clearer "🔔 Solicitud pendiente" banner (matches the
  pending-duplicate banner pattern already on the page).

## Implementation steps

### Phase 1 — Badge model + modal (profile)
1. **`AdopterProfileV2.tsx`**
   - Widen `visibilityBadge` to the 4-value union with the logic above (gate unlocked
     on `effectivePiiContext.gatingOn`).
   - Add modal open state (`useState`) + render `<VisibilityBadgeModal … />` as a
     sibling; pass `onBadgeClick` down to `AdopterForm`.
   - Remove the `PublicProfileSourceNotice` and `PiiAccessGrantsDisclosure` render
     blocks (their content now lives in the modal). Leave `PiiAccessRequestPanel`.
   - Compute the reason inputs (isOwner already at `:114`; isAdmin/isOrgMateOfOwner are
     props) and pass to the modal.
2. **`AdopterForm.tsx`** (badge at `:933-958`)
   - Widen `visibilityBadge` prop type; add the `protected-unlocked` variant (teal,
     open-padlock SVG). Render the badge as a `<button>` calling `onBadgeClick`.
   - Add `onBadgeClick?: () => void` prop (plumbed from `AdopterProfileV2`).
   - Keep the `ContactEntriesSection` microcopy and its `hidePublicMicrocopy`
     suppression exactly as-is (user chose to keep it for now — the badge+modal are
     additive, not a replacement).
3. **`VisibilityBadgeModal.tsx`** (NEW, client)
   - Props: `badge`, `isPublic`, `sourceUrl`, `piiContext` (privileged, accessGrants,
     requestState), reason inputs, `onClose`.
   - Public → disclaimer + source link (reuse `PublicProfileSourceNotice` copy + guard).
   - Locked → explanation + "Solicitar acceso" wired to the **existing** request flow:
     reuse `RequestPiiAccessModal` / `requestPiiAccess` + `getPiiAccessRequestState`
     (respect `requestState.pending` / cooldown to show "Solicitud pendiente").
   - Unlocked+privileged → reason + inline "Quién tiene acceso" (lift the list markup
     from `PiiAccessGrantsDisclosure`; keep `revokePiiAccessGrant`). Consider extracting
     a shared `<AccessGrantsList>` so the modal and any future surface reuse it.
   - Unlocked+grantee → reason + revocable note, no ledger.
   - a11y: focus-trap, Esc + backdrop close, `role="dialog"` + `aria-modal`.

### Phase 2 — Search-card badge consistency (no modal on card)
4. **`src/lib/discoveryMatch.ts`** — replace/augment the boolean `contactProtected`
   with a tri-state `visibilityBadge`:
   `isPublic ? 'public' : (!gatingOn ? null : nothingMasked ? 'protected-unlocked' : 'protected-locked')`.
   (`assembleDiscoveryMatch` already has `visibility` + `adopterIsPublic`.)
5. **`src/app/actions/types.ts`** — add `visibilityBadge` to `DiscoveryMatch` (keep
   `contactProtected` until callers migrate, then drop).
6. **`AdopterResultCard.tsx`** — render the 3-state badge (add teal open-padlock);
   **no** click/modal on the card (tapping the card navigates to the profile, per the
   confirmed decision). Reuse the same icon+color tokens as the profile badge for a
   true mirror.

### Phase 3 — i18n, tests, polish
7. **i18n** (`src/i18n/locales/{es,en,pt}.ts`, all three — memory: update every locale):
   reuse `public_label`, `protected_label`, `public_profile_source_notice`,
   `pii_grants_*`; add: `visibility_unlocked_label`? (keep label "Protegido" — the
   *icon+color* differ, not the word), modal titles/subtitles, reason lines
   (`vis_reason_owner/org/admin/grant`), locked-modal body + request CTA reuse.
8. **Tests** — grep `tests/` for badge selectors first (memory: Playwright selectors
   aren't type-checked; a missed one blocks the deploy). Update `search.spec.ts` badge
   assertions for the tri-state. Add: badge is a button that opens the modal; public
   modal shows the disclaimer. (Full PII-state e2e is hard to fixture — cover public +
   the button-opens-modal happy path; unit-test the badge-state function.)
9. **Optional** unit test for the pure `visibilityBadge` mapping (extract it to a small
   pure helper in `src/domain/` or `src/lib/` so it's Node-26-testable and shared by the
   profile + card).

## Data plumbing
- Badge + most modal branches need **no new server data** — `piiContext` already
  carries `gatingOn`, `masked`, `privileged`, `accessGrants`, `requestState`,
  `pendingRequests`; `sourceUrl`/`isPublic` are on the adopter; reason flags are in
  `AdopterProfileV2` scope.
- **Optional (grantee reason precision):** add `viewerGrant` to `AdopterPiiContext`
  (the viewer's own live `all_contact` grant: `{ origin, createdAt, grantedByEmail }`)
  in `getAdopterPiiContext` (`piiAccess.ts:415`). Without it, the grantee modal shows a
  generic "tenés acceso completo; el responsable puede revocarlo" — acceptable for v1.

## Open decisions (surface before/at build)
- **Grantee reason precision** — today we show a grantee **nothing** about their access
  (no badge, no ledger; contact is simply unmasked). Both options are net-new. Recommend
  the **generic** message for v1 ("tenés acceso completo; el responsable puede revocarlo",
  no new data); add `viewerGrant` (date/granter) as a fast-follow if wanted. *Awaiting
  final pick.*

## Settled
- Teal (not green) for unlocked. Badge always shown (3 states). Card gets the visual,
  **not** the modal. Pending requests stay a record-level banner. Grantees never see the
  ledger. Word stays "Protegido" for both locked/unlocked; icon+color differ.
- **Keep the contact-section microcopy** for now (do NOT retire it) — user wants to keep
  it under Contacto for the time being. The badge+modal are additive; the microcopy stays.
- **Public disclaimer moves into the modal** — confirmed. Remove the always-on
  `PublicProfileSourceNotice` banner; the disclaimer + source link live in the public modal.

## Verification
- `npx tsc --noEmit`; lint under ratchet (125).
- Unit: badge-state mapping (all 4 cases × gating on/off).
- e2e: badge renders per state; badge opens modal; public modal shows disclaimer;
  card tri-state (`search.spec.ts`). Update selectors in the SAME commit as UI changes.
- Manual on staging (gating ON): owner-of-protected sees teal open badge → modal ledger;
  stranger sees gray locked → modal "Solicitar acceso"; grantee sees teal → modal
  without ledger; public sees eye → modal disclaimer; pending request shows as the
  record-level banner (not in the modal). Confirm card badges mirror. Check Azul Noche.
- Staging-first per deploy workflow; watch full pipeline before prod PR.

## Critical files
- `src/components/AdopterProfileV2.tsx` — badge logic, modal mount, remove banner+collapsible
- `src/components/AdopterForm.tsx` — badge → button + teal variant + onBadgeClick
- `src/components/VisibilityBadgeModal.tsx` — NEW
- `src/components/AdopterResultCard.tsx`, `src/lib/discoveryMatch.ts`, `src/app/actions/types.ts` — card mirror
- `src/components/PiiAccessRequestPanel.tsx` — keep (optional restyle), stays record-level
- `src/app/actions/piiAccess.ts` — reuse requestPiiAccess / resolvePiiAccessRequest / revokePiiAccessGrant; optional `viewerGrant`
- `src/i18n/locales/{es,en,pt}.ts`; `tests/search.spec.ts` (+ adopter spec)
