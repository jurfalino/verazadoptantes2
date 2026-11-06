# A form match is a possible duplicate

**Status:** approved by Jon 2026-11-05 (with the five CX additions below) · build step 1 first · branch `feature/form-match-is-duplicate`

## Why

On /my-adopters, Pedro Paez filled in Jon's form and his row carries «Por revisar». Then:

- clicking the **row** opens Pedro's profile, which shows **nothing** pending;
- clicking the **pill** opens the form screen, whose back link says «← Mis animales» whatever you came from;
- the question the pill asks («¿es la misma persona que Jonathan Urfalino?») had **already been answered** «Mantener separados» in «Pendientes de revisar», and the form still asks it.

The cause is one question kept in two places. A form submission already creates a normal
possible-duplicate pair (`duplicate_candidates`, via `findAndPersistDuplicateCandidates`), but the form
screen, the «Por revisar» filter/pill and the homepage's «N formularios por revisar» ignore that pair
and read their own copy: the match list frozen into the `form_submission` notification. That copy
never learns about an answer given elsewhere, and the form screen's «No es esta persona» isn't saved
at all, so it comes back on reload.

Jon's direction (2026-11-05): **a form match is just another possible duplicate.**

## Goals

1. One record per "same person?" question: the duplicate pair. Every screen reads it; every answer writes it.
2. An answer given anywhere clears the question everywhere, for everyone (one shared reality).
3. A person with a pending question looks the same on every screen, whether the question came from a form, an import, a household or a Scan.
4. The form screen's back link returns to where the rescuer came from.

## Non-goals

- No change to how pairs are detected or scored, how merges work, or the cross-team «Pedir unir» flow.
- Rewording the other surfaces is step 3 (below), not part of step 1.
- No change to what the form screen shows besides the match banner and the back link (answers, semáforo, contract stay).

## Anti-goals (would be a failure even if it "works")

- A pending question visible on one screen and invisible on another.
- Two different answers to the same pair (dismissed in the list, still asked on the form).
- Removing «Por revisar» but leaving the person without any marker on the list.

## What the rescuer experiences

| Case | Today | After |
|---|---|---|
| Form arrives, looks like an existing profile | Row: «Por revisar» → form screen. Profile: nothing. Home: «1 formulario por revisar» | Row: the profile's own bar «Posible duplicado de Jonathan Urfalino · Revisar» (44 px button) → «Pendientes de revisar», scrolled to that pair. Profile: «Posible duplicado de Jonathan Urfalino · Revisar». Home: counted in «N pendientes de revisar». Form screen: still shows «Encontramos un perfil parecido» with the same pair |
| Rescuer says «No es esta persona» on the form screen | Hides the card until reload; nothing saved | Same as «Mantener separados»: the pair is dismissed. Gone from the form screen, the list, the profile, the pill and the homepage |
| Rescuer says «Mantener separados» in the list (Pedro's case) | Form still says «Por revisar» | Form screen shows no pending match; nothing else marks Pedro |
| Rescuer says «Es la misma persona» / «Unir perfiles» | Merges (unchanged) | Unchanged |
| Rescuer opens the form screen from Mis adoptantes / Pedro's profile / an animal's applicants / a notification | «← Mis animales» always | «← Mis adoptantes» / «← Pedro Paez» / «← <animal name>»; from a notification or a direct link, «← Mis adoptantes» |

Removed: the «Por revisar» filter and pill on /my-adopters, and the homepage line «N formularios por revisar». «Por formulario» stays.

## Decided (Jon)

- A form match is a possible duplicate; one list, one answer (2026-11-05).
- The form screen stays where you read the answers and can still decide there.
- Back goes back to the source screen (also `docs/ux-ui-guidelines.md` §2.2: back-nav names its source).

## Builder's calls (Claude, technical; listed so Jon can check them)

1. **Source of the form banner.** The form screen lists the pending pairs of the form's own profile (the auto-created one), using the same filter as «Pendientes de revisar» and the profile banner: pending, both sides alive, not housemates, not low confidence. The notification's `matchedAdopters` stops being read for this purpose (it stays as the notification's history).
2. **«No es esta persona»** on the form screen calls the existing `dismissDuplicateCandidate` for that pair. It is the same action as «Mantener separados», with the same permissions. No new server action.
3. **«Es la misma persona»** keeps calling `linkFormToExistingAdopter`. Its guard (`planFormLink`: "target must be a recorded match") changes to "target must be a pending pair of the form's profile", so the guard and the banner can't disagree.
4. **`needsReview` is dropped.** The row gets the normal «Posible duplicado» pill from its pending pair. Today that pill is *suppressed* when the form needs review; with `needsReview` gone the suppression goes too. `formResultsView`'s `review_matches` banner is derived from the pending-pair count.
5. **Back link.** Each entry link adds `?from=` (`adopters`, `adopter:<id>`, `animal:<id>`). The form screen renders the matching label, falling back to «Mis adoptantes». The id in `from` is only used for the label and link, never trusted for access.
6. **Contract screen, full parity.** /contract-results asks the same question the same broken way: cards from the notification's `matchedAdopters`, an unsaved «No es esta persona», and `attachContractToExistingAdopter` checked against `recordedMatchIds`. It gets all of calls 1–3: cards from the new profile's pending pairs, «No es esta persona» = `dismissDuplicateCandidate`, attach guard = "pending pair of the contract's profile". Otherwise «Mantener separados» in the list would never clear the contract card (anti-goal 2).
8. **Also aligned:** `linkFormSubmissionToAdopter`'s match check follows the same pair rule. When a person has several pairs, the row pill scrolls to the newest. The admin orphan-submissions entry uses the «Mis adoptantes» fallback.

## Decided after the builder check (Jon, 2026-11-05)

- **Teammates answer both ways, everywhere.** The team acts as one. A pair where someone on the viewer's team loaded a side:
  - is listed in the viewer's «Pendientes de revisar» and counted on their homepage;
  - can be answered there with «Mantener separados» / «No es esta persona» and with «Unir» / «Es la misma persona».

  Today both `getPendingDuplicatesForUser` and `dismissDuplicateCandidate` are scoped to the person who loaded a side; both widen to that person's team (OR of `eq`, no `IN`, failing closed on an empty team). This applies on every surface, not just forms. It is security-adjacent, so **an independent review must come back before production**.
- **Contract «¿Ninguna coincide? → Continuar con el perfil nuevo» records nothing** (as today). Walked through four cases: recording on that click helps only when every match is clearly someone else, and costs only a few clicks there; when it's wrong it is permanent (a dismissed pair is never suggested again and can't be reopened) and decides for other teams. Matches stay pending until someone answers each one.
- **No data migration** (builder's call 7): Production has 0 form submissions; staging has 13 (2 still on their own profile). Pairs for them already exist or were dismissed; nothing to backfill.


## CX additions (Jon approved 2026-11-05, prototype `proto-shots/misma-persona/index.html`)

Evidence (production, last 60 days, excluding Jon): Mis adoptantes opened 4× by 1 person; 4 pair answers by
rescuers, 2 by the admin; 0 merge requests ever; 126 open visible pairs (110 inside the Catpuccino import
account); 0 form or contract submissions ever. 14 screens ask "same person?", and only «Pendientes» saves a «no».

1. **One bar on the card and on the profile.** A person with an open pair shows, on their /my-adopters card,
   the same component as the profile bar (`AdopterProfileV2` «Posible duplicado de X · Revisar», 44 px
   button) instead of the 23 px pill. «Revisar» opens that pair in «Pendientes de revisar» (newest pair when
   several). The «Por revisar» filter/pill go.
2. **Household «No, es otra persona» is saved.** Today nothing records it, and the next Scan pairs the new
   profile with the very candidate the rescuer rejected (seen in production: pairs detected ~10 min after
   household adds; one shares a document, phone and full name). The rejected candidate ids travel with the add;
   once the new profile exists, each (new, rejected) pair is written `dismissed` (resolved_by = actor), so the
   Scan's dismissed-key skip and the factory's existing-pair skip both hold. «Sí» unchanged.
3. **Measure the answers.** One PostHog event per answer, `same_person_answered`, with
   `{ surface, answer: 'same' | 'different', own: boolean }`. No names, ids or contact values.
   Surfaces in step 1: pendientes, form_results, contract_results, household, profile_bar (the «Revisar» click,
   as `opened`).
4. **Ship in three steps.**
   - **Step 1 (now):** the design above, plus additions 1–3.
   - **Step 2:** teammates answer both ways. This includes the «Pendientes» section and the profile bar's
     «Revisar» for team pairs. Today a teammate sees «Posible duplicado» in the list, but has no «Pendientes»
     section and gets a blue bar with no «Revisar». It ships after an independent security review returns.
   - **Step 3:** wording (copy only; see addition 5).
5. **One way to ask (step 3).** Question «¿Es la misma persona?», concept «Posible duplicado», buttons
   «Sí, es la misma persona» / «No, es otra persona» on all 14 screens. The consequence (merge, add data, keep
   separate) stays in the confirmation. The profile bar looks the same for every viewer. /contract-results and
   the sheet import's Duplicados step move to i18n. Jon OK'd the page's proposal ("ok proceed"); exact strings
   are re-confirmed when step 3 starts.

Not changed: the contact-already-on-another-profile window's «No es esta persona» stays local (Jon 2026-10-29).
Revisit it in step 3 if Jon wants.

## Consistency rule (Jon 2026-11-06: "functionality should be CONSISTENT"; "don't cut the scope, do it right")

**Any «no, it's not this person» about a specific profile is saved the same way — permanently, for
everyone — as soon as both profiles exist.** Buttons that only move on («Continuar con el perfil
nuevo», «Crear igualmente») answer nothing and save nothing.

**Who may answer** (same as «Mantener separados» today): the person who loaded either profile, or an
admin. Step 2 widens this to their teammates. Someone who may not answer can still move on: their
«No» doesn't settle the pair, the question goes to the owners' «Pendientes», and they are told so.

| Screen | Before | After |
|---|---|---|
| «Pendientes» «Mantener separados» | saved | saved |
| Form / contract «No es esta persona» | saved (step 1) | saved; button only for who may answer |
| Household «No, es otra persona» | saved (step 1) | saved when they may answer; otherwise the pair is opened for the owners and the helper sees «Agregamos a {name}. Le preguntamos a {owners} si es la misma persona que {other}.» |
| Contact already on another profile («Ya está en otro perfil» → «No es esta persona») | forgotten on reload (Jon 2026-10-29: local only) | saved. **Reverses the 2026-10-29 decision** (Jon OK'd 2026-11-06). Who may not answer: as the household case |
| Post import «No es esta persona» | forgotten | saved for each rejected profile once «Crear un perfil nuevo» has created the person |
| New-profile form «No es esta persona» | forgotten | saved for each rejected profile once the new profile is saved |

Confirmed by Jon 2026-11-06 with examples: (1) a form match that the duplicate check no longer finds
stops asking, as every other pair does; (2) a helper's household «No» doesn't settle a pair whose two
profiles they didn't load.

## Known edge, accepted

The admin Scan rebuilds every pending pair by its own rules. A form pair the Scan's rules don't
reproduce disappears after a Scan, and the form stops asking. This is the same for every pair today,
and it is the price of one shared answer.

## Surfaces touched

- `src/components/FormResultsContent.tsx`, `src/app/form-results/[submissionId]/page.tsx`: banner from pairs, persisted «No es esta persona», back link
- `src/components/ContractResultsMatchCard.tsx` (+ its page): persisted «No es esta persona»
- `src/domain/formLink.ts`: `planFormLink` guard, `formResultsView` input, `summarizeAdopterForms` without `needsReview`
- `src/app/actions/formSubmission.ts`: `linkFormToExistingAdopter` guard
- `src/app/my-adopters/page.tsx`, `src/app/actions/dashboard.ts`: remove «Por revisar» filter/pill and the pill suppression
- `src/lib/homeModulesData.ts`, `src/components/home/HomeModules.tsx`, `src/types/homeModules.ts`: remove `formsToReview`
- Entry links: `my-adopters/page.tsx`, `AdoptionHistory.tsx`, `AnimalApplicants.tsx`, `ApplicantDetailPanel.tsx`, `OrphanSubmissionsSection.tsx`, notification URL in `api/form/[userId]/submit/route.ts`
- i18n es/en/pt: remove `myAdopters.form_needs_review*`, `homeModules.forms_review_*`, `myAdopters.review_empty`; add back-link labels
- Household: `src/components/household/PersonForms.tsx` (pass rejected ids), `src/lib/householdPeople.ts` / `src/app/actions/households.ts` (write dismissed pairs)
- Card bar: `src/app/my-adopters/page.tsx` (reuse the profile bar component, extracted)
- Events: a small `trackSamePersonAnswer` helper next to the existing PostHog calls
- Tests: `src/domain/formLink.test.ts`, `tests/my-adopters-forms.authed.spec.ts`, `tests/form-results-link.authed.spec.ts`, homepage spec; new e2e: answer on one screen, check it's gone on the others

## Verification

- e2e: a form that matches an existing profile → the row shows «Posible duplicado», the profile shows the banner, the form screen shows the match. «No es esta persona» on the form screen → all three gone after reload. Same starting from «Mantener separados» in the list.
- Back link from each of the 4 entry points.
- Household: «No» on a candidate → no pending pair between the two, even after a Scan.
- Card bar: 44 px «Revisar», measured at 390 px.
- Staging: Pedro Paez shows no pending match; his row has no «Por revisar».
