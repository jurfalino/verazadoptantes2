# Changelog

All notable changes to BuenAdoptante are documented here.

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
