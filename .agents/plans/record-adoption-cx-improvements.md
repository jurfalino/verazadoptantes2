# Spec — "Record an adoption" CX improvements

**Author:** CX analysis → implementation spec
**Date:** 2026-06-30
**Status:** Draft for review
**Scope:** 4 friction reductions on the record-an-adoption journey, ordered by value/effort.

## Grounding note (read first)

This spec was written **after reading the current code**, not from the journey trace alone.
Two of the four recommendations turned out to be **already largely shipped** (a prior
"dedup-UX redesign", v2.19.65, and the delivery-address prefill). Their sections below are
scoped as *verify + small delta*, not *build*. The two genuine wins are **#3 (observation
step-skip)** and **#4 (delivery-cost affordance + locality prefill)**.

Recommended build order: **#3 → #4 → #2 → #1** (value-for-effort).

---

## Rec #1 — Upstream duplicate resolution

### Status: ✅ Already shipped — propose NO build, optional micro-enhancement

**What I found.** The "show duplicates before save" goal is already implemented:

- `StrongMatchStrip.tsx` renders an inline, persistent amber strip above the save button
  for up to 2 **strong** (exact phone/email/social) matches, each with **"Continuar con
  este perfil"** (merge) + **dismiss (×)** — `AdopterForm.tsx:685`.
- Detection runs **while typing** (debounced) and feeds `dismissedStrongIds`.
- The save-time modal is now a **narrow backstop**: it only fires for strong matches the
  user has **not** dismissed **and** only when the normalized query **changed** since the
  last detection snapshot — `AdopterForm.tsx:594-610` (`queryUnchanged` short-circuit,
  v2.19.65). Weak/medium-only result sets **save silently**.

So the original CX critique ("the hard gate is at save time, after the work") is **stale** —
that redesign already moved the decision upstream for the high-cost (exact-identity) case.

**Optional micro-enhancement (low value, only if asked).** Medium/name-similarity matches
never surface inline (by design — "weak-only saves silently"). If we ever want a softer
nudge, add a **collapsed peek** ("3 perfiles con nombre parecido — ver") above the strip
that expands to the existing result cards. *Recommendation: do not build now.* It risks
re-introducing the exact noise the redesign removed.

**Action:** none, beyond confirming the above with the team. Close as "already done."

---

## Rec #3 — Skip the near-empty Step 1 for observations *(primary win)*

### Status: ⛏️ Genuine gap — build

**Problem.** The activity wizard (`AdoptionFormWizard.tsx`) is always 3 steps:
`What happened? → Details → Evidence`. For **observations**, Step 1 needs **no animal**
(`checkStep1Valid` returns `true` immediately for `isObservation`,
`AdoptionFormWizard.tsx:600-602`; animal data is actively cleared, `:370-377`). When the
wizard is opened with the intent already known (from `VisitIntentCard` via `initialRecordType`
/ `shouldOpenFromWizard`), Step 1 shows only guidance copy and a "Siguiente" button —
**a click past an empty screen.**

**Proposed change.** When the record type is **pre-determined and animal-less**
(`isObservation && shouldOpenFromWizard`), **start the wizard on the Details step** and
render a **2-step** progress indicator (`Details → Evidence`).

Concretely:
- Initial step: `useState(() => initialDraft?.step ?? (startsAtDetails ? 2 : 1))`
  where `startsAtDetails = isObservation && shouldOpenFromWizard`
  (`AdoptionFormWizard.tsx:217`).
- `goBack` floor: clamp to `2` (not `1`) when `startsAtDetails`, so "Atrás" from Details
  doesn't reveal the skipped step (`:598`).
- Step indicator: derive `stepLabels` from a `steps` array that drops `step_what` when
  `startsAtDetails`; renumber the rail (`:634`, `:685-708`) and fix the connector width math
  (`:708`, currently hardcoded `0% / 50% / 100%` for 3 steps).
- Guard the `step===1` blocks (`:716`, `:291`) so they no-op when skipped.
- **Do not** change the homepage-card path (`?newAdoption=observation`): there the user
  *chose* observation from a generic card, so keeping Step 1's type confirmation is fine —
  gate the skip on `shouldOpenFromWizard` (the VisitIntentCard path), which is where intent
  is unambiguous.

**Edge cases.**
- Draft resume: a persisted `step: 1` draft for an observation should be coerced to `2` on
  load so a stale draft can't strand the user on the hidden step (`:319` writeDraft / draft
  read at `:217`).
- Switching record type mid-wizard isn't possible once `shouldOpenFromWizard` (no type
  switcher shown), so no need to "re-add" Step 1 dynamically.

**Files:** `AdoptionFormWizard.tsx` (single file). **i18n:** none new.
**Effort:** ~half day. **Risk:** low-medium — the step-rail renumber is the fiddly part;
cover with the tests below.

**Tests (Playwright):**
- Observation via VisitIntentCard → wizard opens on **Details**, rail shows **2 steps**,
  "Atrás" never reaches an animal panel, save works.
- Observation via homepage card → still opens on Step 1 (unchanged).
- Adoption via VisitIntentCard → unchanged 3-step flow.
- Resume a stale `step:1` observation draft → lands on Details.

---

## Rec #4 — Delivery toggle: surface the cost + finish the prefill

### Status: 🔶 Partially shipped — small completion

**What I found.** Toggling **"Entregado a domicilio"** on already **pre-fills the street**
field from the adopter's existing contact address
(`verifiedStreetAndNumber: extractAddressFromContact(adopterAddress)`,
`AdoptionFormWizard.tsx:899`). But:
1. **Locality is NOT prefilled** — `verifiedLocality: nd ? d.verifiedLocality : ''` (`:900`)
   pulls only from the draft, never from the contact address. Inconsistent with street.
2. **No affordance that the toggle spawns two fields** — the inputs appear only after the
   toggle flips (`:907`), so the cost is invisible until committed.

**Proposed change.**
- **Prefill locality too.** Extend `extractAddressFromContact` (or its caller) to return a
  `{ street, locality }` shape and seed both on toggle-on (`:899-900`). If the contact
  address is an unstructured blob with no parseable locality, leave locality empty (no
  regression).
- **Affordance.** Add a one-line helper under the toggle label
  (`adoption.delivered_to_home_hint`, e.g. *"Pediremos la dirección de entrega para
  verificarla."*) so the user knows two fields follow — `:886`.

**Files:** `AdoptionFormWizard.tsx`; possibly `src/lib/...` address parser used by
`extractAddressFromContact`. **i18n:** `+1` key both locales
(`adoption.delivered_to_home_hint`).
**Effort:** ~2-3 hours. **Risk:** low. The only sharp edge is the blob-address parse —
fall back to street-only prefill rather than mis-splitting (see the deferred
PII/address round-trip tests note in memory).

**Tests:** toggle on with a structured-contact adopter → both street + locality prefilled;
with a raw-blob adopter → street best-effort, locality empty, no crash.

---

## Rec #2 — Trim the homepage-card hop

### Status: 🟡 Minor refinement — the chain already exists

**What I found.** The homepage "Registrar Adopción" card already routes intelligently:
card → `AdopterPicker` modal (**search-as-you-type**) → select existing **or** "create new"
→ routes to `/adopter/create?continueToAdoption=true&newAdoption=adoption&name=…`, and the
adopter-create → activity-wizard **auto-open is already wired** via `continueToAdoption`
(`HomepageActionCard.tsx:78-91`). So create→record is **already one continuous flow**.

**Critical caveat.** The picker modal **is the search-first dedup gate** — it forces the
rescuer to look before creating, which is the product's entire reason to exist
(`project_collaborative_vetting_model`, the "search before handover" habit). **Do not remove
it.** "One-click skip the picker" would undercut the core safeguard. My original rec #2 was
wrong on this point once the picker's role is clear.

**Proposed refinement (optional, low value).** The only real friction is the modal being a
*separate* surface. Option: make the picker's search field **autofocused** on open (so the
user types immediately, no extra click) and ensure Enter-to-select the top match. Verify
current autofocus state in `AdopterPicker.tsx`; if missing, add it. This shaves one click
without weakening the dedup gate.

**Files:** `AdopterPicker.tsx` (autofocus + Enter handling, if not already present).
**Effort:** ~1 hour. **Risk:** minimal. **Recommendation:** bundle into a polish pass; not
worth a standalone release.

---

## Rollout

- **Batch** #3 + #4 + #2-autofocus into one version bump (per `feedback_batch_pushes` —
  don't drip). #1 ships nothing.
- Symmetric-surface check (`feedback_check_symmetric_form_surfaces`): #3/#4 touch only the
  activity wizard, but confirm the **Edit-record** path (if any reuses the wizard) inherits
  the step-skip correctly before shipping.
- Grep Playwright selectors before changing the step rail
  (`feedback_grep_tests_before_deletion`): the step-count/`Siguiente` assertions live in the
  adoption-flow specs and will break if the rail renumber isn't reflected.
- i18n: update **both** `es.ts` and `en.ts` for every new key.

## Net assessment

The journey is in **better shape than the click-count trace implied**: the expensive
guardrail (dedup) was already moved upstream, and delivery-address prefill is half-done.
The highest-leverage remaining fix is the **observation step-skip (#3)** — it removes a
literal "click past an empty screen" on the single most frequent low-effort record type.
