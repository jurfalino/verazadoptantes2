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

---

## Implementation status

### Done

| Phase | What was implemented |
|-------|----------------------|
| **1** | `addressInfo` on matched profiles; match-type → i18n map; “Matched on: …” badges (amber pills) per card. |
| **2** | `FormResultMatchCard`: two-block layout (Form applicant teal / Existing profile stone), same row order, responsive. Replaced old match list in `FormResultsContent`. |
| **4.1–4.2** | “View full profile” link and “Link to this profile” button that calls `linkFormSubmissionToAdopter` then redirects to the adopter (no extra page). |
| **5.1** | Matches sorted by number of `matchTypes` (strongest first). |
| **5.2** | Headings/labels use i18n; card has `aria-describedby` on the comparison block. |

### Pending (and why)

| Item | What’s pending | Why it’s pending |
|------|----------------|------------------|
| **Phase 3 – Profile image** | (3.1) For each matched adopter, query `adopter_images` for profile picture (e.g. `is_profile_picture = 1`) and pass `profileImageUrl` to the client. (3.2) In the card, show applicant selfie and profile photo side-by-side (two circles) when both exist, with proxy for R2 URLs. | Marked **optional** in the plan. Adds a join/query per match and extra UI; the text comparison already delivers the main value. Left for when you want visual “same person?” confirmation without opening the profile. |
| **Phase 4.3 – Pre-select on link page** | On `/form-results/[notificationId]/link`, read `?adopterId=xxx` from the URL. In `LinkFormToList`, accept a preselected id and either pre-select that adopter in the list or show a single “Confirm link to [Name]” instead of the full list. | **Optional** in the plan. We implemented option (B) in 4.2 (link from the card via server action + redirect), so users don’t need to open the generic link page when acting from a match card. Pre-select only helps if we add a “Link to existing (choose another)” path that still goes to the link page with a suggested adopter. |
| **Phase 5.2 – Extra a11y** | Optional screen-reader summary (e.g. “Comparison of form applicant and existing profile [Name]”) and any additional ARIA you want. | Basic a11y is in place (`aria-describedby`). Full summary/role would be a small, standalone improvement. |
| **Out of scope (plan)** | Parse `contactInfo` into email/phone for field-by-field comparison and “same value” highlighting; “Not this person” / dismiss match. | Explicitly out of scope for this plan; would be new scope if you want them later. |

### Summary

- **Must-have from the plan:** comparison layout, match badges, and “Link to this profile” from the card are done.
- **Optional and deferred:** side-by-side photos (Phase 3), link-page pre-select (4.3), and extra a11y (5.2) are documented above so you can prioritize or skip them with clear reasoning.

---

## UX senior expert – usability improvements (suggestions)

*Recommendations to improve usability of the form results screen beyond the current implementation.*

### 1. Lead with the decision, not the data

**Issue:** The page is long and linear. The primary question—“What do I do with this submission?”—is answered by the status banner, but the main actions (Create profile, Link to existing) live at the bottom. Users must scroll past all answers and match cards to act.

**Suggestions:**

- **Primary CTA in or right under the status banner**  
  For “no matches” and “has matches,” put the main action in the banner (e.g. “Create new profile” button for no matches; “Create new profile” + “Link to existing” for matches). Reduces scroll and makes the next step obvious.
- **Sticky or floating actions (optional)**  
  On long pages, a sticky bar or floating “Create profile / Link to existing” keeps actions visible without scrolling to the bottom.

### 2. Progressive disclosure for long content

**Issue:** All sections are always expanded. With many form answers and several match cards, the page becomes very long and harder to scan.

**Suggestions:**

- **Collapsible sections**  
  Make “Contact & preferences,” “Full form answers,” and “Matched profiles” collapsible (e.g. accordions). Keep the status banner and primary CTA always visible; expand “Full form answers” by default only if there are few matches or no matches.
- **“Summary first”**  
  Keep a short summary (applicant name, match count, linked status) and one primary action above the fold; treat the rest as “See details.”

### 3. Make comparison easier (match cards)

**Issue:** The “Existing profile” side shows `contactInfo` as one blob. Field-by-field comparison with the applicant (name, email, phone) is harder than it could be.

**Suggestions:**

- **Structured profile block**  
  Where possible, show profile name, email, phone, address as separate rows (e.g. parse `contactInfo` or store structured fields). Same row order as “Form applicant” so users can scan line by line.
- **Visual “same/different”**  
  When a value is identical (e.g. email), show a small “same” indicator or style (e.g. checkmark or muted highlight). When different, keep current styling. Reduces cognitive load when deciding “is this the same person?”
- **Match strength label**  
  In addition to sorting by strength, add a short label per card (e.g. “Strong match” when e.g. name + email + phone match; “Possible match” for fewer signals). Helps users prioritize which card to look at first.

### 4. Clearer status and context

**Issue:** “Completed by [name]” is good; submission time or “Submitted on …” is missing. For “no matches,” the banner doesn’t include the main action.

**Suggestions:**

- **Submission date/time**  
  Show “Submitted on [date]” (and optionally time) next to “Completed by” so rescuers have temporal context (e.g. “just now” vs “last week”).
- **CTA in “no matches” banner**  
  In the teal “No previous records found” banner, add a primary button: “Create new profile with these answers.” No need to scroll to find the same action at the bottom.

### 5. Actions placement and hierarchy

**Issue:** Two equal-looking buttons at the bottom (“Create new profile”, “Link to existing”). The most likely action (create vs link) depends on the scenario; hierarchy doesn’t reflect that.

**Suggestions:**

- **Scenario-based emphasis**  
  When there are no matches, make “Create new profile” the single primary (filled) button in the banner and optionally de-emphasize or hide “Link to existing” in that state. When there are matches, consider making “Link to this profile” on the strongest match card the primary path and “Create new profile” secondary (e.g. outline style) at bottom.
- **One clear primary per context**  
  Avoid two equally prominent actions when one is clearly the expected next step (e.g. after “no matches,” primary = create).

### 6. “Not this person” and match list hygiene

**Issue:** If a match card is clearly not the same person, there’s no way to dismiss or hide it. The list can feel noisy.

**Suggestions:**

- **“Not this person” / Dismiss**  
  Add a subtle control per card (e.g. “Not this person” or “Dismiss”) that collapses or hides that card (client-side only is fine). Reduces clutter and reinforces that the user has considered that candidate.
- **Collapsed by default for weak matches (optional)**  
  For “Possible match” cards, consider showing them collapsed (e.g. “Possible match: [Name] – Expand to compare”) so the strongest match is prominent and the rest are available on demand.

### 7. Mobile and touch

**Issue:** On small screens, comparison is stacked (applicant then profile). Actions at the bottom require a long scroll.

**Suggestions:**

- **Tap targets**  
  Ensure “Link to this profile” and “View full profile” are large enough (e.g. min 44px height) and spaced so they’re easy to tap.
- **Sticky CTA on mobile**  
  On narrow viewports, consider a sticky bottom bar with “Create new profile” (and optionally “Link to existing”) so the main action is always one tap away.

### 8. Feedback and errors

**Issue:** When “Link to this profile” is clicked, the button shows “…” but there’s no toast or message on success/failure beyond navigation.

**Suggestions:**

- **Success feedback**  
  After a successful link, show a short toast or inline message (e.g. “Linked to [Name]. Redirecting to profile.”) before redirect. Confirms the action and sets expectations.
- **Error handling**  
  If the link fails, show a clear message (toast or inline under the button) and leave the button enabled so the user can retry. Avoid silent failures.

### Priority overview

| Priority | Improvement | Effort | Impact |
|----------|-------------|--------|--------|
| High | Primary CTA in status banner (no matches + has matches) | Low | High – next step obvious |
| High | Success/error feedback for “Link to this profile” | Low | High – trust and retry |
| Medium | Collapsible sections (full answers, matches) | Medium | Medium – shorter, scannable page |
| Medium | Structured profile block + same/different hints | Medium | High – faster comparison |
| Medium | Match strength label (“Strong” / “Possible”) | Low | Medium – prioritization |
| Lower | “Not this person” / dismiss card | Low | Medium – less clutter |
| Lower | Sticky actions (desktop or mobile) | Medium | Medium – fewer scrolls |
| Lower | Submission date in header | Low | Low – context |
| Optional | Profile image in card (Phase 3) | Medium | Medium – visual confirmation |

---

## Audit: Client Success Manager + UX Senior Expert (Form Results Screen)

*Dual-perspective audit of the form results screen after implementing the UX recommendations.*

### Executive summary

The form results screen now supports rescuer goals (decide → link or create) with clear status, primary CTAs in the banner, collapsible sections, match strength labels, dismiss, and feedback. From a **Client Success** lens, users can complete their task with less confusion and better feedback. From a **UX** lens, hierarchy, progressive disclosure, and touch targets are in good shape; a few gaps remain (comparison asymmetry, empty states, sticky bar scope, a11y polish).

---

### 1. Client Success Manager audit

**Focus: Can rescuers succeed? Are outcomes clear? Is friction minimized?**

| Area | Assessment | Evidence |
|------|------------|----------|
| **Goal clarity** | ✅ Good | Banner states (linked / matches / no matches) and copy tell the user what the situation is. Primary actions (Create profile, Link to existing) are visible in the banner so “what do I do?” is answered immediately. |
| **Task completion** | ✅ Good | Create and Link paths are obvious. “Link to this profile” on each card avoids an extra navigation step. Success toast + redirect after link gives clear confirmation. Error toast on link failure allows retry. |
| **Reduced confusion** | ✅ Good | Match strength (“Strong match” / “Possible match”) and “Matched on: …” badges explain why a profile appeared. “Not this person” reduces noise when a match is wrong. Collapsible sections keep the page scannable. |
| **Trust & feedback** | ✅ Good | Submission date in header adds context. Link success/error toasts prevent “did it work?” anxiety. Loading state (“…”) on the link button shows the system is working. |
| **Support / recovery** | ⚠️ Partial | No inline help or tooltip for “what is a strong vs possible match?” No way to undo “Not this person” (dismiss is client-only; refresh brings cards back). If the user mis-clicks Create when they meant Link, they must go back. |
| **Edge cases** | ⚠️ Partial | If *all* match cards are dismissed, the “Matching profiles” section disappears and the section title no longer shows “(0)”—count in title reflects visible matches, which is correct. When there are zero visible matches after dismissals, only “Create new profile” and “Link to existing” (generic) remain; no explicit “None of these matched” message. |

**Client Success verdict:** The screen is in good shape for daily use. Rescuers can complete link/create flows with clear feedback. Remaining improvements: optional short guidance for match strength, and consideration for “undo dismiss” or an explicit “None of these” state when all matches are dismissed.

---

### 2. UX Senior Expert audit

**Focus: Information architecture, visual hierarchy, interaction patterns, accessibility, consistency.**

| Area | Assessment | Evidence |
|------|------------|----------|
| **Information architecture** | ✅ Good | Order is logical: context (header, date) → status + primary actions → selfie → contact/prefs (collapsible) → full answers (collapsible) → location → matches (collapsible) → actions. “Decision first” is respected. |
| **Visual hierarchy** | ✅ Good | Banner stands out (teal/amber). Primary CTA (teal filled) vs secondary (outline) is clear. Match card header (strength + badges) separates from comparison blocks. Section headings and collapsible titles are consistent. |
| **Progressive disclosure** | ✅ Good | Contact & preferences, Full form answers, and Matching profiles are collapsible with chevron and `aria-expanded`. Defaults (e.g. full answers open when no/few matches) support the main task. |
| **Comparison layout** | ⚠️ Partial | Applicant side: structured rows (Name, Email, Phone, Address). Profile side: Name, then “Contact” (single blob), then Address. Asymmetry makes line-by-line comparison harder; “same/different” cues are still missing. |
| **Touch & mobile** | ✅ Good | Buttons use min-h 44px (48px on sticky). Sticky CTA on mobile keeps “Create new profile” one tap away. Collapsible sections reduce scroll. |
| **Sticky bar scope** | ⚠️ Partial | Sticky bar only offers “Create new profile.” When the user has matches and might prefer “Link to existing,” they must scroll to the banner or bottom actions. Optional enhancement: show both Create and Link on sticky when `hasMatches`. |
| **Accessibility** | ⚠️ Partial | Collapsible has `aria-expanded`. Card has `aria-describedby` pointing to comparison block. Missing: live region for link success/error (toast may be announced depending on toast implementation), and a short screen-reader summary per card (e.g. “Comparison: applicant and profile [Name]”). Focus management after dismiss or after link redirect not verified. |
| **Consistency** | ✅ Good | Same L()/i18n pattern as elsewhere. Button styles (teal primary, stone outline) align with the rest of the app. Collapsible pattern is reusable. |
| **Empty / zero states** | ⚠️ Partial | When all matches are dismissed, the matches section disappears. No explicit “You dismissed all matches” or “No matching profiles to show” message. “Contact & preferences” collapsible can be open with minimal content (e.g. only preferences); that’s acceptable. |
| **Copy & labels** | ✅ Good | Section titles (Contact & preferences, Full form answers, Matching profiles), status text, and CTAs are translated and use fallbacks. Match type badges and strength labels are clear. |

**UX verdict:** Strong structure and hierarchy; collapsible sections and match strength improve scannability and decisions. Main gaps: (1) profile side of the card is still one contact blob (no field-by-field parity or same/different), (2) sticky bar could offer Link when there are matches, (3) a11y polish (card summary, optional live region), (4) explicit state when all matches are dismissed.

---

### 3. Gaps and recommendations (prioritized)

| Priority | Gap | Recommendation | Owner note |
|----------|-----|----------------|------------|
| **P2** | Comparison asymmetry | Parse or structure profile `contactInfo` so profile shows Name, Email, Phone, Address in same order as applicant; add “same”/“different” (e.g. checkmark or subtle highlight) where values match. | Product/UX |
| **P2** | Sticky bar when there are matches | On mobile, when `hasMatches`, show both “Create new profile” and “Link to existing” in the sticky bar (e.g. two buttons or primary + secondary) so link is one tap away. | Front-end |
| **P3** | “All matches dismissed” state | When `visibleMatches.length === 0` but `hasMatches` (user dismissed all), show a small message: “You’ve dismissed all suggested matches. You can create a new profile or link to another existing profile.” and keep Create + Link actions visible. | Front-end |
| **P3** | A11y: card summary | Add `aria-label` or a visually hidden sentence on each card: “Comparison of form applicant and existing profile [Name]” so screen-reader users get context before the comparison grid. | Front-end |
| **P4** | Optional: undo dismiss | Allow “Restore” or “Show again” for dismissed cards (e.g. in the collapsed matches section or a small “X dismissed” control that expands and restores). | Product |
| **P4** | Optional: match strength tooltip | Short tooltip or help text: “Strong match: multiple identifiers match. Possible match: fewer signals.” to reduce support questions. | Content/UX |

---

### 4. Verdict

- **Client Success:** The screen supports rescuer success: clear status, clear next steps, feedback on link, and less clutter (dismiss, collapsible). Remaining work is mostly about edge states and optional guidance.
- **UX:** IA and hierarchy are solid; progressive disclosure and touch targets are in place. The main open item is comparison parity (structured profile + same/different) and small improvements (sticky bar when matches, “all dismissed” state, a11y).

**Overall:** Approved for production use. Recommended follow-ups: P2 items (comparison parity, sticky bar with Link when matches) and P3 (“all dismissed” state + card a11y) when capacity allows.
