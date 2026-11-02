# One identity verdict for every surface — design (2026-11-02)

## Why

Eight surfaces ask the same question — *is the person arriving someone we already have?* — through four engines with different rules (inventory and a 7-example run on staging code: `proto-shots/estrategias-busqueda/index.html`, main checkout). The same person gets different answers depending on the screen:

- The sheet import proposes «Actualizar» on a profile that only shares a phone with the row, whatever the name (a partner's activity lands on the wrong profile). Every other surface either shows the match for a human or, like API exact, creates a separate profile.
- A same-full-name person with different contacts is dropped by the duplicate engine (`runDuplicateMode`'s strong-signal suppression), so the sheet import, the social-post import, the «Nuevo adoptante» form and «Pendientes de revisar» all stay silent. Only the search box shows them.
- The «Nuevo adoptante» form (also «Agregar conviviente» and the phone interview) never sends the DNI (`FormDuplicateInput` has no ids).
- The social-post import turns contacts into text and back (`contactEntriesToBlob` → `parseBlobToContactEntries`); a bare handle comes back as `other` and never matches.
- The search box and API fuzzy treat an email, DNI or handle in the query as a word; one non-matching name word demotes an identical-email profile to «Otras posibles coincidencias».
- API exact refuses socials as an identifier, and creates a new profile on a matching DNI with an incompatible name.

## Goal

One pure verdict — **same person / possible / no** — computed the same way for every surface. Surfaces differ only in *what they do* with each verdict (a product table, Jon's). A permanent golden test runs the same examples through every surface.

## Non-goals

- Changing how a plain-name query in the search box ranks name matches.
- Linking a Facebook vanity URL to the same account's numeric id (Facebook offers no way).
- Rewriting the admin Scan (it pairs saved profiles; it may adopt the verdict later).
- Changing the percentages shown on cards (they stay for ordering and display).

## Anti-goals

- A silent «Actualizar»/merge into the wrong person.
- «Revisar» flooded by common names.
- A slower sheet import or form.

## Decisions (Jon, 2026-11-02)

1. **A matching DNI is enough on its own** — same person even when the name is incompatible, on every surface (API exact included).
2. **DNIs get the same junk protections as phones:** placeholder values never count (one digit repeated, `12345678`-style sequences, mirroring `isPlaceholderPhone`), and a DNI found on more than 3 differently-named profiles links nobody (mirrors `MAX_NAMES_PER_KEY` in `importGrouping`). Prod today: 76 DNIs, 0 junk, 2 shared by 2 profiles.
3. **A social account counts like a phone or an email:** same account + compatible name = same person; same account + incompatible name = possible. Never on its own.
4. **API exact accepts a social account as an identifier** (name + social is a valid exact call).
5. **A visible name typed in a social field is not an account** (already true: `normalizeSocialHandle` returns null for values with spaces). It is saved as a «Conocido/a como» (alias) so search finds it. Prod: 2,569 of 7,083 social values (36%). **Converting the existing ones in production needs Jon's OK at run time.**

## Design

### 1. One description of the arriving person — `PersonFacts` (domain)

`{ name, aliases[], phones[], emails[], socials[] (classified), documentIds[], country }`. One builder per input shape (contact entries, sheet row, form state, API person, social post) — all producing typed fields, never a text blob. Socials are classified at build time: handle (from `@x`, a bare token, or a URL path) · Facebook numeric id · visible name (→ `aliases`).

### 2. Candidate retrieval (data access) — never drops anyone

Exact token lookups for each identifier (phone incl. last-8, email, social handle, DNI) and the `name_full` token, plus today's name-word prefix lookups for typo tolerance. Returns each candidate with what it shares. No scoring decisions, no suppression. Bounded per call (same D1 rules: no `inArray`, a shared query budget).

### 3. The verdict (domain, pure) — `judgeIdentity(incoming, candidate)`

Returns `{ verdict: 'same' | 'possible' | 'no', reasons[] }`, first rule that fires:

| # | Shares | Name | Verdict |
|---|---|---|---|
| 1 | a non-junk DNI | any | same |
| 2 | phone, email or social account | compatible | same |
| 3 | phone, email or social account | incompatible | possible |
| 4 | nothing | full name compatible, 2+ words, and the full name is rare | possible |
| 5 | — | — | no |

- *Compatible* = `namesCompatible` from `src/domain/apiExactMatch.ts` (every word of the shorter name in the longer, any order, one typo per word; aliases count). The sheet's within-file `namesAgree` moves to the same rule.
- *Junk identifier* (any type): placeholder value, or found on more than 3 differently-named profiles → it does not count as shared.
- *Rare full name* (rule 4): its `name_full` token is held by at most **N** profiles. **N is open (Jon)**; proposal: 5.
- An incoming person with no contacts at all can only reach rule 4 or 5.

### 4. What each surface does (proposal — Jon to confirm)

| Surface | same | possible |
|---|---|---|
| Sheet import | «Actualizar» (default) | «Revisar» |
| Social-post import | listed, pre-selected | listed, not pre-selected |
| «Nuevo adoptante» · «Agregar conviviente» · interview | «¿Es este perfil?», first | «¿Es este perfil?», after |
| «Ya existe en otro perfil» warning | shown | shown |
| Public form · contract · API creating a profile | pair in «Pendientes de revisar» | pair in «Pendientes de revisar» |
| API exact | activity added to that profile | new profile + pair in «Pendientes de revisar» |
| Search box · API fuzzy | top of the main list | today's ranking |

«Ya existe en otro perfil» receives one contact only, so its candidates are judged on that contact alone (rules 1–3 with the name treated as compatible).

### 5. Search box and API fuzzy

Identifiers typed in the query (phone already; add email, DNI, handle) are pulled out into `PersonFacts`; candidates judged **same** go to the top of the main list. API fuzzy passes its structured fields directly instead of joining them into text. Plain-name ranking is unchanged.

### 6. The golden test

The 7 examples of the comparison page (plus junk-DNI and visible-name-social cases) become one test that runs every surface's real entry point on a migrated DB (`src/test-utils/migratedDb`) and asserts the action each takes. A surface that drifts from the verdict fails the build.

## Rollout (each step ships to staging on its own)

1. `PersonFacts` + `judgeIdentity` + junk guards + the golden test (surfaces still old: the test documents today's gaps as expected failures).
2. Sheet import (fixes the partner-phone «Actualizar» and the silent same-name row).
3. «Nuevo adoptante» form family + social-post import (DNI, handles).
4. «Pendientes de revisar» creation and API exact (socials accepted, DNI alone).
5. Search box + API fuzzy ranking.
6. Visible-name socials → «Conocido/a como»: new values from step 3 on; the production conversion of existing values only on Jon's OK.

## Calls made in the design (Claude, technical — check while reading)

- **Housemates' contacts never count as the candidate's.** Since households as profiles (v2.58.0) every profile tokenizes only itself (`householdSearch.test.ts` pins it), so a partner's phone is only on the partner's own profile.
- **«Actualizar» on «same» is a default, not a silent write.** The sheet's Duplicados step still shows it before anything is saved. Only API exact acts without a human, as today.
- **DNI sources:** `id` contact entries plus labeled ids in notes («DNI 30123456»), exactly what the index holds today (`extractIds`, ≥5 chars, ≥4 digits). The form (`id` entries), the sheet (DNI column → `ids`), the post import (`id` entries) and the API (`documentId`) all feed `documentIds`. One normalizer (`normalizeIdValue`).
- **Junk counts are computed by retrieval, not the verdict:** for each shared identifier, the number of distinct names among live (non-deleted) profiles holding it. The verdict stays pure and takes those counts as input. The sheet's within-file grouping keeps its own guard.
- **Rare full name counts exact `name_full` tokens** (primary names and aliases) over all live profiles, not scoped to the viewer. A typo variant of the full name does not reach rule 4 — accepted.
- **Visibility unchanged:** retrieval is not viewer-scoped (as duplicate mode today); everything shown goes through the existing hydration and PII masking, and «Pendientes» pairs are created across owners as today (collaborative vetting).
- **Several «same» candidates:** the one sharing the most identifiers wins (then the profile's own name over an alias, then the most recent activity — today's `pickBestMatch`); the others stay listed («También coincide con» / `otherMatches`).
- **API exact contract:** «same via DNI with an incompatible name» answers `found` with `nameMatchedAs: 'document'` (new value); `matchedOn` gains `social`. Both announced in the API changelog before release.
- **Golden test shape:** a table of expected actions per surface; each rollout step flips its own surface's expectations from today's behavior to the verdict's. No skipped or `fails` tests.

## Open (Jon)

- Confirm the surface table (§4).
- N for a rare full name (proposal 5).

## Left to the builder

Module boundaries and names, the query budget, how the verdict's reasons map to the existing match chips, and keeping the API v1 response schema backward compatible (new `matchedOn: 'social'` value must be announced in the API changelog).
