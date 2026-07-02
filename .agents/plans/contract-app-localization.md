# Plan — Contract-app full localization (es / en / pt-BR)

**Date:** 2026-07-01 · **Model:** one language per shared artifact, driving the WHOLE screen (chrome + content + PDF). Language is set by the sharer at share time; resolution order `?lang=` → API-provided locale → default `es`.

## Scope (from the code map)

The contract-app is a standalone Vite SPA with **~180 hardcoded Spanish strings**, **no i18n system**, and **no locale signal** reaching it.

| Surface | Where | Notes |
|---|---|---|
| Chrome (buttons, labels, validation, headings) | 8 TSX files, ~120 strings | `PetShieldForm.tsx` (49), `ContractPage.tsx` (25), `TermsPage.tsx` (13), `Showcase.tsx` (10), `AnimalDetail.tsx` (10), `HomePage.tsx` (7), others |
| **Contract body** (legal, ~5–6 pages, 5 sections) | **DUPLICATED** in `ContractPage.tsx` (JSX display, ~326–483) **and** `contractPdf.ts` (PDF, ~100–240) | Interpolates `{animalName}`, `{species}`, adopter fields, date. **Two copies today → drift risk.** |
| PDF labels/month names/date | `contractPdf.ts`, ~60 strings | Signed-contract output |
| Form schema (21 steps) | `PetShieldForm.tsx` `DEFAULT_SCHEMA` (~52–220) | Titles, options, placeholders, validation — all hardcoded es |
| Terms (10 legal sections) | `TermsPage.tsx` | Legal text |

**Two findings that shape the design:**
1. **The contract body is duplicated** (screen + PDF). Localizing naively = 2 copies × 3 languages = 6 hand-maintained copies of a legal doc. Must extract to a single source.
2. **The contract body + terms + data-consent are legal text.** pt/en versions need human/legal review before they're authoritative. (A bilingual es/en `content/adoption-contract/index.json` exists but is **unused** — the app hardcodes instead.)

## Architecture

1. **i18n in contract-app** — a lightweight `t(locale, key)` + `es/en/pt` chrome catalogs. Locale is fixed per page-load (it comes from the shared artifact, not a user toggle), so a tiny `LocaleProvider` resolving once at entry is enough — no heavy library.
2. **Single source of truth for contract content** — extract the contract template into ONE per-locale module (`contractContent.ts`, es/en/pt) consumed by **both** the on-screen render **and** the PDF generator. Removes the duplication and the drift risk. Placeholders preserved.
3. **Form schema** — make `DEFAULT_SCHEMA` labels/options/placeholders/validation locale-aware (keyed strings or per-locale schema).
4. **Terms** — per-locale content.
5. **PDF** — locale-aware labels, month names, and date formatting sourced from the same content module.

## Locale threading (main app → shared artifact → contract-app)

- **Contracts** (`/c/{token}`): add nullable **`locale` column to `contractInvitations`**, set in `createContractInvitation()` from the sharer's client locale; return it from `/api/contract/by-token`. Authoritative + survives link copying.
- **Forms** (`/form?u={userId}`): append `?lang=<locale>` when the share URL is generated.
- **Showcase / AnimalDetail** (`/all`, `/org/{slug}`, `/user/{handle}`, `/animal/{id}`): `?lang=` on the shared URL.
- **Resolution in contract-app:** `?lang=` → API-provided `locale` → `es`.
- **Main-app share points to update:** `createContractInvitation()` (`contract.ts`), `ShareMenu`, `ShowcaseUrlChips`, applicants share surfaces.

## Legal-content review gate

The contract body, terms, and data-consent clauses are legally operative. Plan: I produce **draft** pt + en translations and ship them to **staging** for review; **hold prod promotion of the legal-body translations until a human/legal sign-off**. `es` is unchanged (authoritative today). Chrome + form-schema translations don't carry the same legal weight and can ship normally.

## Phasing

- **P1** — contract-app i18n infra + all chrome strings (es/en/pt) + locale resolution from URL. (No legal text yet; low risk.)
- **P2** — extract contract content to the single-source per-locale module (screen + PDF) + terms + form schema. (Contains the legal drafts.)
- **P3** — main-app locale threading: `contractInvitations.locale` column + `createContractInvitation()` + share-point `?lang=` stamping + API passthrough.
- **P4** — legal review of pt/en bodies → verify → promote to prod.

## Decisions (LOCKED 2026-07-02)

1. **Languages:** ✅ **es + en + pt** (all three).
2. **Legal rollout:** ✅ **Draft to staging, hold prod for sign-off.** I write draft pt/en legal text; it ships to staging for in-context review; the translated legal body is NOT promoted to prod until human/legal sign-off. `es` stays authoritative throughout.
3. **Schema change** (`contractInvitations.locale`, nullable): ✅ **approved** (hand-written migration).
4. **Single-source contract-content extraction** (de-dup screen vs PDF): ✅ **approved.**
5. **Sharer override:** default artifact language = sharer's locale at share time; explicit picker **deferred**.

## Execution structure

- **i18n core** (build by hand — architectural): `contract-app/src/i18n/` → `types.ts` (Locale), `LocaleContext.tsx` (`LocaleProvider` + `useT()` + `resolveInitialLocale()` reading `?lang=`, default es, with `setLocale` for the post-fetch contract-record fallback), `index.ts` barrel merging per-screen catalog slices.
- **Per-screen catalog slices** `i18n/catalogs/<screen>.ts` each export `{ es, en, pt }` for that screen's keys. Screens: `common`, `contract`, `form`, `terms`, `showcase`, `home`, `animal`, `pdf`. Disjoint files → chrome extraction fans out to parallel agents race-free (each owns one TSX + its catalog slice).
- **Legal content** (`contractContent.ts`, single source for screen + PDF; es/en/pt) — built by hand given legal sensitivity; pt/en are DRAFTS pending review.
- **Main-app threading** — `contractInvitations.locale` column + `createContractInvitation()` stamping + `/api/contract/by-token` passthrough + `?lang=` on form/showcase share URLs (`ShareMenu`, `ShowcaseUrlChips`).

Checkpoint after P1 (infra + chrome) builds green in contract-app before fanning out legal content + threading.
