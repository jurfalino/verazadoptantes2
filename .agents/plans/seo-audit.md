# SEO Audit & Remediation Plan

**Date:** 2026-05-06
**Owner:** jurfalino
**Scope:** Public, indexable surface of buenadoptante.org

## Context

Senior-SEO audit run on the staging branch. Findings cover sitemap, structured data, robots, on-page semantics, OG metadata, and assets. This plan groups them into three tiers by deployment risk so the safe tier can ship alongside the in-progress feature without waiting on architectural decisions.

## Public-pages inventory

**Indexable:** `/`, `/guia`, `/guia/faq`, `/funcionalidades`, `/demo-profile`, `/privacy`, `/terms`, `/health` (currently — should be noindex).
**Public + intentionally noindex:** `/adopter/[id]`, `/contract/[id]`, `/form-results/[submissionId]`, `/contract-results/[notificationId]`, `/invite/[token]`.
**Public + accidentally indexable (problem):** `/notificaciones`, `/organizations` — soft client-auth-gated only, no `robots: { index: false }`.

## Tier 1 — ship now (no risk, this PR)

1. **Generated missing icons** — `public/apple-touch-icon.png` (180×180) and `public/icon-192.png` (192×192) created from `icon-512.png` via `scripts/generate-icons.cjs`. Stops 404s referenced from `layout.tsx` and `manifest.json`.
2. **Add `sr-only` `<h1>` on home** with keyword-rich copy. Honors the deliberate "slim search-first hero" decision (commit `7ea52f8`) while restoring the primary heading semantic for crawlers and screen readers.
3. **Demote home action-card `<h3>`s → `<h2>`** so heading hierarchy is sane once h1 lands.
4. **Wire `GuideHowToJsonLd` into `guia/layout.tsx`** — extract `STEPS` constant from `src/app/api/guide-content/route.ts` to a shared `src/content/guide-data.ts`, render JSON-LD server-side in layout. Same approach for `FaqPageJsonLd` in `guia/faq/layout.tsx`.
5. **Sitemap fixes** — add `/funcionalidades`, replace `lastModified: new Date()` with a build-time constant pulled from `package.json` version (or `Date.now()` evaluated at module-load, frozen per build).
6. **Robots & noindex hygiene:**
   - Add `/notificaciones`, `/organizations`, `/contract`, `/form-results`, `/invite`, `/health` to `robots.ts` disallow.
   - Add `export const metadata = { robots: { index: false } }` to `notificaciones/page.tsx` and `organizations` (via a layout) and `health/layout.tsx`.
7. **Update `softwareVersion`** in `WebApplicationJsonLd` to read from `package.json` instead of hardcoded `'2.9.0'`.
8. **Translate manifest.json description** to Spanish (default locale).
9. **Fix `screenshot` URL** in `WebApplicationJsonLd` — currently points to an icon, not a screenshot. Use `/og-image.png` until a real screenshot is produced.
10. **Drop empty `sameAs: []`** from `OrganizationJsonLd`.

## Tier 2 — defer (architectural decisions needed first)

11. **Remove `dynamic = 'force-dynamic'` from root layout.** `auth()` reads cookies → Next.js infers dynamic anyway, so this *should* be safe, but session-caching edge cases warrant a dedicated PR with monitoring.
12. **Bilingual hreflang.** Either commit to `/en` URLs with proper `alternates.languages` (`es-AR` / `en` / `x-default`) or strip `alternateLocale: 'en_US'` from root layout to stop making a fake bilingual claim. Needs product decision.
13. **Dynamic `<html lang>`.** Source-of-truth question (cookie vs. localStorage vs. session) and hydration-mismatch risk. Couple with #12.
14. **Add `/notificaciones` & `/organizations` to `PROTECTED_ROUTES`.** UX change — anon users currently see empty shells, would start getting redirected. Tier-1 noindex resolves the SEO half without UX risk.

## Tier 3 — design / content work

15. **Per-page OG images** for `/guia`, `/funcionalidades`, `/guia/faq` (Next.js `opengraph-image.tsx`). CTR upside on social and LLM-citation cards.
16. **Real product screenshot** for `WebApplicationJsonLd.screenshot`.
17. **Populate `OrganizationJsonLd.sameAs`** with real social URLs once they exist.
18. **`ItemList` schema on `/funcionalidades`**, light `Person` schema on `/demo-profile`, `BreadcrumbList` on `/guia/faq`.
19. **Drop `keywords` meta** in root layout (Google-ignored; harmless filler).
20. **Stronger home title** — replace generic "BuenAdoptante — Registro de Adopciones" with a search-intent-aligned title once stakeholders agree on primary keywords.

## Deferred-tier risk notes

- `force-dynamic` removal is the highest-leverage win in Tier 2 (every public page becomes statically renderable / ISR-able), but should land alone with a deploy + 24h monitoring window.
- Bilingual hreflang is a fork in the road: bilingual SEO doubles content surface to maintain. If the answer is "Spanish-first, English secondary forever," #12 collapses to "remove alternateLocale" and we save the engineering cost.
