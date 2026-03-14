# Adopter Create – Duplicate Detection – Implementation Plan

This plan implements **proactive duplicate detection** on the adopter profile creation screen (`/adopter/create`): soft detection **while typing** (debounced) and a **confirmation step on save** when potential duplicates exist.

---

## UX Summary (from senior UX/UI recommendation)

| Moment | Role | UI |
|--------|------|-----|
| **While typing** | Informative, non-blocking | Card below name/contact: "Possible matching profiles" with list + "Use this profile" / "View". Debounced (e.g. 300–400 ms). |
| **On Save** | Safety net | If backend returns possible duplicates: **modal** before persisting. Actions: "Use existing profile" (primary), "Create new anyway" (secondary), "Cancel". |

Tone: informative ("Similar names in your records"), not alarming. Form always allows creating new; duplicate UI only suggests or asks for confirmation.

---

## Current State

- **AdopterForm** (`src/components/AdopterForm.tsx`) is used on `/adopter/create` (isNew) and `/adopter/[id]` (edit). Create flow: user fills name, contactInfo, etc. and clicks save; `saveAdopter(data)` is called and redirects on success.
- **searchAdopter(query)** (`src/app/actions/search.ts`) accepts a string and returns `SearchResponse { results: SearchResult[], validationError?, truncated?, totalCount? }`. Results are enriched (thumbnail, stats, flags). Used by SearchSection, AdoptionWizard, AdopterFlagging.
- **getDuplicateCandidates(adopterId)** exists for *existing* adopters (system-detected pairs). For *create* we have no adopter id yet, so we use **search** (by name and optionally contact) to find "possible matches."

---

## Implementation Plan

### Phase 1 – While-typing duplicate check (soft, non-blocking)

| # | Task | Details |
|---|------|--------|
| 1.1 | **Trigger and debounce** | In AdopterForm (create mode only), when `data.name` or `data.contactInfo` change, schedule a duplicate check. **Trigger when:** `data.name.trim().length >= 2` (or optionally when name + at least one of contactInfo non-empty). **Debounce:** 350 ms after last change. Cancel pending check on unmount or when form switches to edit. |
| 1.2 | **Call searchAdopter** | Use existing `searchAdopter` from `@/app/actions`. Call with a single query: e.g. `data.name.trim()` or `[data.name, data.contactInfo].filter(Boolean).join(' ').trim()`. If result is empty or validationError, hide the duplicate card. Limit to first 3–5 results for the card. |
| 1.3 | **Duplicate card component** | New component or inline block in AdopterForm: **Placement:** below the name/contact fields (or above the Save button). **Layout:** Card with `bg-amber-50` or `bg-teal-50`, border, rounded. **Title:** e.g. "Possible matching profiles" / "Similar names in your records" (i18n). **List:** For each result: avatar/initial, name, one line of contact (e.g. `result.adopter.contactInfo` truncated). **Actions per row:** "Use this profile" (navigate to `/adopter/{id}` or set a callback so parent can redirect / close create), "View" (open `/adopter/{id}` in new tab). **Hide card when:** no results, or user cleared name below threshold, or user chose "Use this profile" (navigate away). Do not show "No duplicates" when the list is empty. |
| 1.4 | **Only on create** | Show this card only when `isNew === true`. When editing an existing adopter, do not run the while-typing check or show the card. |

**Files:** `src/components/AdopterForm.tsx` (state for duplicate results, debounced effect, render card), optionally `src/components/AdopterCreateDuplicateCard.tsx` (extract card UI), `src/i18n/locales/en.ts` / `es.ts` (keys for title, "Use this profile", "View").

---

### Phase 2 – On-save duplicate check (confirmation modal)

| # | Task | Details |
|---|------|--------|
| 2.1 | **Intercept save** | In AdopterForm `handleSave`, when `isNew` and before calling `saveAdopter(data)`: call the same search (e.g. `searchAdopter([data.name, data.contactInfo].filter(Boolean).join(' ').trim())` or a dedicated server action that takes `{ name, contactInfo }` and returns possible matches). If the returned list is **empty**, proceed with `saveAdopter(data)` as today. If **non-empty**, do **not** save yet; set state to show the "possible duplicates on save" modal and store the matches and the pending form data. |
| 2.2 | **Save confirmation modal** | When state "show save duplicate modal" is true and we have a list of matches: **Modal title:** "Possible duplicate profiles" / "We found similar profiles". **Body:** Short explanation (e.g. "Creating a new profile may create a duplicate. You can link to an existing profile instead."), then the same compact list (avatar, name, one line contact). **Actions:** Primary: "Use existing profile" → when user clicks a row or a "Use" button, navigate to `/adopter/{id}` (and optionally pass form data via query or context if you later support "add as adoption" from there). Secondary: "Create new profile anyway" → call `saveAdopter(data)` and proceed with current success flow. Tertiary: "Cancel" → close modal, stay on form. |
| 2.3 | **Optional: reuse search or new API** | Either (A) call `searchAdopter` again on save with name + contact, or (B) add a server action `checkDuplicateCandidatesForCreate({ name, contactInfo })` that runs the same or a stricter query and returns the same shape. Using `searchAdopter` keeps one code path; a dedicated action allows different scoring/limits for "create" vs "search". Start with (A) for simplicity. |

**Files:** `src/components/AdopterForm.tsx` (save interception, modal state, modal UI or reuse a shared modal component), i18n for modal copy.

---

### Phase 3 – Copy and accessibility

| # | Task | Details |
|---|------|--------|
| 3.1 | **i18n keys** | Add keys such as: `createAdopter.possible_matches`, `createAdopter.use_this_profile`, `createAdopter.view_profile`, `createAdopter.save_modal_title`, `createAdopter.save_modal_body`, `createAdopter.use_existing`, `createAdopter.create_anyway`, `createAdopter.cancel`. Use in both the card and the modal. |
| 3.2 | **Accessibility** | Card and modal: ensure focus management (e.g. focus first "Use" or "Create anyway" when modal opens), aria-describedby for the list, and clear button labels. |

**Files:** `src/i18n/locales/en.ts`, `es.ts`, AdopterForm and any new components.

---

## File Change Summary

| File | Changes |
|------|--------|
| `src/components/AdopterForm.tsx` | Create-only: debounced search state + effect; duplicate results state; render duplicate card below name/contact; on save, if create and matches exist, show modal instead of saving; modal with "Use existing" / "Create anyway" / "Cancel"; on "Create anyway" call saveAdopter and continue. |
| `src/components/AdopterCreateDuplicateCard.tsx` | **Optional.** Extract card UI (title, list, "Use this profile", "View") for reuse and clarity. |
| `src/i18n/locales/en.ts`, `es.ts` | New keys for duplicate card and save modal. |

---

## Suggested Order of Work

1. **Phase 1** – Debounced search + duplicate card (while typing). Delivers the main proactive experience.
2. **Phase 2** – Save interception + confirmation modal. Delivers the safety net.
3. **Phase 3** – i18n and accessibility.

---

## Out of Scope (for later)

- Passing current form data into the existing adopter profile when user clicks "Use this profile" (e.g. prefill an adoption form). Can be added later via URL params or context.
- Stricter "create-only" duplicate API (e.g. token overlap without full-text search). Current plan relies on existing search.

---

## Acceptance Criteria

- On `/adopter/create`, when the user types a name (and optionally contact) meeting the threshold, after debounce a card appears with "Possible matching profiles" and up to a few results; each has "Use this profile" and "View".
- "Use this profile" navigates to that adopter profile; form is left without saving.
- On Save, if the duplicate check returns any matches, a modal appears with the same list and "Use existing profile" / "Create new profile anyway" / "Cancel". Only "Create new profile anyway" triggers the actual create.
- All new copy is translated (en/es). Card and modal are keyboard- and screen-reader friendly.
