# Plan: Visit-Intent Prompt on Adopter Profile

## Context

**The problem**: Today, a rescuer who lands on another rescuer's adopter profile has three legitimate reasons to be there — they received an adoption request from this person, they gave this person an animal, or they have an observation to log. All three actions exist behind a single "Registrar nuevo" button that requires the user to (a) know it's there, (b) click it, (c) pick the right record type from a dropdown. Casual / new users don't complete the funnel.

**Outcome we want**: Convert implicit intent into an explicit, one-tap path to the matching wizard. Capture more records (better data quality), reduce abandonment, and give us a telemetry signal of intent vs. completion.

**Constraint**: Reading contact info, family members, and history must remain unblocked — this is a prompt, not a gate.

---

## CX Framing (senior CX perspective)

This is a *funnel* feature, and the failure modes that kill funnel features are well-known. Four risks, each addressed in the design:

| Risk | Mitigation |
|---|---|
| **Pop-up fatigue** — shown every visit, users dismiss reflexively and stop reading | Per-(adopter × user) dismissal with 7-day TTL via `localStorage` (mirrors `InstallPrompt`). After dismissal, the card stays hidden for that combo for a week. The three actions remain reachable through the existing button below. |
| **Wrong intent** — user picks closest option even if none fit | Explicit "Solo estoy mirando, cerrar" button. Each of the three options has a 1-line description so the choice is unambiguous. |
| **Owner self-view** — the rescuer who created this profile already knows why they're here | Suppress entirely when `adopter.addedBy === currentUser`. |
| **Already-acted users** — user just logged an adoption-request for this adopter; asking again is noise | Per-option suppression: hide A if user has logged an `adoption_request` for this adopter in the last 30d, hide B if they logged an `adoption`. C (observation) is always available — you might have a new observation any time. If all three would be hidden, suppress the whole card. |

**Two further CX choices** worth surfacing:

- **Non-modal inline card, not a dialog.** A modal dialog blocks the profile info the user came to read. The user's brief explicitly said "doesn't block from reading the profile info — maybe on top of the activity section." That maps cleanly to a card pinned at the top of the existing `Adoptions` `CollapsibleSection` in `AdopterProfileV2` — visually adjacent to the action it triggers, never covering the contact card or family members.
- **Skip step 1 of the wizard when the user picks via the card.** Asking the user the recordType in the card and then again in step 1 of `AdoptionFormWizard` is a dark pattern of double confirmation. We pre-select and start the wizard at step 2.

---

## Visibility Matrix

The card renders only when **all** of the following are true:

1. `featureFlag.ENABLE_VISIT_INTENT_PROMPT === true` (admin-togglable, DB-backed)
2. `!isNew` (not on the create-adopter route)
3. `!isOwner` — `adopter.addedBy !== currentUser`
4. `!dismissedRecently` — no `visit_intent_dismissed_${adopterId}_${userHash}` key in `localStorage` within 7 days
5. At least one of the three options is not suppressed by per-option logic

Per-option suppression (computed from already-fetched `adoptions[]` in the page):

- **A — `adoption_request`**: hide if `adoptions.some(a => a.addedBy === currentUser && a.recordType === 'adoption_request' && a.date > now - 30d)`
- **B — `adoption`**: same predicate for `recordType === 'adoption'`
- **C — `observation`**: never hidden — observations are unbounded over time

---

## Implementation

### Files to modify

**New files:**
- `src/components/VisitIntentCard.tsx` — the new inline card component (client). Renders the question, three buttons with i18n labels, "solo estoy mirando" dismiss button, copy-to-clipboard error id pattern via `extractErrorId` if a wizard launch fails. Uses the `DisclaimerToast` visual language (rounded card, status-info palette, close icon top-right).

**Modified — feature flag plumbing (mirrors existing `ENABLE_ANIMALS_FOR_ADOPTION`):**
- `src/config/features.ts:17-20` — add `ENABLE_VISIT_INTENT_PROMPT: false` to `FEATURE_FLAGS` const.
- `src/app/admin/config/page.tsx:44-49` — add a `{ key, label, description }` entry to the admin toggle list. Description: "Asks visiting users why they're on an adopter profile and routes them to the matching wizard."

**Modified — wizard pre-selection (adds an opt-in prop, no behavior change for existing callers):**
- `src/components/AdoptionFormWizard.tsx` —
  - Add prop `initialRecordType?: 'adoption' | 'adoption_request' | 'observation'` (line ~24 prop type).
  - When set on mount: seed `formData.recordType` with the value, set `step` to 2 directly, set `isOpen` to true (driven by an `autoOpen?: boolean` companion prop).
  - When the user closes the wizard, the parent (`VisitIntentCard`) toggles its own state so the card and wizard don't double-render.

**Modified — profile page wiring:**
- `src/app/adopter/[id]/page.tsx` — read `getFeatureFlag('ENABLE_VISIT_INTENT_PROMPT')` (server-side, cheap — already in `Promise.all` style). Pass `enableVisitIntent: boolean` into `AdopterProfileV2`.
- `src/components/AdopterProfileV2.tsx:126-150` — inside the `Adoptions` `CollapsibleSection`, render `<VisitIntentCard adopterId={id} adopterName={adopter.name} currentUser={currentUser} isOwner={isOwner} adoptions={adoptions} availableAnimals={availableAnimals} adopterAddress={adopter?.contactInfo || ''} enabled={enableVisitIntent} />` *above* the existing `AdoptionFormWizard` button (which stays — it's the universal entry point). The card encapsulates its own dismissal state and renders an inline `<AdoptionFormWizard initialRecordType={...} autoOpen ...>` when an option is picked.

**Modified — i18n:**
- `src/i18n/locales/es.ts` and `en.ts` — add `visitIntent.title`, `visitIntent.option_a`, `visitIntent.option_a_hint`, `visitIntent.option_b`, `visitIntent.option_b_hint`, `visitIntent.option_c`, `visitIntent.option_c_hint`, `visitIntent.dismiss`. Spanish is the default per CLAUDE.md — both files must be updated together.

### Reused, not rebuilt

- **`AdoptionFormWizard`** (`src/components/AdoptionFormWizard.tsx`) — already supports all three record types via the existing step-1 selector. We're just adding pre-seeded entry. Do **not** create new wizards.
- **`getFeatureFlag` / `setFeatureFlag`** (`src/config/features.ts:33-90`) — DB-backed pattern. Don't add new infrastructure.
- **`zarazTrack`** (`src/lib/zaraz.ts`) — same snake_case convention as existing events (`adoption_created`, `flag_submitted`).
- **DisclaimerToast** (`src/components/DisclaimerToast.tsx`) — borrow its `localStorage`-keyed dismissal pattern and `--status-info-*` color tokens for visual consistency.
- **`extractErrorId`** (`src/lib/errorUtils.ts`) — for any toast errors if the wizard launch ever fails.

### Telemetry

Three events via `zarazTrack` (snake_case, properties as `{ string | number | boolean }`):

- `visit_intent_shown` — `{ adopter_id, suppressed_a: 0|1, suppressed_b: 0|1 }` — fires once per mount, after the visibility matrix passes.
- `visit_intent_selected` — `{ adopter_id, intent_type: 'adoption' | 'adoption_request' | 'observation' }` — fires on click.
- `visit_intent_dismissed` — `{ adopter_id }` — fires on close.

This gives us shown→selected conversion per option and dismissal rate per profile-type cohort.

### Error logging

Per the audit shipped in v2.13.0: any catch in `VisitIntentCard` (e.g., a `setItem` rejecting in private-mode browsers) calls `logger.warn`-equivalent via `reportClientError`, never silently swallows. The wizard launch path already has its own error handling.

---

## Verification

1. **Local smoke**:
   - `npm run dev`, sign in as user A, create adopter X.
   - Sign in as user B, visit `/adopter/X`. Card should appear above the activity section.
   - Click option B → wizard opens at step 2 with recordType pre-selected to `adoption`.
   - Save the adoption. Reload `/adopter/X` as B → option B is now suppressed (or hidden), options A and C still visible.
   - Click "Solo estoy mirando" → card disappears, doesn't return on reload for 7 days.
   - Visit `/adopter/X` as user A (the owner) → card never renders.

2. **Feature flag**:
   - In `/admin/config`, toggle `ENABLE_VISIT_INTENT_PROMPT` off → reload profile → card gone.
   - Toggle on → card returns.

3. **i18n**:
   - Switch language to English → labels render in English.
   - Default Spanish remains primary; missing key fallback would surface raw `visitIntent.*` strings (catches any keys we forgot to add to `es.ts`).

4. **Telemetry** (browser devtools network tab, filter zaraz):
   - On profile load: `visit_intent_shown` fires once.
   - On option click: `visit_intent_selected` with the right `intent_type`.
   - On dismiss: `visit_intent_dismissed`.

5. **Type check / lint**:
   - `npx tsc --noEmit` clean.
   - `npm run lint` does not exceed baseline (currently 2704 problems; the audit confirmed this is the active ratchet — CLAUDE.md's "122" is stale).

6. **Build**:
   - `npm run build` succeeds (catches edge-runtime regressions; profile page is edge).

---

## Out of scope (deliberately not in v1)

- **Cross-device dismissal sync.** localStorage is per-browser. If a user dismisses on mobile and visits the same profile on desktop, they see it again. Persisting dismissals server-side adds DB writes per profile view; not worth it for v1. Revisit if telemetry shows users complaining.
- **A/B testing the copy.** Ship one wording; iterate based on `selected/shown` ratio.
- **Animating between card → wizard.** The wizard already opens as its own modal; jump-cut is acceptable.
- **Reordering the three options based on the adopter's record history** (e.g., put A first if this adopter has many active requests). Could be valuable later; needs more data before designing.
