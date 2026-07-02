# Plan — Add Portuguese (pt-BR) as a third locale

**Date:** 2026-07-01 · **Variant:** Brazilian Portuguese (pt-BR), register **você** (warm, mirrors the app's Argentine-Spanish voseo tone).

## Scope (confirmed)

Full app. But verification showed the surface is smaller than feared:
- ✅ **UI locale file** `src/i18n/locales/pt.ts` — ~1000 keys (main work).
- ✅ **Plumbing** — `LanguageContext.tsx` (Locale type, dictionaries, detection), `LanguageSwitcher.tsx` (add option).
- ✅ **Guide/FAQ runtime content** — `src/content/guide-data.ts` (hand-maintained TS, `*Es`/`*En` paired) + readers `src/app/guia/page.tsx`, `src/app/guia/faq/page.tsx` (`pick(es,en)` → locale-aware 3-way).
- ✅ **contract-app** — separate Vite string surface (its own catalog; stage 3).
- ❌ **`content/*.mdoc` + Keystatic schema** — DEAD WEIGHT. Nothing reads it at runtime; `@keystatic` is not a dependency; no `/keystatic` route. Editing it renders nothing. **Skipped** (guide-data.ts is canonical).

## Approach (locked, per advisor)

1. **Base on `es`, translate in-place.** `cp es.ts pt.ts`, rename export `es`→`pt`. es is DEFAULT + fallback + most complete (1911 vs 1905) + right register; es→pt-BR is linguistically closest. **Never regenerate the TS** — in-place value edits preserve keys + placeholder positions.
2. **tsc = completeness gate.** `Dictionary = typeof en`, so any en-key missing from pt errors. Backfill en-only keys tsc flags (extra es-only keys are fine).
3. **Token-integrity gate.** Script-diff the `{token}` / `<tag>` / `%s` multiset es-vs-pt per key. Catches silent placeholder drift (the highest-severity mechanical failure; tsc misses it).
4. **Accuracy-review pass.** Fresh read against the glossary + false-friend traps below. This is what "accurate" actually demands — not optional.
5. **Missing pt keys fall back to es (not raw keys)** → pt is safe to ship incomplete → stage into CI-green commits.

## Staging (CI-green commits)

1. Plumbing (`Locale` type, dictionaries, detection, switcher) + full `pt.ts`.
2. `guide-data.ts` (types + Pt values) + guia/faq readers.
3. contract-app strings.

## Locked glossary (hold everywhere — no drift)

| ES | pt-BR |
|---|---|
| adoptante | **adotante** |
| adopción | **adoção** |
| rescatista | **resgatista** (protetor(a) when tone fits) |
| tránsito (foster) | **lar temporário** |
| seguimiento | **acompanhamento** |
| ficha / perfil | **ficha / perfil** |
| denuncia | **denúncia** |
| reporte / reportar | **relato / relatar** (reportar OK for action) |
| maltrato | **maus-tratos** |
| hogar | **lar** |
| registro (record) | **registro** |
| entrega (handover) | **entrega** |
| refugio | **abrigo** |

Register: **você** (not tu). Second-person imperatives → você form (e.g. "Buscá"→"Busque", "Registrá"→"Registre").

## False-friend traps (es→pt-BR — verify each, do NOT cognate-copy)

- rojo → **vermelho** (NOT roxo=purple)
- apellido → **sobrenome** (NOT apelido=nickname)
- largo → **comprido/longo** (NOT largo=wide)
- oficina → **escritório** (NOT oficina=workshop)
- presunto (alleged) → **suposto/presumido** (NOT presunto=ham)
- embarazada → **grávida** (NOT embaraçada=embarrassed)
- vaso → **copo** (glass) (NOT vaso=pot/vase)
- exquisito → **requintado/delicioso** (NOT esquisito=weird)
- borrar → **apagar/excluir** (NOT borrar=smudge)
- cerca (near) → **perto** (NOT cerca=fence)
- todavía (still) → **ainda** (NOT todavia=however)

## Non-goals / notes

- `html lang="es"` (layout.tsx:106) stays "es" for all locales today (same as en) — cosmetic SEO gap, not a regression. Not touched.
- ThemeSelector labels remain non-i18n'd (existing behavior).
