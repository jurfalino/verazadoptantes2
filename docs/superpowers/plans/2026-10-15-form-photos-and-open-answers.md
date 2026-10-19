# Adoption form — Releases 2 (photos) and 3 (open vs closed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (Jon asked to "finish phases 2 and 3"; Native, as release 1). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a rescuer ask for photos of the home's protection (and an optional photo of where the animal sleeps), and choose, per question, whether applicants answer with options or free text.

**Architecture:** Same storage of settings as release 1 — new finite tokens in `adoption_doc_settings.hidden_steps` (`on:photos`, `photos-required`, `way:<id>:open`), so the per-key compare-and-swap saves keep working. Photos follow the selfie exactly: compressed on the phone, stored privately (`contractStorage`), tagged with the submission, keys in a server-only column (`form_submissions.photo_keys`, migration 0087), served only by an access-checked route. An open answer is stored as `{ open: "<text>" }` under the question's key, so it can never be mistaken for an option value by the semáforo.

**Spec:** `docs/superpowers/specs/2026-10-14-form-new-topics-design.md` §4 (photos rows), §6, §6.0, §6.1, §7, §9 items 2–3.

## Global Constraints

- Everything from release 1's plan (`2026-10-14-form-new-topics-release-1.md`): three locales, no `inArray`, logging rules (never log photo data or open text), explicit `git add` paths, version above `origin/staging`, lint ratchet.
- Storage keys never leave the server (`src/lib/selfieLink.ts` principle): the client sees `/api/files/form-photo/{submissionId}/{n}` only.
- Nothing reaches production applicants while custom forms is off (null config → today's form, no photos, all closed).
- Photos: JPEG/PNG/WebP, ≤ 5 MB each after the phone shrinks them (same limits as the selfie), at most 3 protection photos + 1 sleep photo.

## Review Focus

1. **A forged submit** with 50 photos, non-images, or a 20 MB data URL — expected: at most 3 + 1 stored, others dropped with a warning; non-images refused; the submission still lands.
2. **A gift form with photos required** — expected: never required (the giver may not have access to the recipient's home); still offered.
3. **An open answer that reads like an option** ("yes", "no") — expected: shown as the applicant's text, no semáforo dot.
4. **A draft resumed after photos were added** — expected: the draft still saves (photos are not kept in drafts — localStorage would overflow); the applicant re-adds them.
5. **A stranger fetching `/api/files/form-photo/{id}/0`** — expected: 404, same as the selfie route.

---

## Part A — Photos (release 2)

### Task A1: Settings tokens for photos
- Files: `src/domain/adoptionDocs.ts`, `contract-app/src/lib/adoptionDocs.ts` (mirror), tests.
- Add `'on:photos'` and `'photos-required'` to `FORM_OPTION_TOKENS` (both copies, same order, after the release-1 tokens). Add `photosOn(hidden)`, `photosRequired(hidden)` (required only counts when on) to both copies. `settingChange`: `on:photos` present → `'asked'`; `photos-required` present → `'photosRequired'` / absent → `'photosOptional'` (new SettingChange members + i18n keys `adoptionDocs.photos_state_required/optional`).
- Tests (RED first): sanitiser keeps both; `photosRequired(['photos-required'])` is false without `on:photos`; mergeHidden keeps them; settingChange cases.

### Task A2: Storage, submit and the access-checked route
- Files: `drizzle/0087_form_photo_keys.sql` (`ALTER TABLE form_submissions ADD COLUMN photo_keys TEXT;`), `src/db/schema.ts` (`photoKeys: text("photo_keys")`), `src/lib/contractStorage.ts` (`storeFormPhoto(data, type, submissionId, kind: 'protection' | 'sleep')`, `readFormPhoto(key, submissionId)` — same checks as the selfie, prefix `form-photos/`), `src/domain/formPhotos.ts` (pure: `parsePhotoInputs(body) → { protection: DataUrl[] (≤3), sleep: DataUrl | null, dropped: number }`, `photoLinks(submissionId, keysJson) → { protection: string[]; sleep: string | null }`), `src/app/api/form/[userId]/submit/route.ts`, `src/app/api/files/form-photo/[submissionId]/[n]/route.ts`, loaders `src/app/form-results/[submissionId]/page.tsx`, `src/app/actions/formSubmission.ts`, `src/app/actions/applicants.ts` (return `photoLinks`).
- Submit: parse, store each (failures logged + counted, never fail the submission), write `photo_keys` as JSON `[{ kind, key }]`, replace the answers' photo fields with counts (`protectionPhotos: n`, `sleepPhoto: true`) so answers_json carries no image data, respond `photosSaved: false` when any failed (the form shows a toast with an error ID, like the selfie).
- Route: auth → row → `canAccessFormSubmission` → n-th key → `readFormPhoto` (metadata must match) → same headers as the selfie route. 404 for everything else.
- Tests: unit for `parsePhotoInputs` / `photoLinks` (limits, junk, order); e2e: submit 2 small PNGs via API → owner GETs `/api/files/form-photo/{id}/0` = 200 image, `/2` = 404; an unrelated user (the `user` storage state) gets 404; answers_json has no `data:` string.

### Task A3: Public form — photo pickers
- Files: `contract-app/src/lib/imageShrink.ts` (extract the selfie's resize: `shrinkImage(file): Promise<string>` JPEG ≤1600 px, q 0.8), `contract-app/src/components/PhotoPicker.tsx`, `PetShieldForm.tsx`, catalog keys, CSS.
- Under "¿El espacio está protegido?" when `photosOn`: "Sacá fotos de las protecciones (balcón, ventanas, rejas)" — up to 3 thumbnails with remove buttons; required → Continue needs ≥1 unless it's a gift. Under "¿Dónde va a dormir?" when `photosOn`: one optional photo. Gift wording with `{n}`.
- Drafts: `persist` drops `protectionPhotos` / `sleepPhoto` (localStorage would overflow and the whole draft would be lost). Ruling recorded.
- Submit body carries `protectionPhotos: string[]`, `sleepPhoto: string`; `stripUnaskedNewAnswers` drops them when photos are off or the host question wasn't asked.
- Tests: unit (draft strip helper, required rule incl. gift, stripping); browser check at 390 & 1280 (add 2 photos, remove 1, required blocks Continue, gift doesn't).

### Task A4: Display
- Files: `src/components/FormResultsContent.tsx`, `src/components/ApplicantDetailPanel.tsx`, `src/components/FormPhotos.tsx`, i18n.
- "Fotos de las protecciones" and "Dónde duerme (foto)" rows: thumbnails (`<a target="_blank">` to the full image), lazy-loaded, alt text.
- e2e: the results page shows 2 thumbnails whose `src` is the access-checked route.

### Task A5: Settings
- Files: `FormStepsEditor.tsx`, i18n.
- Under the "Espacios protegidos" row (when on): switch "Pedir fotos" (`on:photos`), and under it "Obligatorias" (`photos-required`, only when photos are on). Conflict/updated-by banners via `settingChange`.
- e2e: turn both on → stored `['on:photos', 'photos-required']` → public config carries them → off again → `[]`.

## Part B — Open vs closed (release 3)

### Task B1: Settings tokens for "Cómo preguntar"
- Files: both `adoptionDocs.ts`, `formQuestions.ts`, tests, mirror.
- `OPEN_CAPABLE_STEPS` (spec §6.0): `isSafe, hoursAlone, petExperience, willingToSterilize, movingPlans, vacationPlan, rental, sleepPlace, petsCare, sterilizeHow, catOutdoor, dogWalks, dogTied, gaveAway, returnReasons, adaptPlan, carer` (+ `lastAnimal`/`movingIfNoPets` through their rows). Tokens `way:<row>:open` for each, appended to `FORM_OPTION_TOKENS` (both copies).
- `questionWay(row, hidden)` returns `'new' | 'old' | 'open'` for petExperience/movingPlans, `'closed' | 'open'` otherwise; `setQuestionWay` keeps the row's tokens mutually exclusive. `isAskedOpen(stepId, hidden)` — variants resolve to their row. `settingChange`: `way:*:open` → `'openWording'` / `'closedWording'`.
- Tests: tokens sanitised, exclusivity, variant resolution, a closed-only question (`visitConsent`) has no open token.

### Task B2: Public form — open questions
- Files: `PetShieldForm.tsx`, `FollowUps.tsx`, `formQuestions.ts`, catalog (`form.open_placeholder`).
- A step asked open renders as a text area with the same (gift-adapted) title; answer stored as `{ open: text }`; Continue needs non-empty text (same as a closed answer). Follow-ups asked open render a text input under their host. "No sé" doesn't apply to open questions.
- Tests: unit (`isAskedOpen` with null config = never open; answer shape); browser check.

### Task B3: Server and display
- Files: submit route (clamp `{ open }` to 500 chars, drop other object shapes for open-capable keys), `FormAnswersPanel.tsx` (`renderFormAnswerValue` returns the text for `{ open }`; `answerSignal` already returns null for objects — add a test), tests.
- e2e: submit `{ gaveAway: { open: 'yes' } }` → results row shows "yes" as text, no dot.

### Task B4: Settings — "Cómo preguntar"
- Files: `FormStepsEditor.tsx`, i18n (`adoptionDocs.way_closed`, `way_open`, `way_state_open`, `way_state_closed`).
- Open-capable rows show a two-option radio (Opciones / Texto libre) when on; petExperience/movingPlans show three (recomendada / simple / texto libre).
- e2e: choose "Texto libre" on rental → stored `['way:rental:open']` → public config carries it.

### Task C: Verification, version, changelog, review
- tsc, vitest (app + contract-app), lint ≤ ratchet, both builds, action surface, the related e2e specs, browser checks; migration 0087 applies on the local DB; version above origin/staging; CHANGELOG; independent whole-branch review before staging push.
