# A form match is a possible duplicate — Step 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One record and one answer for "same person?": form and contract matches come from the duplicate pair, a «no» is saved everywhere it's asked (form, contract, household), a pending person shows the same bar on their card and profile, and answers are measured.

**Architecture:** `duplicate_candidates` stays the only store. A new data-access helper (`loadOpenPairs`) is the single read used by the profile bar, the form screen and the contract screen. Answers write through the existing `dismissDuplicateCandidate` (form/contract) or a new `recordSeparatePairs` helper (household). The UI reuses one extracted `PendingDupBar` component. Teammate-wide answering is step 2, not here.

**Tech Stack:** Next.js 15 App Router, React, Cloudflare D1 via drizzle, vitest (domain), Playwright (e2e), PostHog through `zarazTrack`.

**Spec:** `.agents/plans/2026-11-05-form-matches-are-duplicates.md` (read it first: «Builder's calls», «CX additions»)

## Global Constraints

- D1: never `inArray()` / `IN ${array}`; OR-of-`eq` or `Promise.all` fan-out (CLAUDE.md «D1 Compatibility»).
- Every catch logs with the op's context; no silent `.catch(() => [])`. User-facing errors carry an errorId (`resolveErrorId(e, source)`), messages via `userFacingMessage` / `handledAsStale` (`src/lib/errorMessage.ts`).
- i18n: every key in `src/i18n/locales/es.ts`, `en.ts`, `pt.ts`.
- Themed Tailwind colors only; SVG icons; tap targets ≥ 44 px (`docs/ux-ui-guidelines.md` §1.5).
- No new server action unless unavoidable (EXPECTED_ACTIONS ratchet in `scripts/check-action-surface.mjs`, currently 174). This plan adds none.
- Analytics: event `same_person_answered`, props `{ surface, answer, own }` only. Never names, ids, contacts.
- e2e selectors locale-agnostic (data-testid); destructive e2e rows use `test-*-fixture-*` ids or `createProfileViaApi`; never `git add -A` (local.db / .wrangler sqlite are tracked seeds).
- Teammates: in step 1 the permission rules are unchanged. A viewer who isn't on the pair's list (`onViewerList === false`) sees the match but no «No es esta persona», like the profile bar today.

## Review Focus

1. **Pair answered elsewhere while the form tab is open:** «Es la misma persona» must refuse (`not_a_match`) with an error toast that has an errorId, and the page must refresh to show no match. Test in Task 3.
2. **Teammate opens a team form:** sees the cards and can still merge (as today), but has no «No es esta persona». Test in Task 3.
3. **Household, «No» on the first candidate and «Sí» on the second:** no profile is created, so nothing is recorded. The «no» is written only when a new profile is created. Test in Task 8.
4. **Forged `rejectedProfileIds`** (an id the household check never offered): ignored and logged at warn; no row is written. Test in Task 8.
5. **A person with two pending pairs:** the card bar says «… y 1 más», and «Revisar» opens the newest pair. Test in Task 5.

---

### Task 1: `loadOpenPairs`, the single pair read

**Files:**
- Create: `src/lib/openPairs.ts`
- Modify: `src/app/actions/duplicates.ts:270-345` (`getDuplicateCandidates` delegates)
- Test: `tests/duplicates.spec.ts` (existing profile-bar test must stay green)

**Interfaces:**
- Produces: `loadOpenPairs(db: Db, adopterId: string, viewer: string, opts?: { limit?: number; includeLow?: boolean }): Promise<DuplicateCandidate[]>`. It's the body of today's `getDuplicateCandidates`, with the same filters (pending, other side alive, not housemates, viewer's hidden pairs only affect `onViewerList`) and the same sort. Low-confidence pairs are dropped unless `includeLow`. Default limit 5. It throws on D1 errors; callers log.
- `DuplicateCandidate` type moves to `src/types/duplicates.ts` and is re-exported from `duplicates.ts`.
- `getDuplicateCandidates(adopterId)` = session check + `loadOpenPairs(db, adopterId, viewer, { includeLow: true })` inside its existing try/catch. `AdopterProfileV2` still drops low on its side.

- [ ] **Step 1:** Move the query into `loadOpenPairs`. `getDuplicateCandidates` calls it.
- [ ] **Step 2:** Run `npx tsc --noEmit` (clean), then `npx playwright test tests/duplicates.spec.ts -c playwright.local.config.ts --project=authed --workers=1 --no-deps`. Expected: PASS.
- [ ] **Step 3:** Commit `refactor: loadOpenPairs — one read for a profile's open pairs`.

### Task 2: Domain — the guard reads open pairs; `needsReview` goes

**Files:**
- Modify: `src/domain/formLink.ts`
- Test: `src/domain/formLink.test.ts`

**Interfaces:**
- `planFormLink` input field `recordedMatchIds` is renamed `openPairIds: readonly string[]` ("the other side of every pending pair of the form's own profile; for an `unlinked` form, the ids recorded at submit"). Logic unchanged.
- `canLinkSubmissionDirectly` input `isRecordedMatch` is renamed `isOpenPair`.
- `AdopterFormSummary` loses `needsReview`. `summarizeAdopterForms(forms, viewerEmail)` takes 2 params (no `liveMatchCount`).

- [ ] **Step 1: Failing tests.** In `formLink.test.ts`:
  - `planFormLink({ …, openPairIds: ['m1'] })` with target `m1` → `{ ok: true, op: 'merge', orphanId: auto }`.
  - target `m2` not in `openPairIds` → `{ ok: false, reason: 'not_a_match' }`.
  - `summarizeAdopterForms(forms, 'me@x')` returns `{ count, latest }` and `'needsReview' in result === false`.
  - Delete the old `needsReview` cases (lines ~124-158).
- [ ] **Step 2:** `npx vitest run src/domain/formLink.test.ts`. Expected: FAIL (old param names).
- [ ] **Step 3:** Rename the fields and drop `needsReview` and the `liveMatchCount` param. Fix the callers' compile errors only by passing the new names. Real data wiring comes in Tasks 3–6.
- [ ] **Step 4:** Vitest PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit `domain: form link guard reads open pairs; drop needsReview`.

### Task 3: Form screen reads pairs; «No es esta persona» is saved

**Files:**
- Modify: `src/app/form-results/[submissionId]/page.tsx:133-345`, `src/components/FormResultsContent.tsx`, `src/components/FormResultMatchCard.tsx`, `src/app/actions/formSubmission.ts` (`linkFormToExistingAdopter` ~:237-423 and `linkFormSubmissionToAdopter`)
- Test: `tests/form-results-link.authed.spec.ts` (update), new `tests/form-match-one-answer.authed.spec.ts`

**Interfaces:**
- Consumes: `loadOpenPairs` (Task 1); `planFormLink({ openPairIds })` (Task 2); existing `dismissDuplicateCandidate(candidateId)`.
- `MatchedAdopter` (FormResultsContent) gains `candidateId: string | null` and `canAnswer: boolean` (= `onViewerList`).
- Page match source, by `linkKind`:
  - `new_profile`: `loadOpenPairs(db, submission.autoAdopterId, currentUser)`, mapped to `{ id: otherAdopterId, name, matchTypes, score, candidateId: id, canAnswer: onViewerList }`.
  - `linked_existing`: `[linkedId]` only (the chosen profile's card; `canLink` false).
  - `unlinked`: the notification's `matchedAdopters`, as today (`candidateId: null`, `canAnswer: false`).
- `linkFormToExistingAdopter` and `linkFormSubmissionToAdopter` build `openPairIds` the same way (server-side, never from the client).
- `FormResultMatchCard` gets `onDismiss` only when `canAnswer && candidateId`. Click → `dismissDuplicateCandidate(candidateId)`:
  - ok → remove the card and `router.refresh()`;
  - `!ok` → toast with `resolveErrorId(…, 'FormResultMatchCard.dismiss')` and the translated `errors.dedup_*` code.
- The «No es esta persona» button testid stays `form-match-not-this` (add it if it doesn't exist).

- [ ] **Step 1: Failing e2e** (`form-match-one-answer.authed.spec.ts`). Setup: admin profile `Existe ${stamp}` with phone P via `createProfileViaApi`; submit the public form with the same phone (follow `form-results-link.authed.spec.ts` setup). Tests:
  - `«No es esta persona» on the form is saved`: click it, reload → `form-status-banner` has `data-state="new_profile"`, and `rows("SELECT status FROM duplicate_candidates WHERE …")[0].status === 'dismissed'`.
  - `«Mantener separados» in the list clears the form`: dismiss via `/my-adopters#pendientes` (`dedup-row` → «Mantener separados») → the form page shows `data-state="new_profile"` with no match card.
  - `answered elsewhere while open → «Es la misma persona» refuses`: open the form; dismiss the pair via SQL; click «Es la misma persona» → error toast containing `Error ID`; after refresh, no match card. (Review Focus 1)
  - `teammate sees the card without «No es esta persona»`: org with admin + USER_EMAIL (pattern from `adoption-docs-collab.authed.spec.ts`); as user → the card is visible and `form-match-not-this` count is 0. (Review Focus 2)
- [ ] **Step 2:** Run it. Expected: FAIL (the first test: card returns after reload).
- [ ] **Step 3:** Implement the page source, the props and the card dismiss.
- [ ] **Step 4:** Run the new spec plus `form-results-link.authed.spec.ts` and `form-results-masking.authed.spec.ts`. Expected: PASS. Update `form-results-link` only where it asserted notification-based matches.
- [ ] **Step 5:** Commit `form results: matches are the profile's open pairs; «No es esta persona» is saved`.

### Task 4: Contract screen parity

**Files:**
- Modify: `src/app/contract-results/[notificationId]/page.tsx:80-240`, `src/components/ContractResultsMatchCard.tsx`, `src/app/actions/duplicates.ts:42-110` (`attachContractToExistingAdopter` guard)
- Test: `tests/contract-storage.authed.spec.ts` or a new `tests/contract-match-one-answer.authed.spec.ts` (follow the existing contract submit fixture)

**Interfaces:**
- Consumes: `loadOpenPairs`, `dismissDuplicateCandidate`.
- Cards come from `loadOpenPairs(db, metadata.adopterId, currentUser)`. The attach guard checks that `matchAdopterId` is the other side of an open pair of `metadata.adopterId` (replacing `recordedMatchIds`).
- `ContractResultsMatchCard` gets `candidateId`/`canAnswer`. «No es esta persona» (`contract-match-not-this`) calls `dismissDuplicateCandidate`, with the same success and failure handling as Task 3.
- «¿Ninguna coincide? → Continuar con el perfil nuevo» is unchanged: it records nothing (spec decision).

- [ ] **Step 1: Failing e2e:** «No es esta persona» on a contract → after reload the card is gone and the pair status is `dismissed`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS, plus the existing contract specs PASS.
- [ ] **Step 5:** Commit `contract results: open pairs, saved «No es esta persona»`.

### Task 5: The same bar on the card and the profile; «Por revisar» goes

**Files:**
- Create: `src/components/PendingDupBar.tsx` (extracted from `AdopterProfileV2.tsx:441-466`)
- Modify: `src/components/AdopterProfileV2.tsx`, `src/app/actions/dashboard.ts:195-210, 440-490`, `src/app/my-adopters/page.tsx` (types :60-70, filter :365-380, pills :155-180 / :525 / :632, mobile card :610-640)
- Test: `tests/my-adopters-forms.authed.spec.ts` (update), `tests/duplicates.spec.ts` (bar unchanged on the profile)

**Interfaces:**
- `PendingDupBar({ adopterId, pairs, testId }: { adopterId: string; pairs: Array<{ otherAdopterId: string; otherAdopterName: string; onViewerList: boolean }>; testId?: string })`:
  - renders today's profile bar exactly (copy, tones, `profile-pending-dup*` testids by default);
  - «Revisar» links to `/my-adopters?pair=<pairKey(adopterId, first onViewerList pair)>#pendientes`, keeping today's link format;
  - the button stays at least 44 px tall.
- The dashboard row replaces `hasPendingDuplicate: boolean` with `pendingDuplicates: Array<{ otherAdopterId; otherAdopterName; onViewerList }>`, newest pair first:
  - names are fetched per other id with OR-of-eq or a `Promise.all` of `eq`;
  - `onViewerList` = the viewer loaded either side and hasn't hidden the pair (same test as `loadOpenPairs`);
  - `formNeedsReview` is removed.
- My-adopters:
  - mobile card: renders `<PendingDupBar testId="row-pending-dup-bar" …/>` at the card's bottom, outside the card's `<Link>`, when `pendingDuplicates.length`;
  - desktop row: keeps `PendingDupPill`, now an `<a>` to the same `?pair=` URL;
  - `NeedsReviewPill`, the `review` filter and its `toReview` are deleted.

- [ ] **Step 1: Failing e2e** (update `my-adopters-forms.authed.spec.ts`):
  - `a form match shows the profile's bar on the card, 44px`: at 390×844, the card has `row-pending-dup-bar`; `(await bar.getByRole('link', { name: /Revisar|Review/ }).boundingBox()).height >= 44`; there's no `row-needs-review`; the filter strip has no `review` chip.
  - `two pairs: «y 1 más», Revisar opens the newest` (Review Focus 5): two pending pairs on one profile → the bar text matches `/1/`, and the link `href` contains the newest pair's key.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Extract the component, change the dashboard shape and the page.
- [ ] **Step 4:** Run the updated spec plus `duplicates.spec.ts` plus `pendientes-d.authed.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Grep all of `tests/` for `row-needs-review|form_needs_review|filtro=por-revisar|Por revisar` and fix every hit (memory: grep tests before deleting UI).
- [ ] **Step 6:** Commit `my-adopters: the profile's duplicate bar on the card; remove «Por revisar»`.

### Task 6: Homepage — one count

**Files:**
- Modify: `src/types/homeModules.ts`, `src/lib/homeModulesData.ts:98-119`, `src/components/home/HomeModules.tsx:167-188`
- Test: `tests/home-modules.user.spec.ts`

**Interfaces:**
- `HomeAdoptersData` loses `formsToReview`. `hasTodo = d.pendingReview > 0`. The `home-adopters-forms` row and `formsToReviewP` are deleted.

- [ ] **Step 1: Failing assertion** in the home spec: `home-adopters-forms` has count 0 even when a form match is pending, and `home-adopters-pending` counts it.
- [ ] **Step 2:** FAIL → **Step 3:** delete the field and the row → **Step 4:** PASS, `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit `home: form matches count as «pendientes de revisar»`.

### Task 7: Back link names its source

**Files:**
- Create: `src/domain/formBackLink.ts` (+ `src/domain/formBackLink.test.ts`)
- Modify: `src/components/FormResultsContent.tsx:213-217`; entry links in `src/app/my-adopters/page.tsx:113`, `src/components/AdoptionHistory.tsx:500`, `src/components/AnimalApplicants.tsx:303`, `src/components/ApplicantDetailPanel.tsx:151,335`; the page reads `searchParams.from`.

**Interfaces:**
- `formBackLink(from: string | null, names: { adopter?: string | null; animal?: string | null }): { href: string; label: { key: string; name?: string } }`:
  - `from` is `'adopters'` | `'adopter:<id>'` | `'animal:<id>'`; anything else (or a missing name) falls back to `/my-adopters` with `formResults.back_to_adopters`;
  - `adopter:<id>` → `/adopter/<id>`, label `formResults.back_to_name` with `{name}`;
  - `animal:<id>` → `/my-animals/<id>` (check the real animal route), label `back_to_name` with the animal's name;
  - ids must match `/^[A-Za-z0-9_-]{1,64}$/`, else fall back.
- The page resolves the name server-side (adopter: the form's own profile name; animal: `selectedAnimalId`'s name), only when it matches the form, so `from` can't relabel the page with an arbitrary name.
- i18n (es/en/pt): `formResults.back_to_adopters` «Mis adoptantes» / «My adopters» / «Meus adotantes»; `formResults.back_to_name` «{name}». Remove `back_to_animals` if nothing else uses it (grep first).

- [ ] **Step 1: Failing vitest:** 5 cases, one per branch plus a malformed id → fallback.
- [ ] **Step 2:** FAIL → **Step 3:** implement and wire the entry links (`?from=…`) → **Step 4:** vitest PASS. Add one e2e assertion to `my-adopters-forms.authed.spec.ts`: open the form from the row's «Formulario …» link → the back link text matches `/Mis adoptantes|My adopters/` and its href is `/my-adopters`.
- [ ] **Step 5:** Commit `form results: back link names where you came from`.

### Task 8: Household «No, es otra persona» is saved

**Files:**
- Modify: `src/components/household/PersonForms.tsx:240-300` (collect rejected ids in `no()`, send on `add()`), `src/app/actions/households.ts:330-…` (`AddHouseholdPersonInput.rejectedProfileIds?: string[]`), `src/lib/mergeRequests.ts` (next to `keepSeparate`)
- Test: `tests/households.user.spec.ts` (new numbered test)

**Interfaces:**
- `recordSeparatePairs(db: Db, newId: string, otherIds: string[], actor: string, ctx: Record<string, unknown>): Promise<void>` in `src/lib/mergeRequests.ts`:
  - for each other id, if a row exists for the pair (either orientation): pending → `dismissed`, other statuses untouched;
  - otherwise insert `{ id: crypto.randomUUID(), adopter1Id: newId, adopter2Id: other, matchTypes: '[]', score: 0, confidence: 'low', status: 'dismissed', resolvedBy: actor, resolvedAt: now }`;
  - never throws (it logs `error` with ctx, like `keepSeparate`).
- `addHouseholdPerson`:
  - `rejectedProfileIds` are kept only if they're among the ids the server's own household candidate check returns for this input (the same function `PersonForms` calls). Others are dropped with `logger.warn('addHouseholdPerson: rejected id not offered, ignored', { …ctx, dropped: n })`;
  - after a **created** profile (`createdProfile: true`), call `recordSeparatePairs` before the background duplicate indexing runs;
  - when an existing profile was chosen («Sí»), nothing is recorded.
- `PersonForms`: `const [rejected, setRejected] = useState<string[]>([])`; `no()` appends `current.adopterId`; `add()` sends `rejectedProfileIds: rejected` only when creating new; any edit that resets candidates also resets `rejected`.

- [ ] **Step 1: Failing e2e** in `households.user.spec.ts`:
  - `«No, es otra persona» is saved for that pair`: add `Rosa ${stamp}` with `ROSA_PHONE` on Pedro's profile → candidate → «No» → the new profile exists, and `rows(pair between new and ROSA)[0].status === 'dismissed'`.
  - `«No» then «Sí» records nothing` (Review Focus 3): two candidates, «No» then «Sí» → no new profile, and no dismissed row for the first.
  - `a forged rejected id is ignored` (Review Focus 4): call `addHouseholdPerson` through the page's action with `rejectedProfileIds: [unrelatedId]` → no pair row with `unrelatedId`. (If calling the action directly from e2e isn't practical, make this a vitest on the filtering helper; extract `keepOffered(rejected: string[], offered: string[]): string[]` as a pure function in `src/domain/` and test it.)
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** run the household spec (`--project=user`). Expected: PASS.
- [ ] **Step 5:** Commit `household: «No, es otra persona» is saved as a kept-separate pair`.

### Task 9: Measure the answers

**Files:**
- Create: `src/lib/samePersonEvents.ts` (+ `src/lib/samePersonEvents.test.ts`)
- Modify: the answer handlers in `src/components/pendientes/PairRow.tsx` (or its action dispatcher), `FormResultMatchCard.tsx`, `ContractResultsMatchCard.tsx`, `household/PersonForms.tsx` (`no()` and «Sí»), `PendingDupBar.tsx` («Revisar» click)

**Interfaces:**
- `type SamePersonSurface = 'pendientes' | 'form_results' | 'contract_results' | 'household' | 'profile_bar'`
- `trackSamePersonAnswer(surface: SamePersonSurface, answer: 'same' | 'different' | 'opened', own: boolean): void` calls `zarazTrack('same_person_answered', { surface, answer, own })`. Fire it after a successful answer only; never in a catch.

- [ ] **Step 1: Failing vitest:** mock `zarazTrack`; `trackSamePersonAnswer('household', 'different', true)` → called once with `('same_person_answered', { surface: 'household', answer: 'different', own: true })`, and the props object has exactly those 3 keys.
- [ ] **Step 2:** FAIL → **Step 3:** implement and wire. `own` = whether the viewer loaded the other profile: Pendientes uses its row's ownership flag, form and contract use `canAnswer`, household is `true`, the bar uses `onViewerList` → **Step 4:** PASS.
- [ ] **Step 5:** Commit `analytics: same_person_answered`.

### Task 10: Clean-up and release checks

**Files:** `src/i18n/locales/{es,en,pt}.ts`, `CHANGELOG.md`, `package.json`

- [ ] **Step 1:** Remove the now-unused keys from all three locales: `myAdopters.form_needs_review`, `myAdopters.form_needs_review_tooltip`, `myAdopters.review_empty`, `homeModules.forms_review_one`, `homeModules.forms_review_many`. Grep `src/` and `tests/` for each key and its Spanish text first; zero hits must remain.
- [ ] **Step 2:** Run `npx tsc --noEmit`; `npm run lint` (warnings ≤ 125); `npx vitest run`; `node scripts/check-action-surface.mjs` (174 unchanged); `npm run build`.
- [ ] **Step 3:** Run e2e locally (Node 20): `form-match-one-answer`, `form-results-*`, `my-adopters-forms`, `duplicates`, `pendientes-d`, `households` (user), `home-modules` (user), `merge-requests`, `dup-hint` (user). Expected: all PASS (re-run `--last-failed` once for the known flakes).
- [ ] **Step 4:** Version above origin/staging (patch) and a CHANGELOG entry in product terms. Commit by explicit paths. Push to staging only when Jon says.
