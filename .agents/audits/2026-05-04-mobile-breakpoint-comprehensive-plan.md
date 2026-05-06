# Comprehensive Mobile Breakpoint Audit + Remediation Plan

**Date:** 2026-05-04 · **Scope:** entire user-facing app + dashboards + admin
**Baseline:** Extends `.agents/audits/2026-05-04-mobile-breakpoint-audit.md` (focused) into a whole-app coverage report with a phased plan.

## Executive summary

Mobile is **fundamentally sound for the core Verifier path** (homepage search → profile → adoption entry). The 12-category sweep extends the previous audit with three new structural findings:

1. **Image delete buttons are hover-only across 7 components** — gallery + every adoption form (`opacity-0 group-hover:opacity-100`). Invisible on touch. Users can't delete a pending upload from a phone without guessing the affordance exists.
2. **Non-remapped color palettes (blue/amber/red/purple) break in dark theme** — toggles in adoption forms, confidence badges in `AdopterFlagging`, and contact-type pills in `ContactPills` all use `bg-blue-100`/`bg-amber-100`/etc. as primary surfaces. These aren't in `globals.css`'s remapped palette → low contrast in Azul Noche.
3. **`/admin/organizations` lacks a mobile alternative** — every other admin page (users, duplicates, audit, flags, data-requests) has a `md:hidden` card layout; this one shows the desktop table at 375px with no scroll cue.

Plus the previously-known P0s from the focused audit (still unfixed): iOS input zoom, NotificationBell dropdown overlap, admin table overflow, sticky save bar covering keyboard. Phase 1 below addresses all four; Phase 2 addresses the three new structural findings.

---

## Audit checklist (12 categories)

This is the rubric used. Future audits should score against the same 12.

| # | Category | What "passes" looks like |
|---|---|---|
| 1 | **Viewport & overflow** | No horizontal scroll at 320/375/414px. `min-w-0` on flex children. No fixed widths that overflow. |
| 2 | **Tap targets** | Interactive elements ≥44×44px on mobile. Adjacent tappable elements spaced to avoid mis-taps. |
| 3 | **Typography** | Body ≥14px. Inputs ≥16px (iOS auto-zoom). Long text truncates or wraps cleanly. |
| 4 | **Input behavior** | Correct `inputMode`/`autocomplete`/`type`. Soft keyboard doesn't occlude focused input or sticky save bar. |
| 5 | **Modals & overlays** | Fit at 320px. Body scroll-lock. Close reachable. Escape closes. Content scrolls when overflow. |
| 6 | **Navigation** | Sticky header doesn't occlude content. Multiple sticky elements don't stack-conflict. |
| 7 | **Tables & wide content** | `overflow-x-auto` + scroll cue, OR responsive collapse to cards. No silent overflow. |
| 8 | **Lists & grids** | Single column on mobile. Tap-friendly row heights. |
| 9 | **Images & media** | `max-width: 100%`. Aspect ratio preserved. Lightbox usable on mobile. |
| 10 | **Touch interactions** | No hover-only affordances. No accidental double-tap zoom. Swipe affordances visible. |
| 11 | **Safe areas / PWA** | `env(safe-area-inset-*)` on bottom-fixed bars. PWA standalone tested. |
| 12 | **Theme + accessibility on mobile** | Both Claro/Azul Noche themes work. Color contrast holds. Focus indicators visible on touch. `aria-label` on icon-only buttons. |

---

## Findings by category

### 1. Viewport & overflow ✅
Clean. Sticky cards, modals, admin cards all respect padding at 320px.

### 2. Tap targets 🟡
- `src/components/NotificationBell.tsx:203` — "Mark all read" button text-only, ~36px tall (below 44px WCAG min).
- Image delete buttons (cross-cutting): `AdoptionFormWizard.tsx:532`, `AdoptionForm.tsx:732`, `AdoptionFormEditV2.tsx:746`, `ImageGallery.tsx:306` — all `w-5 h-5` circles. Sub-44px.

### 3. Typography 🔴 (known)
- `AdoptionFormWizard.tsx:397, 403, 445, 463`, `AdoptionFormEditV2.tsx:689`, `AdoptionForm.tsx:675` — inputs/textareas use `text-sm` (14px), trigger iOS auto-zoom on focus.

### 4. Input behavior 🔴 (known)
- No global CSS rule preventing iOS zoom — every `text-sm` override needs per-component fix. **Best solved at the global CSS layer once.**
- `AdoptionFormEditV2.tsx:810` sticky save bar covers focused notes textarea when iOS keyboard opens.

### 5. Modals & overlays ✅
- `CountryConfirmBanner.tsx:122-123` does `document.body.overflow = 'hidden'` (scroll lock works).
- Modals consistently use `fixed inset-0 p-4 max-w-md` — fits 320px viewport.

### 6. Navigation 🔴 (known)
- `NotificationBell.tsx:185` — mobile dropdown uses `fixed inset-x-0 top-14`, covers content with no scroll-back. Should be a slide-up sheet on mobile.

### 7. Tables & wide content 🟡 (NEW)
- `src/app/admin/organizations/page.tsx:160` — full table, no `md:hidden` wrapper, no `overflow-x-auto`. Silent overflow at 375px.
- ✅ `users/page.tsx`, `duplicates/page.tsx`, `audit/page.tsx`, `flags/page.tsx` — correctly hidden at mobile with card alternatives.

### 8. Lists & grids ✅
Dashboards (`my-adopters`, `my-animals`, `my-adoptions`) stack as cards naturally.

### 9. Images & media ✅
Lightbox uses `max-w-full max-h-full`, preserves aspect ratio.

### 10. Touch interactions 🟡 (NEW)
- **Image delete buttons across 7 components** use `opacity-0 group-hover:opacity-100`:
  - `ImageGallery.tsx:268, 306`
  - `AdoptionForm.tsx:732, 771`
  - `AdoptionFormWizard.tsx:532`
  - `AdoptionFormEditV2.tsx:746, 785`
  - `ImportWizard.tsx:899, 1046, 1105`
- Each is invisible on touch. Mobile users can't tell the image is deletable.
- `MediaLightbox.tsx:158` video play icon (already known from previous audit).

### 11. Safe areas / PWA 🟡
- `FormResultsContent.tsx:390` correctly uses `safe-area-pb` ✅
- `app/layout.tsx:114-115` has `apple-mobile-web-app-capable` + `status-bar-style` ✅
- **No `safe-area-inset-bottom` on `AdoptionFormEditV2.tsx:810` save bar** — sits under the iOS home indicator.

### 12. Theme + accessibility on mobile 🎨 (NEW)
Non-remapped color palettes used as primary surfaces — low contrast in Azul Noche:

- `AdoptionForm.tsx:423, 607` — `bg-blue-500`, `bg-amber-500` toggle states (unknown animal, delivered to home).
- `AdopterFlagging.tsx:492-494` — confidence badges `bg-red-100 text-red-700`, `bg-amber-100`, `bg-blue-100`.
- `ContactPills.tsx:185-190` — phone/email/address pills with blue/purple/amber backgrounds.

The blue/amber/red/purple palettes aren't in `globals.css`'s `[data-theme="dark"]` remap block, so they render at light-mode values against a dark background.

---

## Cross-cutting patterns

1. **Input font-size inconsistency is the single biggest mobile bug.** Every adoption form on iPhone triggers a zoom-in/zoom-out chain. A single global CSS rule (`input, textarea, select { font-size: 16px } @media (min-width: 768px) { ... 14px }`) prevents this AND prevents future regressions. Cheapest, highest-leverage fix in this audit.
2. **Hover-only affordances scattered across image components.** 11 instances of `opacity-0 group-hover:opacity-100` across image-handling files. Pattern fix: change to `md:opacity-0 md:group-hover:opacity-100` (visible on mobile, hover-only on desktop). One regex sweep, 11 sites.
3. **Admin table mobile strategy is inconsistent.** 5 admin pages have card fallbacks; 1 doesn't. Either fix Organizations or document that admin = desktop.
4. **Status / accent colors not remapped for dark theme.** Worth adding a small remap block in `globals.css` for `bg-blue-50/100`, `bg-amber-50/100`, `bg-red-50/100`, etc. — same pattern as the existing stone/teal remaps.

---

## Phased remediation plan

### Phase 1 — P0 (a perfect mobile experience requires these)

| # | Title | Files | Effort | Acceptance | Categories |
|---|---|---|---|---|---|
| 1 | **Kill iOS input zoom globally** | `src/app/globals.css` (one new rule block) | XS | iPhone 12 Safari: tap any form input → no viewport zoom occurs. Existing `text-sm` overrides keep desktop tighter via `@media (min-width: 768px)`. | 3, 4 |
| 2 | **NotificationBell dropdown → bottom sheet on mobile** | `src/components/NotificationBell.tsx:185` | XS | Mobile: dropdown slides up from `bottom-0` to `max-h-[80vh]`. Desktop unchanged (`sm:absolute`). Scroll-back works after dismiss. | 6, 10 |
| 3 | **Admin Organizations: add overflow-x-auto + scroll cue** | `src/app/admin/organizations/page.tsx` | S | At 375px: rightmost "Actions" column reachable via swipe; "← swipe to see actions →" hint visible. | 7 |
| 4 | **Sticky save bar above iOS keyboard** | `src/components/AdoptionFormEditV2.tsx:810` | XS | Add `pb-[env(safe-area-inset-bottom)]` and either non-sticky on `<md:` or position via JS to lift above keyboard. iPhone test: focus notes field, save bar doesn't occlude. | 11 |

**Phase 1 effort total:** ~half day. **Impact:** unblocks Recorder path on iOS (currently the worst offender), kills the most visible mobile bug.

### Phase 2 — P1 (significant polish)

| # | Title | Files | Effort | Acceptance |
|---|---|---|---|---|
| 5 | **Image delete buttons visible on mobile** | All 7 instances of `opacity-0 group-hover:opacity-100` on image delete (see Category 10 list) | S | At 375px: × button on every image thumbnail visible without hover; on desktop, only appears on hover. |
| 6 | **Dark-theme remaps for blue/amber/red/purple/orange/pink** | `src/app/globals.css` (new remap block) | M | Both themes: adoption form toggles, confidence badges, contact pills all have ≥4.5:1 contrast (WCAG AA). |
| 7 | **Standardize tap targets ≥44×44px** | `NotificationBell.tsx:203` + sweep of icon-only buttons | XS | All icon-only buttons across the app have `min-h-[44px]` or sufficient padding. |

**Phase 2 effort total:** ~1 day. **Impact:** addresses the three new structural findings from this audit.

### Phase 3 — P2 (nice-to-have)

| # | Title | Effort |
|---|---|---|
| 8 | Mobile card layout for `/admin/organizations` | M |
| 9 | Document sticky/z-index stacking contract in `docs/design-style-guide.md` | XS |
| 10 | Sweep for `inputMode`/`autocomplete` correctness on numeric/email/tel fields | S |

### Out of scope

- **Full a11y audit** (keyboard navigation, screen reader landmarks, ARIA validity) — this audit only covers mobile-rendering-specific accessibility issues.
- **Card-based redesign of all admin tables** — Phase 1 makes Organizations usable; full redesign is a separate engagement.
- **Playwright mobile test coverage expansion** — `tests/mobile.spec.ts` exists but is thin. Worth a follow-up after Phase 1 lands so wins are locked in.

---

## Verification protocol (run on real devices after Phase 1)

1. **iOS input zoom** — iPhone 12 Safari: open `/adopter/[id]`, AdoptionFormWizard, tap each input. No viewport zoom.
2. **NotificationBell mobile behavior** — Long adopter profile, scroll to middle, tap bell. Dropdown slides up from bottom, dismissable by tap-outside.
3. **Admin table scroll** — iOS Safari at 375px: `/admin/organizations`. Right-edge "Actions" column scrollable; "← swipe" hint visible.
4. **Sticky save bar above keyboard** — iPhone 12: open `/adopter/[id]/edit`, focus notes textarea. Save bar lifts above keyboard, notes field readable.
5. **Image delete on touch** — iPhone 12: add an image to AdoptionFormWizard. × button visible on thumbnail without tap.
6. **Dark theme readability** — iPhone Settings → Dark Mode. Adoption form toggles + duplicate badges + contact pills all readable (≥4.5:1 contrast).
7. **`tests/mobile.spec.ts`** — runs green, no regressions.

---

**Next steps:** Pick Phase 1 (4 items, ~half day) for the next sprint. It unblocks the iOS Recorder path, fixes the worst dropdown bug, gives admins on phones a usable Organizations page, and gets save bars above the keyboard. Single deploy. Phase 2 follows after observation.
