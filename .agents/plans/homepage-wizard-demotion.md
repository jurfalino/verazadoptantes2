# Homepage wizard demotion — replace embedded wizards with typed entry-points

**Status:** in progress
**Author:** Claude + jurfalino (CX review)
**Date:** 2026-05-12

## Problem

The homepage cards `AdoptionWizard` ("Di un animal en adopción") and `ReportWizard` ("Tengo info sobre un adoptante") were built before `AdoptionFormWizard` (the activity-creation wizard inside the adopter profile) existed. With the activity wizard in place, the homepage shortcuts no longer save steps — they now:

1. Run a thin two-step modal that collects animal/observation data with no guidance copy or density warnings.
2. Submit users into the *activity wizard* prefilled at step 1 — so a user finishes one wizard and immediately sees another.
3. Duplicate the adopter-search UI (search input + results + preview panel + "create new" CTA) across three components, with already-visible visual/state drift.

The cards still serve a real CX purpose — **discoverability + blank-page anxiety relief** for new users — so killing them outright would regress that.

## Decision

**Option A — Demote both cards to typed entry-points.** Cards stay on the homepage, but the embedded modal wizards are removed. Click → shared `AdopterPicker` overlay → hand off to `AdoptionFormWizard` with `initialRecordType` pre-set and `autoOpen=true`. One canonical wizard, one canonical search UI, two labeled doors into it.

Rejected: collapse to a single "Registrar actividad" CTA (Option B) — anchors two distinct intents (good news vs. concerning news) in users' heads. Revisit only if A's funnel data shows the two intents are noise.

Rejected: keep the homepage wizards as-is and freeze the activity wizard (Option C) — walks back the better UX.

## Pre-existing plumbing we can lean on

- `AdoptionFormWizard` already accepts `initialRecordType` + `autoOpen` props (line 86–88 of the component).
- `AdoptionFormWizard` already reads `newAdoption`, `continueToAdoption`, `rating`, `details`, `date`, `animalName`, `species` from URL params (line 99–108).
- `/adopter/create` already accepts `continueToAdoption=true` and forwards to the profile after save.

So the wiring for "new adopter path" is done. We only need to:
- Build a shared `AdopterPicker` overlay.
- Make sure `autoOpen` is honored when reached via URL (currently it's a prop, not a query param — likely needs a small bridge).
- Replace the two homepage card components.

## Phases

### Phase 1 — Label-honesty rename (ship independently)

Update `home.action_*` keys in `src/i18n/locales/{en,es}.ts` so the card promises match what the activity wizard delivers:

| Key | Before (ES) | After (ES) |
|---|---|---|
| `action_register_title` | "Di un animal en adopción" | "Registrar una adopción" |
| `action_report_title` | "Tengo info sobre un adoptante" | "Dejar una observación" |
| `action_report_desc` | "Compartí lo que sabés — bueno o malo…" | "Anotá lo que viste sobre un adoptante para que quede registrado." |

Mirror in `en.ts`. No flow change — this isolates the "was it the label or the flow?" signal.

### Phase 2 — Extract `AdopterPicker`

Pull the search-input + results-list + preview-panel + "+ create new" CTA out of `AdoptionWizard` step 2 / `ReportWizard` step 1 into `src/components/AdopterPicker.tsx`. Props:

```ts
{
  onSelect: (adopterId: string) => void;
  onCreateNew: (searchText: string, createUrl: string) => void;
  /** initial search text — used when the picker is reached after typing on the homepage */
  initialQuery?: string;
}
```

No new wizard yet — both existing wizards switch to the shared component first, so the dedupe lands as one diff and any regressions stay scoped.

### Phase 3 — Replace homepage wizards with typed entry-points

Replace `AdoptionWizard.tsx` and `ReportWizard.tsx` with a single `HomepageActionCard` that takes `{ recordType: 'adoption' | 'observation', testId, accentColor, copy }`. Click flow:

1. Card click (logged-out → openLogin)
2. Opens `<AdopterPicker>` overlay.
3. **On existing adopter selected** → `router.push('/adopter/<id>?newAdoption=<recordType>')`. Profile loads, activity wizard auto-opens via existing `shouldOpenFromWizard` logic.
4. **On "+ create new"** → `router.push('/adopter/create?continueToAdoption=true&newAdoption=<recordType>&name=<typed>')`. Already supported.

For the auto-open behavior on existing adopters, verify `AdoptionFormWizard`'s `shouldOpenFromWizard` (line 101) opens the wizard with the right `initialRecordType`. If the URL-derived path doesn't already set chip selection correctly, add a small bridge: `initialRecordType = newAdoptionParam` when it's a valid record type.

Delete `AdoptionWizard.tsx` and `ReportWizard.tsx` once `HomepageActionCard` is in.

### Phase 4 — Tests + i18n smoke

Per memory `feedback_grep_tests_before_deletion`: grep for `data-testid="adoption-wizard-btn"` and `data-testid="report-wizard-btn"` in `tests/` and any references to the modal step-2 labels. Update selectors in the same commit as the UI removal. Per `feedback_e2e_test_isolation`: any test that mutates adopter records must use dedicated `test-*-fixture-*` rows, not seed data.

Run `npx tsc --noEmit`, `npm run lint` (must stay ≤125 warnings), and `npx playwright test` locally before pushing.

### Phase 5 — Ship to staging, watch funnel

Version-bump per `.agents/workflows/deploy.md`, push to `staging`, watch the GitHub Actions pipeline (per `feedback_pipeline_watch_output`: `tail` the watch-output file and look for `FINAL: success`, don't trust the exit code).

After staging is green:
- Smoke-test both cards on staging URL as a logged-in user.
- Confirm `AdoptionFormWizard` auto-opens with correct chip pre-selected.
- Confirm the "+ create new" path still continues to the activity wizard.

## Signals to watch after deploy

Over 2–3 weeks:

- **Funnel:** `homepage_card_click → activity_wizard_complete`. Expect ≥ current end-to-end completion. Watch for adopter-picker drop-off (would suggest the overlay is friction we didn't have before).
- **Label rename impact:** measure card-click rate change from Phase 1 alone (independent ship), so we can attribute label-vs-flow effects separately.
- **Wizard mix:** record-type distribution of activity-wizard completes. If observation completions drop disproportionately, the discoverability hypothesis is wrong and we should reconsider Option B.

## Risks / non-goals

- **Not changing the activity wizard itself.** Step-1 chips, guidance copy, density warnings — all unchanged.
- **Not removing `/adopter/create?continueToAdoption=...` plumbing** — it serves the new path too.
- **Risk:** prefill data we used to collect upfront in the homepage wizard (animal name, observation text, date) is no longer collected before the activity wizard opens. Mitigation: activity wizard already collects all of it in step 2; net step count is roughly the same or lower for most flows.
- **Risk:** users miss the modal-style "wizard finished" feedback. Mitigation: activity wizard has its own complete-state toast + profile redirect already.

## Out of scope

- Option B (single CTA collapse) — reconsidered only if Option A data demands it.
- Visual redesign of the homepage cards beyond label changes.
- Touching `QuickAccessStrip`, search section, or other homepage surfaces.
