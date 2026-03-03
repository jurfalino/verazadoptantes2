# Changelog

All notable changes to BuenAdoptante are documented here.

## [2.8.0-3] - 2026-03-03

### Changed
- **Always create interaction record on import** — AI prompt now classifies every post into a record type (adoption, adoption_request, follow_up, observation, returned_pet); denunciations/cruelty posts become observations
- Removed `adoptionDetected` guard — import wizard always creates an interaction record alongside the adopter profile

---

## [2.8.0-2] - 2026-03-03

### Added
- **Universal social media scraper** — scraper microservice now supports Instagram, X/Twitter, and TikTok in addition to Facebook; `fetch-content` route delegates social URLs to the Playwright scraper with Googlebot/proxy fallbacks

---

## [2.8.0] - 2026-03-02

### Changed
- **DatePicker redesign** — replaced 3-dropdown (Day→Month→Year) pattern with native `<input type="date">` for full precision; added optional "approximate date" toggle (Month+Year only, outputs `YYYY-MM`)
- **Deploy workflow** — added golden rule to always check `remotes/origin/*` when reporting deployed versions

### Fixed
- **Share target images not displaying** — Service Worker now intercepts share POST, caches images in Cache API, and ImportWizard reads them on mount; previously images were silently dropped
- **Guide page FAQ on mobile** — FAQ accordion answers were not loading on mobile breakpoints
- **Date parsing guard** — `AdoptionWizard` and `AdoptionForm` now safely handle `YYYY-MM` format by defaulting day to 1st

### Added
- **Admin menu link** — admin users now see a nav item linking to `/admin` in the header menu

---

## [2.6.0-6] - 2026-02-27

### Fixed
- **Zod date validation** — adoption date field now accepts both Date objects and ISO date strings (was rejecting all form submissions)
- **CSP connect-src for Google avatars** — service worker avatar caching no longer blocked
- **Second Google icon (Login.tsx)** — replaced external authjs.dev reference with inline SVG

---

## [2.6.0-5] - 2026-02-27

### Added
- **Zod input validation** — all server actions now validate inputs via Zod schemas (`validation.ts`) before any DB operation
- **Content-Security-Policy header** — XSS protection with allowlists for Google, Axiom, Gemini, Cloudflare

### Fixed
- **Admin access for DB-granted admins** — `admin/layout.tsx` now uses `isAdminAsync()` to check DB roles, not just the hardcoded bootstrap list
- **Country modal per-user** — `country_confirmed` localStorage key is now user-specific; switching accounts correctly triggers the modal
- **Google sign-in icon** — replaced external `authjs.dev` image (blocked by CSP) with inline SVG

### Changed
- **NextAuth pinned** — locked to exact `5.0.0-beta.30` (removed `^` range) to prevent silent breakage
- **ESLint re-enabled in builds** — removed `ignoreDuringBuilds: true` (0 errors, 82 warnings)

---

## [2.6.0-4] - 2026-02-27

### Added
- **Blocking country selection modal** — new users must select their country before using the app; replaces the dismissable banner with a full-screen modal (no close button)
- **Header language toggle** — globe icon + EN/ES text toggle visible to all users (authenticated and unauthenticated)

### Fixed
- **Next.js 15 headers() compatibility** — `headers()` in `audit.ts` now properly awaited (was causing sign-in errors)
- **Language persistence** — auto-detected browser language now saved to localStorage so it survives page refreshes
- **Post-country-selection refresh** — `router.refresh()` after country selection updates the header to show user menu

### Changed
- **Country modal UX** — detected country shows confirm/change flow; no detection shows quick-picks (AR, UY, CL, MX) + full searchable dropdown

---

## [2.6.0] - 2026-02-22

### Added
- **Private profiles** — adopter profiles now require authentication; unauthenticated visitors are redirected to login with a "Sign In Required" toast, then returned to the profile after sign-in
- **Shared type system** — new `types/adopter.ts` with typed interfaces (`Adopter`, `AdoptionRecord`, `AdopterImage`, etc.) replacing `any` throughout adopter components
- **Shared adoption filter utility** — `lib/adoptionFilters.ts` with `countRecordsInPeriod()` used by both `AdopterForm` and `AdopterProfile`
- **Extracted text utilities** — `lib/textUtils.ts` with reusable `renderTextWithLinks()` for clickable URLs, emails, and phone numbers

### Changed
- **Code quality refactor** — addressed 14 of 15 audit findings across `AdopterForm.tsx` and `AdopterProfile.tsx`:
  - Hydration-safe date computations via `useMemo` reference date
  - Deduplicated auth check to single `useMemo`-based `isAuthenticated`
  - Removed pointless `adopter = initialData` alias
  - Simplified country name IIFE to closure
  - Forwarded `isAdmin` prop to `AdopterForm`
  - Removed dead `onEdit` callback from `AdoptionHistory`
  - Removed `as any` cast on translation key
  - Cleaned up trailing spaces and empty blank lines
- **Internationalized labels** — period labels (90 Days, 1 Year, All Time) and duplicate match type labels now use i18n keys in both EN/ES

---

## [2.5.5-1] - 2026-02-22

### Fixed
- **Admin sidebar mobile layout** — improved mobile nav responsiveness in admin layout and sidebar component

---

## [2.5.5] - 2026-02-13

### Fixed
- **Favicon missing in staging** — added explicit `<link rel="icon">` tag in layout pointing to `/icon.svg`
- **Search query logging failing in production** — added missing unique constraint on `searches.query` column required by `onConflictDoUpdate` upsert; every search was silently failing to log

---

## [2.5.3.1] - 2026-02-13

### Added
- **Enriched admin adopters list** — card layout with thumbnails, server-rendered rating badges, stats (searches, views, requests, adoptions), flags, and dates replacing basic table
- **Reusable enrichment module** — `enrichAdopters.ts` extracts shared logic from search pipeline for consistent data across search and admin views
- **Audit log IP & device capture** — `logAudit()` auto-captures IP address (`CF-Connecting-IP`) and User-Agent from request headers; all callers get data for free
- **Audit log IP geolocation links** — IP column links to `ipinfo.io` for free geolocation lookup
- **Mobile-responsive admin layout** — sidebar converts to slide-in drawer on mobile with hamburger menu, active route highlighting
- **Logo favicon** — replaced default Next.js triangle with teal shield+paw SVG matching the app logo

### Changed
- **Admin sidebar** — extracted to `AdminSidebar.tsx` client component with responsive behavior
- **Audit table** — horizontally scrollable on mobile (`overflow-x-auto`), filters wrap on small screens
- **Search action refactored** — removed ~130 lines of inline enrichment code in favor of shared module

---

## [2.5.3] - 2026-02-13

### Added
- **Custom DatePicker component** — day/month(3-letter)/year dropdowns replacing native `<input type="date">` to avoid DD/MM vs MM/DD ambiguity
- **Adoption card verb translations** — `verb_adopted`, `verb_requested`, `verb_noted`, `verb_followed_up`, `verb_returned` in EN/ES
- **Missing i18n keys** — `duplicates.view_profile`, `duplicates.dismiss` added to both locales
- **Theme overrides for record-type borders** — dark and apple theme support for `border-l-sky-400`, `border-l-amber-400`, `border-l-violet-400`, `border-l-rose-400`

### Changed
- **Redesigned adoption record cards** — one-line summary format (`{date} — {verb} {animal} ({species})`), colored left border by record type, neutral notes background, star ratings inline
- **Section renamed** — "Adopciones"/"Adoptions" → "Interacciones"/"Interactions" to reflect all record types
- **CTA button renamed** — "Registrar Nueva Adopción" → "Nueva Interacción" for clarity

### Fixed
- **Search crash on back-navigation** — added null guard on `searchAdopter` response preventing `Cannot read properties of undefined` errors
- **Spanish "adoption" leak** — fixed `|| 'adoption'` fallback treating empty Spanish `word_adoption` as falsy, changed to `??` operator

---

## [2.5.1] - 2026-02-12

### Fixed
- **Duplicate user accounts** — `ensureUserProfile` now looks up users by email instead of random JWT `user.id`, preventing new rows on every sign-in
- **40 ESLint warnings** — cleaned up `no-unused-vars`, `prefer-const`, and `alt-text` across the codebase

### Changed
- **E2E tests rewritten** — replaced shallow tests with real user journeys (search-to-decision, full adoption record CRUD, import wizard flow); fixed auth setup for CI
- **Stats aggregation pushed to SQL** — `COUNT + CASE WHEN` replaces JS-side filtering for profile statistics
- **Consolidated `getDb()`** — removed duplicate database helper; canonical version in `src/lib/db.ts`
- **Extracted business constants** — inline magic numbers moved to `src/config/constants.ts`
- **LoginModal overlay** — sign-in redirects to homepage with modal instead of blank page; session expired toast (EN/ES)

### Added
- **CI lint ratchet** — ESLint warning count enforced in CI pipeline
- **E2E tests in CI** — Playwright tests run on push with JWT-based auth and D1 seeding
- **`workflow_dispatch` trigger** — CI can be triggered manually and on `e2e_tests` branch

---

## [2.4.3] - 2026-02-11

### Changed
- **Refactored `actions.ts`** — split 1,463-line monolith into 10 domain-specific modules under `src/app/actions/` with barrel re-exports (zero breaking changes to consumers)

### Removed
- **Dropped `adoption_images` table** — unused table (empty in production); all adoption images are stored in `adopter_images` via the `adoption_id` column

---

## [2.4.2] - 2026-02-09

### Changed
- **Date formatting standardized** — all date displays now use 3-letter month abbreviations (e.g. "Feb 4 '26") via shared `dates.ts` utility; removed 5 duplicated local format functions across 12 files
- **AI extraction prompt hardened** — dedicated `SOCIAL PROFILES — CRITICAL` section ensures Instagram handles and @mentions are always captured; lists common IG patterns (ig:, insta:, 📷)

### Fixed
- **Instagram handle extraction** — AI was skipping @handles due to overly aggressive anti-hallucination rules; now correctly extracts all social profiles
- **500 error on save to existing adopter** — added missing `source_url` column to local D1 adoptions table

### Removed
- **FacebookImportWizard** — removed unused legacy component

---

## [2.4.0] - 2026-02-09

### Added
- **PWA support** — installable Android/iOS app with offline caching, share target (receive from WhatsApp/Instagram), install CTA on homepage
- **New brand logo** — green shield + white paw icon in nav and home page
- **Import wizard i18n** — full EN/ES translation, image selection/lightbox, proxy-image universal
- **Smart import flow** — single input with auto URL detection, share intent integration, progress percentage, address/social/record type support
- **UX onboarding** — how-it-works guide, search hints, import action card, flag legend, sample record
- **Legal compliance** — privacy policy, terms of service, consent notice, profile disclaimer
- **Data request tracking** — inline report form and admin panel for ARCO rights requests
- **User registry** — `user_profiles` table, admin page with inline editing, mailto links, first sign-in tracking
- **System audit log** — `audit_log` table with filtering, pagination, device/PWA badges, configurable retention
- **Session version check** — middleware-enforced JWT versioning to force re-authentication on deploy
- **Admin data import/export** — environment migration tool for moving data between staging and production
- **Photo upload** — image upload during adoption creation with queue and upload on save
- **Dynamic social icons** — source URL icons on adoption cards (Instagram, Facebook, WhatsApp, etc.)

### Changed
- **Unified import flow** — consolidated Facebook/URL/text import into single smart input
- **Contact fields** — consolidated into single WYSIWYG textarea
- **Feature flags** — consolidated into single `ENABLE_CONTENT_IMPORT` flag
- **Search placeholder** — updated to "Name, Phone, or Address" (EN/ES)
- **Install CTA** — removed dismiss button, replaced misleading offline benefit with home screen benefit

### Fixed
- **Session management** — added `middleware.ts` for proper NextAuth v5 auth enforcement
- **Species labels** — locale-aware translation on adoption cards
- **AI contact labels** — locale-aware labels for extracted contact info
- **ESLint config** — rewrote to use FlatCompat, downgraded noisy rules to unblock CI
- **D1 compatibility** — `COALESCE` instead of `NULLS LAST` in user queries
- **Edge sign-in** — populate user table when adapter is disabled on Cloudflare Edge

---

## [2.1.0] - 2026-02-08

### Added
- **Schema health endpoint** (`/api/health`) — validates all database table columns against expected schema, catches migration drift
- **Schema smoke test** — Playwright test calls `/api/health` and fails with detailed mismatch report
- **Axiom error logging** on all 24 server action catch blocks — every error now reaches Axiom with context (function name, entity IDs, error ID)
- **Error ID propagation** — mutation errors include an error ID in thrown messages for end-to-end correlation (Axiom → server → toast → user)
- **Facebook import wizard** with AI extraction, duplicate detection, and i18n (EN/ES)
- **API route for adding records** (`/api/adopters/[id]/add-record`) with phased mutation logging

### Changed
- **Alert → toast migration** — replaced all 28+ `alert()` calls across 11 components with toast notifications (`useShowToast`)
- Adopter creation API route with duplicate/match checking

### Fixed
- **Production database schema** — manually applied 3 missing columns (`adopters.added_by`, `adoptions.record_type`, `adoptions.source_url`)
- **Staging database schema** — applied missing `adoptions.source_url` column
- Marked migration `0010` as applied in both environments

---

## [2.0.1] - 2026-02-08

### Added
- Production readiness hardening — security headers, auth guards, structured logging
- Authenticated E2E test suite with programmatic login
- Debug endpoint cleanup

---

## [2.0.0] - 2026-02-04

### Added
- Observability and error handling improvements
- Axiom logging integration
- Toast notification system
- Unique error IDs for log correlation
- Parallelized database queries for performance

---

## [1.9.0] - 2026-02-02

### Added
- Admin dashboard features
- Adopter management and flagging system

---

## [1.8.0] - 2026-01-28

### Added
- Observation flow and i18n additions

---

## [1.7.1] - 2026-01-26

### Fixed
- Bug fixes and stability improvements

---

## [1.7.0] - 2026-01-25

### Added
- Internationalization (EN/ES) support

---

## [1.2] - 2026-01-24

### Added
- Compact UI
- Merged history view
- Premium theme system
