# Form Results – Matched Profiles UI – Implementation Plan

This plan describes UI improvements for the **form results** screen when there are **matched adopter profiles**, so rescuers can easily compare applicant vs profile and decide “is this the same person?”.

---

## Current state

- **Form results page** (`src/app/form-results/[notificationId]/page.tsx`) loads submission + metadata (including `matchedAdopters` with `id`, `name`, `matchTypes`).
- **Matched profiles** are fetched with `id`, `name`, `contactInfo`, `status` only (no `addressInfo`, no profile image).
- **FormResultsContent** shows each match as a single card: profile name, `contactInfo` blob, and a link to the profile. Match reasons (`matchTypes`) are **not** shown. Applicant data (name, email, phone, address) appears elsewhere on the page, so the user must scroll and compare mentally.

---

## Goals

1. **Explicit comparison** – For each candidate, show “Form applicant” vs “Existing profile” with the same attributes in the same order.
2. **Match reasons** – Surface why each profile matched (e.g. “Matched on: Email, Full name”).
3. **Visual comparison** – Optional: show applicant selfie and profile photo side by side when available.
4. **Clear actions** – Per-candidate “View profile” and “Link to this profile” (with optional pre-select on link page).

---

## Implementation plan

### Phase 1 – Data and match badges

| # | Task | Details |
|---|------|--------|
| 1.1 | **Extend matched profile data** | In `src/app/form-results/[notificationId]/page.tsx`, extend the adopters query to also select `addressInfo`. Resulting type: `{ id, name, contactInfo, addressInfo, status }`. |
| 1.2 | **Add match type labels to client** | In `FormResultsContent.tsx` (or a small shared util), add a map of `matchType` → readable label (reuse or mirror server `MATCH_TYPE_LABELS`: e.g. `token:email` → “Email”, `token:name_full` → “Full name”). Prefer i18n keys (e.g. `formResults.match_*`) and use `useLanguage().t()` for labels. |
| 1.3 | **Show match reasons per candidate** | In the “Matched Profiles” section of `FormResultsContent.tsx`, for each match render `match.matchTypes` as small badges (e.g. “Matched on: Email, Full name”) above the profile name, reusing the style of contract-results or `DuplicateMergeModal` (amber/neutral pills). |

**Files:** `form-results/[notificationId]/page.tsx`, `FormResultsContent.tsx`, `src/i18n/locales/en.ts` / `es.ts` (new keys for match types if needed).

---

### Phase 2 – Comparison layout

| # | Task | Details |
|---|------|--------|
| 2.1 | **Comparison component** | Add a client component, e.g. `FormResultMatchCard.tsx`, used for each matched profile. Props: `applicant: { name, email?, phone?, address? }`, `profile: { id, name, contactInfo?, addressInfo?, profileImageUrl? }`, `matchTypes: string[]`, `notificationId`, `submissionId`, `submitted` (for applicant fields). |
| 2.2 | **Two-column / two-block layout** | Inside each card, render two clearly separated areas: **(A) Form applicant** – name, email, phone, address (from `submitted` / form data). **(B) Existing profile** – name, contact (show `contactInfo` as block or parsed if you add parsing later), address (show `addressInfo`). Use the same row order (Name, Email/Contact, Phone, Address) and same label set so the eye can scan row-by-row. On mobile use stacked blocks (applicant then profile); on desktop use two columns or a small table with columns “Applicant” and “Profile”. |
| 2.3 | **Visual distinction** | Give the two areas different backgrounds (e.g. applicant: `bg-teal-50/50` or similar; profile: `bg-stone-50`) and a clear heading each (“Form applicant” / “Existing profile”) so it’s obvious which side is which. |
| 2.4 | **Replace current match list** | In `FormResultsContent.tsx`, replace the current list of match cards (simple link + name + contactInfo) with the new `FormResultMatchCard` for each match, passing applicant data from `submitted` and profile data from `matchedProfiles`. |

**Files:** New `src/components/FormResultMatchCard.tsx`, `FormResultsContent.tsx`, i18n for “Form applicant” / “Existing profile” and section title if needed.

---

### Phase 3 – Profile image (optional)

| # | Task | Details |
|---|------|--------|
| 3.1 | **Fetch profile image for matched adopters** | In the form-results page server component, for each matched adopter id query `adopter_images` for one row with `adopter_id = id` and `is_profile_picture = 1` (or fallback to latest image). Select `url` and optionally `thumbnailUrl`. Pass to client as e.g. `matchedProfiles[].profileImageUrl`. |
| 3.2 | **Show applicant vs profile photo** | In `FormResultMatchCard`, when submission has `selfieUrl` and profile has `profileImageUrl`, show two small circles side-by-side: “Applicant” (form selfie) and “Profile” (profile image). Use existing proxy for R2 URLs if needed (`/api/proxy-image`). If profile has no image, show a placeholder or “No photo” so layout is consistent. |

**Files:** `form-results/[notificationId]/page.tsx` (query + new type field), `FormResultMatchCard.tsx`, possibly a small shared `AdopterAvatar` or re-use existing image component.

---

### Phase 4 – Actions and link flow

| # | Task | Details |
|---|------|--------|
| 4.1 | **Per-candidate “View profile”** | Keep a clear link/button “View full profile” that goes to ` /adopter/[id]` (existing behavior). |
| 4.2 | **Per-candidate “Link to this profile”** | Add a button “Link to this profile” that either: (A) navigates to ` /form-results/[notificationId]/link?adopterId=xxx`, or (B) calls the same link action (e.g. `linkFormSubmissionToAdopter(submissionId, adopterId)`) from the form-results page and then redirects to the adopter profile. Option (B) avoids an extra click. Prefer (B) with a loading state and error handling. |
| 4.3 | **Optional: pre-select on link page** | If the user goes to the generic “Link to existing” page, support `?adopterId=xxx` so that when coming from a match card we can pre-select that adopter in the list or show a single “Confirm link to [Name]” action. Implement in `LinkFormToList.tsx` and link page (read `searchParams.adopterId`). |

**Files:** `FormResultMatchCard.tsx`, `FormResultsContent.tsx`, `form-results/[notificationId]/link/page.tsx`, `LinkFormToList.tsx` (optional), i18n for button labels.

---

### Phase 5 – Ordering and copy

| # | Task | Details |
|---|------|--------|
| 5.1 | **Sort matches by strength** | When building the list of matches, sort by number of `matchTypes` (e.g. more matches first) or by a simple priority (e.g. `token:email` + `token:name_full` first). Apply in the server component before passing to the client so the first card is the strongest candidate. |
| 5.2 | **Copy and accessibility** | Ensure headings and comparison labels are translated (i18n). Add an optional `aria-describedby` or short summary for screen readers (e.g. “Comparison of form applicant and existing profile [Name]”). Keep “Link to this profile” and “View full profile” as clear, descriptive buttons. |

**Files:** `form-results/[notificationId]/page.tsx` (sort), `FormResultMatchCard.tsx`, i18n.

---

## File change summary

| File | Changes |
|------|--------|
| `src/app/form-results/[notificationId]/page.tsx` | Extend `matchedProfiles` with `addressInfo`; (Phase 3) add profile image query; (Phase 5) sort matches. |
| `src/components/FormResultsContent.tsx` | Use new match card component; pass applicant + profile + matchTypes; (Phase 1) add match badges if not inside card. |
| `src/components/FormResultMatchCard.tsx` | **New.** Comparison layout, match badges, applicant vs profile blocks, actions (View, Link). |
| `src/app/form-results/[notificationId]/link/page.tsx` | (Optional) Read `adopterId` from searchParams and pass to `LinkFormToList`. |
| `src/app/form-results/[notificationId]/link/LinkFormToList.tsx` | (Optional) Accept `preselectedAdopterId` and pre-select or show single “Confirm link” for that adopter. |
| `src/i18n/locales/en.ts`, `es.ts` | New keys: e.g. `formResults.form_applicant`, `formResults.existing_profile`, `formResults.matched_on`, `formResults.link_to_this_profile`, `formResults.view_full_profile`, and match type labels if not reusing from contract-results. |

---

## Suggested order of work

1. **Phase 1** – Data (addressInfo) + match badges. Quick win and unblocks clear “why” for each match.
2. **Phase 2** – Comparison component and layout. Main UX improvement.
3. **Phase 4** – “Link to this profile” from the card (and optional link page pre-select). Reduces steps to link.
4. **Phase 5** – Sort by strength + i18n/accessibility.
5. **Phase 3** – Profile image when you’re ready to add the image query and avatar UI.

---

## Out of scope (for later)

- Parsing `contactInfo` into email/phone for field-by-field comparison and “same value” highlighting.
- “Not this person” / dismiss match (e.g. collapse or hide that card).

---

## Acceptance criteria

- For each matched profile, the user sees: (1) match reasons (badges), (2) applicant data (name, email, phone, address) and profile data (name, contact, address) in the same order for easy comparison, (3) “View full profile” and “Link to this profile” actions.
- Optionally: profile picture next to applicant selfie when available; matches ordered by strength; link page supports pre-selected adopter.
