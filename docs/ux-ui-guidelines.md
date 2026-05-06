# UX / UI Guidelines — BuenAdoptante

**Source of Truth — v1.0**

This document is the **decision-making framework** for product UX and UI work.
It complements (does not replace) two adjacent docs:

- **`docs/design-style-guide.md`** — visual tokens (8px grid, color palette, typography, button matrix). The "what does this look like" reference.
- **`.agents/workflows/ui-review.md`** — mechanical compliance lint that checks code against `design-style-guide.md`. Runs as a pre-merge check.
- **`.agents/workflows/ux-review.md`** — humanistic review that asks "does this experience actually work for the user?"

This doc covers the **why** and **when**: principles, patterns, and BuenAdoptante-specific conventions accumulated over real product decisions.

---

## How to use this doc

- **Designing something new?** Read sections 1–3 first, then check section 5 ("BuenAdoptante-specific patterns") for product-level conventions.
- **Reviewing someone else's work?** Use the `ui-review.md` checklist for compliance, this doc + `ux-review.md` for humanistic critique.
- **Deciding between two approaches?** Cross-reference the principles in section 1 + the laws in section 4.
- **Stuck on an anti-pattern?** Section 6 lists patterns we've explicitly walked back, with links to the deciding context.

---

## 1. Core UX Principles

### 1.1 User-Centricity

Decisions are anchored to the user, not personal preference. We have **two named personas**:

- **The Verifier** — a rescuer who got an adoption inquiry and needs to assess trust risk in <30s. Mobile-first, time-pressured, emotionally invested. *Their question: "Should I trust this person with an animal?"*
- **The Recorder** — a rescuer logging an outcome AFTER an adoption. *Their question: "How do I capture what just happened with minimum friction?"*

When you're considering a change, name which persona it serves. If a change makes the Verifier's job easier at the Recorder's expense (or vice versa), surface the trade-off explicitly.

### 1.2 Clarity & Simplicity

Prefer the obvious word over the clever one. The product is used in stressful moments — clever copy reads as obstacle. Principles:

- **Verbs in headings, not nouns.** "Verificá adoptantes" beats "Registro de Adopciones." Action-oriented copy puts the user as the subject and tells them what they can do, not what the product is.
- **Short sentences over long ones.** Spanish copy especially: prefer 8-word labels to 18-word ones.
- **One job per element.** A button does one thing. A modal asks for one decision. A page has one primary action.

### 1.3 Consistency

A user who learns a pattern in one place should be able to apply it everywhere:

- **Buttons** follow the matrix in `design-style-guide.md`. No bespoke button styles.
- **Icons** are SVG with `currentColor`, not emoji (see memory note: SVG over emoji). Emoji acceptable only as decorative subject markers next to text labels.
- **Navigation** sticky-top global nav across all pages; admin pages use the `AdminSidebar`; profile pages use a back-nav at the top.
- **Modals** centered with `fixed inset-0 + p-4 + max-w-md` is the canonical pattern. Use this everywhere.
- **Affordances** for the same job look the same. The "click empty avatar to upload" affordance (camera SVG bottom-right) should not be invented again with a different glyph elsewhere — copy the existing pattern.

### 1.4 Hierarchy

The user's eye should land on the most important element first. Cues we use:

- **Size** — H1 = 28/800, H2 = 20/700, body = 15/500 (per the type scale). Don't break the scale.
- **Color** — accent teal for actionable items, stone for neutral, status colors (success/warning/error/info) for state.
- **Position** — primary actions live above the fold; secondary actions live in footers, dropdowns, or below the primary content.
- **Density** — important things have breathing room around them; secondary things stack tighter.

When you have a Verifier decision page (the adopter profile), the **rating + flags** are the most important elements. They should never be smaller, dimmer, or farther down than editable form fields.

### 1.5 Accessibility

Minimum bar for new components:

- **Keyboard reachable** — every interactive element has tab focus, visible focus ring, and responds to Enter/Space.
- **Screen-reader friendly** — `aria-label` on icon-only buttons, `role="dialog" + aria-modal="true"` on modals, `aria-live` on toasts that announce changes.
- **Color is never the only signal** — pair color with a glyph or text. A red badge alone fails colorblind users; "🚨 Crítico" passes.
- **Tap targets ≥44×44px** on mobile (Apple HIG / WCAG 2.5.5 minimum). Icon-only buttons need padding to reach this.
- **Inputs default to `font-size: 16px`** on mobile so iOS Safari doesn't auto-zoom on focus.

### 1.6 User Control & Feedback

Every user action should produce an observable result, and reversible actions should be reversible:

- **Optimistic feedback** — show a spinner, disable the trigger, optionally optimistically update the UI. Toast on success or error with an `errorId` for triage.
- **Confirmation for destructive actions** — delete, merge, transfer ownership. Use the existing `Toast` system + a confirmation modal pattern.
- **Undo where it's cheap** — soft-delete with a "deshacer" toast for reversible operations. Hard-delete should be the exception.
- **Never silently swallow errors** — see `CLAUDE.md` "Logging Conventions" section. A failed action with no feedback is worse than a clearly-broken action.

### 1.7 Context-Awareness

This product runs on phones in the field, not desktops in offices. Design accordingly:

- **Mobile-first by default** — Tailwind classes default to mobile, `md:` is the desktop override (not the other way around).
- **Cellular-network friendly** — compress images client-side before upload, lazy-load non-critical content, treat the cold-start latency as your performance budget.
- **Offline-tolerant** — degrade gracefully when the network blips. The PWA install path exists for a reason; don't build features that assume always-on connectivity.
- **Theme-aware** — both Claro and Azul Noche themes must work. Use the remapped palette (stone/teal) or CSS vars; avoid `bg-blue-*` etc. as primary surfaces because those aren't remapped (see memory note: BuenAdoptante theming system).

---

## 2. Fundamental UX Patterns

### 2.1 Chunking

Break long flows into steps the user can complete and recover from:

- **Wizards** for multi-step flows (`AdoptionFormWizard` is the canonical 3-step wizard pattern: what / details / evidence).
- **Collapsible sections** for long profile pages (`AdopterProfileV2` collapses Adoptions / Photos / History / Delete sections so the page is scannable).
- **Pagination or infinite scroll** for long lists. Don't render 500 rows at once.

### 2.2 Navigation Patterns

- **Sticky top nav** — global presence, includes brand + user menu. Same on every page so it's predictable.
- **Back-nav** at the top of detail pages with the source label ("Volver a Buscar" / "Volver a My Adopters"). Reuse the existing back-nav block from `AdopterProfileV2`.
- **Tabs** for sibling views of the same data (`/my-adoptions` filter tabs).
- **Breadcrumbs** are not used today — if you introduce them, they need a separate design pass.
- **Hamburger menus** are not used today — admin uses a persistent sidebar (`AdminSidebar`); user nav is the top bar. Don't introduce a hamburger without explicit need.

### 2.3 Input & Form Patterns

- **Clear labels above inputs** (not placeholders-as-labels — placeholders disappear when typing and fail accessibility).
- **Inline validation** — show errors next to the field, not in a summary at the top.
- **Autocomplete / suggestions** — the search input uses debounced server-side suggestions (`AdopterForm` duplicate detection while typing). Reuse this pattern.
- **Optimistic submission** — disable the submit button on click, show a spinner, recover on error.
- **Step-1 validity gates step navigation** in wizards — don't let the user advance with invalid required fields.
- **`font-size: 16px` minimum on inputs** to prevent iOS auto-zoom (see section 1.5).

### 2.4 Feedback Patterns

- **Toasts** for transient feedback (`useShowToast`). Success ✓, warning ⚠, error 🚨. Errors include the auto-generated `errorId`.
- **Loading states** — spinner replacing content (avatar upload), skeleton placeholders for first-paint, button-disabled-with-spinner for in-flight actions.
- **Button state changes** — disabled, hovered, active, loading. The button matrix in `design-style-guide.md` defines the full set.
- **Empty states** — every list has a designed empty state with copy that tells the user what to do next, not just "No results."
- **Error states** — every fetch has an error path; the global error boundary (`global-error.tsx`) catches the rest.

### 2.5 Filtering & Sorting

- **Tabs for primary filtering** (record type on `/my-adoptions`).
- **Search input for free-text filtering** (admin pages, search homepage).
- **Default to the most-likely-intended view.** Example: `/my-adoptions` defaults to the Adoption tab so the chip count and the page agree (v2.12.1-41).
- **URL-encoded filter state** so back/forward navigation works and links are shareable.
- **Sort defaults to recency-DESC** unless there's a strong reason otherwise.

---

## 3. BuenAdoptante-specific patterns we've established

These are conventions accumulated through real product decisions. Departing from them needs justification.

### 3.1 Trust signals on the adopter profile

The Verifier needs to make a trust judgement in <30s. The profile header surfaces in priority order:

1. **Rating** (1-5 with semantic label — Peligroso, Riesgoso, Promedio, Bueno, Excelente)
2. **Flag pills** — system-detected and user-reported issues (`AdopterFlagging` component)
3. **Avatar** — recognition signal; tappable to enlarge (lightbox)
4. **Stats** (adoption count, request count, profile views)

Editable form fields and admin actions are below this row, not above it.

### 3.2 Avatar affordances

Avatar slot has three states with consistent affordances:

| State | Tap | Visible affordance |
|---|---|---|
| Empty placeholder, authenticated | OS file picker → upload | Camera SVG badge bottom-right |
| Empty placeholder, anonymous | Nothing | Plain placeholder, no affordance |
| Filled photo, anonymous | Lightbox view | Cursor + hover lift |
| Filled photo, authenticated | Lightbox view + "Cambiar foto" inside | Cursor + hover lift; replace inside lightbox |

**Don't invent a new affordance for "manage profile photo"** — extend this pattern.

### 3.3 Disclaimer / informed-consent

Legal disclaimers (community-contributed data, etc.) follow a single pattern:

- **First view per browser** → slim toast at top, dismissible, persisted via `localStorage`.
- **Long-term reference** → footer link to `/terms`.
- **Don't add a persistent ⓘ icon** that opens the same generic disclaimer (we tried this in v30, removed it in v37 — pure duplication, misleading affordance).

### 3.4 Theme color usage

- **Surface + text colors** must come from CSS variables (`var(--surface-card)`, `var(--text-primary)`) OR from the remapped Tailwind palette (stone-*, teal-*).
- **Status accents** (rose, amber, blue, etc.) are acceptable for **small badges and pills only** — not for primary surfaces. The blue palette is NOT remapped, so `bg-blue-50` as a card background breaks dark mode.
- **For status-info surfaces** use `var(--status-info-bg)` + `var(--status-info-border)`. Memory note: BuenAdoptante theming system.

### 3.5 Footer placement for secondary nav

Secondary informational links (Guide, Funcionalidades, Privacy, Terms, Contact) live in the homepage footer, not in the hero. Hero real estate is for the user's primary job, not chrome.

### 3.6 Logging actions for triage

Every state-changing action emits a structured log entry with operation context (`adopterId`, `actorEmail`, etc.). Failure paths re-emit the same context — never log just the error message. See `CLAUDE.md` "Logging Conventions" + memory note.

### 3.7 i18n discipline

- Default locale is **`es`** (Spanish). English is fallback.
- New strings must be added to **both** `es.ts` and `en.ts` in the same commit.
- Missing keys fall back to the raw key path — visible to users as `dashboard.my_key`. Always update both locale files.

---

## 4. Psychological Principles (Laws of UX)

### 4.1 Aesthetic-Usability Effect

Users perceive aesthetic designs as more usable. Implication: investing in polish (consistent spacing, theme-coherent surfaces, smooth transitions) raises perceived quality and reduces support burden. Don't ship broken-looking interfaces and rationalize "it works."

### 4.2 Fitts's Law

Time-to-acquire = function of distance + target size. Implications:

- **Primary action buttons should be large** (the standard `py-3 px-6` button vs the compact `py-2 px-4`).
- **Frequent actions should live where the cursor / thumb already is** — bottom of the screen on mobile, near the form on desktop.
- **Don't bury the primary action in a dropdown** when it's the only action the user wants.

### 4.3 Doherty Threshold

Productivity increases when interaction completes in <400ms. Implications:

- **Optimistic UI** — update local state immediately, sync with server in the background.
- **Skeleton loaders** for first-paint to give perceived progress under 400ms even when the actual fetch takes longer.
- **Avoid full-page reloads** after small actions — refetch the affected slice, not the whole page.
- The `/api/ready` probe was added (v31) specifically because Playwright was firing tests before the D1 binding was healthy — same threshold concern, applied to test infrastructure.

### 4.4 Choice Overload

Limiting options prevents overwhelm. Implications:

- **Action cards on the homepage are limited to 3** (Adoption / Report / optional Import). Adding a fourth needs justification.
- **Wizard steps cap at 3** for `AdoptionFormWizard`. More steps → split into a follow-up flow.
- **Search filters are tabs (5-6 max), not a multiselect dropdown** with 20 options.
- When you have many options, use **progressive disclosure** — primary options visible, "Más" expander for secondary.

### 4.5 Hick's Law

Decision time grows logarithmically with number of choices. Cousin of Choice Overload but specifically about decision latency. Implication: if the user has to pick from 12 options, they're slower than if they have to pick from 4. When designing dropdowns, lists, navigation — fewer is faster.

### 4.6 Jakob's Law

Users spend most of their time on OTHER apps. Implication: when in doubt, follow the convention from WhatsApp / Instagram / Facebook / Google rather than inventing your own. A novel pattern needs proportional justification — usually the convention is good enough.

### 4.7 Miller's Law (7±2)

Working memory holds ~7 items. Don't show users 30 fields on one page; chunk into sections. The collapsible sections on `AdopterProfileV2` are an application of this.

### 4.8 Tesler's Law of Conservation of Complexity

Every system has irreducible complexity that must live somewhere — in the system or in the user. The more we hide complexity in the system, the simpler the user's job. Don't expose internal data model complexity to users (e.g., the user shouldn't have to understand the difference between `recordType=adoption` and `recordType=adoption_request` if we can name the tabs clearly).

---

## 5. Anti-patterns we've explicitly walked back

These were tried and removed. Don't reintroduce them without addressing the original failure.

| Anti-pattern | Where | Fixed in | Why it failed |
|---|---|---|---|
| **Persistent ⓘ icon** next to the rating opening a generic disclaimer modal | `AdopterForm` v30 | v37 removed | Duplicate content (toast already showed it); misleading affordance ("more info about the rating" → got generic legal copy); competed with the rating's actual signal. |
| **Heavy disclaimer card with 2 dismiss actions** | `DisclaimerToast` v30 | v36 slimmed | Cards announce "important content" — users acknowledge and resent. Slim strip + one dismiss is sufficient. |
| **Hero block with logo + H1 + 2 value-props + 2 pills** above the search | Homepage v15-v38 | v39 slimmed to one value-prop line | Pushed search input below the fold on mobile; double-branding with the sticky nav. |
| **`adopter.notes` free-text field in the profile header** | v15-v27 | v28 deprecated, migrated to observation records | The same data lived in two places (profile field vs observation records); one was always stale. |
| **`user_profiles.organization` free-text column in admin/users** | v15-v33 | v34 dropped | Two parallel "organization" systems that didn't talk to each other; the admin column always showed empty for real org members. |
| **`bg-blue-*` palette for primary surfaces** in DisclaimerToast | v30 | v32 fixed via CSS vars | The blue palette isn't remapped in `globals.css` — broke contrast in dark mode. |
| **"Mis Adopciones" chip counting all interaction types** | v15-v40 | v41 narrowed to recordType=adoption | Chip label and chip count disagreed; clicking through landed on a page that ALSO mismatched the label. |
| **Emoji used as functional UI icons** (ℹ️, ✕, ⓘ) | v30 | v36 replaced with inline SVG | Emoji rendering varies by OS/browser, doesn't inherit `currentColor`, breaks theme coherence. |

---

## 6. How to verify a design follows these guidelines

**Before merging UI work**, run through:

1. **`.agents/workflows/ui-review.md`** — mechanical compliance lint (8px grid, button matrix, color tokens, anti-pattern scan).
2. **`.agents/workflows/ux-review.md`** — humanistic review (does this serve the persona's job? does the eye land where the answer lives? are empty states designed?).
3. **Mobile-breakpoint check** — walk the journey at 375px width. See `.agents/audits/2026-05-04-mobile-breakpoint-audit.md` for the audit-style checklist.
4. **Theme switch** — toggle Claro / Azul Noche, verify everything still reads.
5. **i18n** — both `es.ts` and `en.ts` updated; switch language, verify no raw key paths leak through.
6. **Tap-target sweep** — every interactive element ≥44×44px on mobile.
7. **Logging discipline** — every state-changing action logs with input context (per CLAUDE.md "Logging Conventions").

---

## 7. References

- **`docs/design-style-guide.md`** — visual tokens (the "what does it look like" reference)
- **`.agents/workflows/ui-review.md`** — compliance lint workflow
- **`.agents/workflows/ux-review.md`** — humanistic review workflow
- **`.agents/audits/`** — periodic deep-dive audits (mobile breakpoints, etc.)
- **`CLAUDE.md`** — agent guidance, includes Logging Conventions, D1 quirks, deployment workflow
- **Memory notes** — accumulated project knowledge in `~/.claude-personal/projects/-mnt-c-dev-test/memory/`:
  - `project_theming.md` — palette remap mechanics
  - `feedback_svg_over_emoji.md` — icon rules
  - `feedback_grep_tests_before_deletion.md` — pre-delete checklist

---

## 8. When to update this document

- After a substantial UX decision is made (especially anti-patterns walked back).
- When a new persona, journey, or product surface is introduced.
- When a new pattern is established that should be reused (e.g., the avatar affordance pattern from v38/v42).
- Quarterly review: scan section 5 (anti-patterns) and section 6 (verification checklist) — anything stale?

This doc is a living contract, not a frozen spec. Treat it like the codebase: keep it pruned, accurate, and worth reading.
