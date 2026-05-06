# Mobile Breakpoint Audit — BuenAdoptante

**Date:** 2026-05-04 · **Scope:** entire user-facing app + admin pages

## Executive summary

The mobile implementation is **fundamentally sound for the core Verifier path** (homepage search → results → profile). The sticky search card at `top-16`, auto-scroll-to-results, and avatar/badge sizing all hold at 375px width. But three issues create real friction in secondary workflows: (1) **40% of form inputs use `text-sm` (14px), triggering iOS Safari's auto-zoom** on every adoption-form entry on iPhone — the single biggest mobile bug in the app; (2) **the NotificationBell dropdown uses `fixed inset-x-0` and obscures content** when opened mid-scroll on phones; (3) **admin tables silently overflow horizontally without scroll affordances**. None block the dominant Verifier journey, but the iOS-zoom issue affects every Recorder entering an adoption on iPhone — that's worth treating as a P1.

---

## Findings by severity

### 🔴 Blocking on mobile (the user can't complete their primary job)

None identified. The core search → profile → adoption path works end-to-end on 375px.

### 🟡 Significant friction on mobile (job completable but noticeably worse)

| File:line | Issue |
|---|---|
| `src/components/AdoptionFormWizard.tsx:397, 403, 445, 463`<br>`src/components/AdoptionFormEditV2.tsx:689`<br>`src/components/AdoptionForm.tsx:675` | **iOS auto-zoom on form inputs.** All adoption form `<input>` and `<textarea>` use `text-sm` (14px). iOS Safari zooms any input under 16px on focus, breaking the layout. Each focus → zoom-in → next focus → zoom-in chain feels broken to the user. Affects every adoption record entered from an iPhone. |
| `src/components/NotificationBell.tsx:185` | **Dropdown obscures content on mobile.** Uses `fixed inset-x-0 top-14` to fill the screen width below the nav. If a user opens notifications mid-scroll on a profile, the dropdown covers content with no scroll-back — only the X dismisses it. Tablet+/desktop correctly switches to `sm:absolute`. |
| `src/components/AdoptionFormEditV2.tsx:810` | **Sticky save bar covers the last field when keyboard opens.** `bottom-4 z-20` save bar doesn't get pushed up by iOS soft keyboard, so the user can't see what they're typing in the notes textarea. |

### 🎨 Visual breakage at narrow widths (overflow, occlusion, tap-target failures)

| File:line | Issue |
|---|---|
| `src/components/SearchSection.tsx:431-451` | **Result-card flag pills wrap awkwardly.** `flex flex-wrap gap-1 ml-auto` with 2-3 flag badges wraps to a second line right-aligned, looking visually disconnected from the row above. Risk: rescuer misses a flag because it appears orphaned. |
| `src/app/admin/organizations/page.tsx:161` | **Admin table overflows silently.** No `overflow-x-auto` wrapper around the 6-column table; rightmost columns (including Actions) drop off-screen at 375px with no scroll cue. |
| `src/app/admin/audit/page.tsx:183` | **Audit table is desktop-only.** `min-w-[800px]` table marked `hidden md:block` with no mobile alternative — admins on phones see a blank page. |
| `src/components/ui/MediaLightbox.tsx:158` | **Hover-only video play icon.** `opacity-0 group-hover/thumb:opacity-100` means the play affordance is invisible on touch — users can't tell a thumbnail is a video until they tap it. |
| `src/components/AdopterFlagging.tsx:412` | **Suggestions modal can lock content beyond viewport.** No `max-h-[calc(100vh-…)] overflow-y-auto` on the inner suggestions list; if 10+ duplicates are shown, the bottom is unreachable on a short phone. |
| `src/components/NotificationBell.tsx:202-204` | **"Mark all read" tap target ~36px tall.** Below WCAG 2.5.5 / Apple HIG min of 44×44px. |

### 🟢 Working well on mobile (preserve these patterns)

1. **`SearchSection.tsx`** overall responsive design — sticky card with `md:static` fallback, responsive padding (`p-5 md:p-6`), input `text-sm md:text-base` (the input itself doesn't trigger iOS zoom because that one IS 16px on mobile defaults — pattern to copy elsewhere).
2. **Modal centering** — `fixed inset-0 ... p-4` + `max-w-md` consistently used (LoginModal, AdoptionWizard, DuplicateMergeModal, the delete-confirm in `AdopterProfileV2.tsx`). Modals never exceed the viewport.
3. **Avatar sizing** — `w-11 h-11 md:w-14 md:h-14` is exactly 44px on mobile (Apple HIG min) and grows on desktop. The new click-to-upload affordance (v38) inherits this correctly.
4. **Card wrapping in dashboards** — `my-adopters` / `my-animals` / `my-adoptions` use card layouts that stack naturally; no horizontal scroll issues observed.

---

## Pattern-level observations

1. **Input font-size inconsistency is the most impactful issue.** ~40% of form inputs use `text-sm` (14px) → iOS zoom; ~60% use `text-base` or default → fine. Worth a project-wide convention: **all inputs/textareas default to `text-base` (16px), optionally scale down on `md:`**. Could be enforced via a lint rule pointing at `<input className="…text-sm…">` patterns.

2. **Sticky element stacking is fragile.** Three sticky/fixed layers exist: nav (`top-0`), search card (`top-16`), and various save bars (`bottom-4`). They don't conflict today, but adding a fourth (e.g. a banner) without coordinating z-indexes will cause occlusion. Consider documenting the stacking contract in `docs/design-style-guide.md`.

3. **Admin pages were not designed mobile-first.** Audit, Organizations, Users, Duplicates all use full-width tables that overflow at 375px. Acceptable as a temporary trade-off (admin = desktop) but should be acknowledged explicitly so admins know what to expect on phones.

4. **A handful of hover-only affordances remain.** MediaLightbox play icon is the most visible. Pattern fix: `md:opacity-0 md:group-hover:opacity-100` (always visible on mobile, hover-only on desktop). Three or four sites total — cheap sweep.

5. **No `text-[16px]` rule for inputs at the global CSS layer.** Adding a single rule `input, textarea, select { font-size: 16px; } @media (min-width: 768px) { ... }` in `globals.css` would prevent every future iOS-zoom regression without per-component edits.

---

## Suggested implementation plan

### Phase 1 — Critical fixes (the iOS zoom + the dropdown overlap)

| # | Item | Files | Effort | Acceptance |
|---|---|---|---|---|
| 1 | **Kill iOS input zoom globally** — add a CSS rule in `src/app/globals.css` forcing `font-size: 16px` on all `input`, `textarea`, `select` at mobile widths; let `md:text-sm` overrides keep desktop tighter | `src/app/globals.css` (1 rule), all form components keep their existing classes | S | iPhone 12 / Safari: tap any input in any form — no zoom occurs. |
| 2 | **Fix NotificationBell dropdown positioning on mobile** — change `fixed inset-x-0 top-14` to a slide-up sheet (`fixed inset-x-0 bottom-0 max-h-[80vh]`) on mobile only; keep `sm:absolute` for desktop | `src/components/NotificationBell.tsx:185` | XS | Open notifications mid-scroll on a profile page; can dismiss via tap-outside or swipe-down. |
| 3 | **Add overflow-x-auto + scroll affordance to admin tables** | `src/app/admin/organizations/page.tsx`, `src/app/admin/users/page.tsx`, `src/app/admin/duplicates/page.tsx`, `src/app/admin/audit/page.tsx` | S | All admin tables: rightmost columns reachable via horizontal scroll on 375px; small "← swipe" hint visible if content overflows. |

### Phase 2 — Tap targets + visible affordances + flag wrapping

| # | Item | Files | Effort |
|---|---|---|---|
| 4 | **Standardize tap targets ≥ 44px** — sweep all icon-only buttons, ensure `min-h-[44px]` or sufficient padding | sweep, prioritize `NotificationBell`, `ImageGallery`, header utility buttons | M |
| 5 | **Make hover-only affordances visible on touch** — `md:opacity-0 md:group-hover:opacity-100` pattern | `MediaLightbox.tsx:158`, any sibling list rows with hover-revealed delete | XS |
| 6 | **Result-card flag wrapping** — drop `ml-auto`, let badges flow naturally LTR; or hide overflow behind "+N more" affordance | `SearchSection.tsx:431-451` | XS |
| 7 | **Add `max-h + overflow-y-auto` to dynamic-content modals** | `AdopterFlagging.tsx:412` and any sibling | XS |

### Phase 3 — Polish

| # | Item | Files | Effort |
|---|---|---|---|
| 8 | **Sticky save bar above keyboard** — make non-sticky on `<md` OR move flush to `bottom-0` so it sits above the keyboard | `AdoptionFormEditV2.tsx:810` | S |
| 9 | **Document the sticky stacking contract** — short note in `docs/design-style-guide.md` listing the existing `z-index` layers (nav, sticky search card, save bars, modals, toasts) | `docs/design-style-guide.md` | XS |

### Future work / out of scope

- **Card-based mobile view for admin tables.** Phase 1 makes them usable on phones; a proper redesign (collapse rows into stacked cards on `<md`) is a separate engagement worth ~2-3 days.
- **Keyboard navigation + screen-reader audit.** This audit is mobile-rendering only. A11y audit is its own ticket.
- **Add a Playwright mobile test project** — `tests/` already has a `mobile.spec.ts` but coverage is thin. Expanding it post-fix would lock in the win.

---

## How to verify after Phase 1 ships

1. **iOS zoom**: load any adopter profile in mobile Safari, open the AdoptionFormWizard, tap each input — viewport should not zoom.
2. **NotificationBell**: scroll halfway down a long profile, tap the bell. Dropdown shows below the nav OR slides up from the bottom; tapping outside the dropdown closes it; original scroll position preserved.
3. **Admin tables**: visit `/admin/organizations` on a 375px viewport; rightmost "Actions" column reachable via swipe; scroll cue visible.
4. **Run the existing `tests/mobile.spec.ts`** to confirm no regression in the previously-tested mobile flows.
