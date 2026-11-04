# One identity verdict for every surface — design (2026-11-02)

## Why

Eight surfaces ask the same question — *is the person arriving someone we already have?* — through four engines with different rules (inventory and a 7-example run on staging code: `proto-shots/estrategias-busqueda/index.html`, main checkout). The same person gets different answers depending on the screen:

- The sheet import proposes «Actualizar» on a profile that only shares a phone with the row, whatever the name (a partner's activity lands on the wrong profile). Every other surface either shows the match for a human or, like API exact, creates a separate profile.
- A same-full-name person with different contacts is dropped by the duplicate engine (`runDuplicateMode`'s strong-signal suppression), so the sheet import, the social-post import, the «Nuevo adoptante» form and «Pendientes de revisar» all stay silent. Only the search box shows them.
- The «Nuevo adoptante» form (also «Agregar conviviente» and the phone interview) never sends the DNI (`FormDuplicateInput` has no ids).
- The social-post import turns contacts into text and back (`contactEntriesToBlob` → `parseBlobToContactEntries`); a bare handle comes back as `other` and never matches.
- The search box and API fuzzy treat an email, DNI or handle in the query as a word; one non-matching name word demotes an identical-email profile to «Otras posibles coincidencias».
- API exact refuses socials as an identifier. (It also creates a new profile on a matching DNI with an incompatible name — listed here as a gap at first; since the 2026-11-02 correction, decision 1, that is the intended answer.)

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

1. **A DNI counts exactly like a phone** (Jon 2026-11-02 correction: «do the same for documents that we do for phones»): a shared DNI + compatible name → same; + another name → possible, on every surface (API exact included). There is no «DNI alone = same person» rule, and it no longer matters whether the profile holds the DNI in its DNI field or only in a note. *(Supersedes the first version of this decision, «a matching DNI is enough on its own».)*
2. **DNIs get the same junk protections as phones:** placeholder values never count (one digit repeated, `12345678`-style sequences, mirroring `isPlaceholderPhone`), and a DNI found on more than 3 differently-named profiles links nobody (mirrors `MAX_NAMES_PER_KEY` in `importGrouping`). Prod today: 76 DNIs, 0 junk, 2 shared by 2 profiles.
3. **A social account counts like a phone or an email:** same account + compatible name = same person; same account + incompatible name = possible. Never on its own.
4. **API exact accepts a social account as an identifier** (name + social is a valid exact call).
5. **A visible name typed in a social field is not an account** (already true: `normalizeSocialHandle` returns null for values with spaces), **and it stays exactly as the rescuer typed it** — never converted to «Conocido/a como», in new or existing data (Jon, 2026-11-02: «we want to be faithful to information entered by users»; supersedes the earlier alias conversion). The verdict does not use it as an identifier or as a name; search already finds it as text.
6. **The same full name always goes to «Revisar»** (rule 4), however common the name (Jon, 2026-11-02).
7. **The surface table (§4) is confirmed** (Jon, 2026-11-02).
8. **Two «same» matches whose names don't agree with each other → «Revisar»** (sheet import default; e.g. «Gómez» + a phone shared by Ana Gómez and Juan Gómez). Two «same» that agree with each other (likely duplicate profiles of one person) keep «Actualizar» on the best (Jon, 2026-11-02).
9. **A row with no name** sharing a phone, email, social or DNI is «possible» → «Revisar» (Jon, 2026-11-02; the DNI exception was removed by the decision 1 correction).
10. **On an identical-copy row, picking a «También coincide con» profile** shows «Posible duplicado de» and is left out of bulk «apply to all exact» (Jon, 2026-11-02).

## Design

### 1. One description of the arriving person — `PersonFacts` (domain)

`{ name, aliases[], phones[], emails[], socials[] (classified), documentIds[], country }`. One builder per input shape (contact entries, sheet row, form state, API person, social post) — all producing typed fields, never a text blob. Socials are classified at build time: handle (from `@x`, a bare token, or a URL path) · Facebook numeric id · visible name (→ `aliases`).

### 2. Candidate retrieval (data access) — never drops anyone

Exact token lookups for each identifier (phone incl. last-8, email, social handle, DNI) and the `name_full` token, plus today's name-word prefix lookups for typo tolerance. Returns each candidate with what it shares. No scoring decisions, no suppression. Bounded per call (same D1 rules: no `inArray`, a shared query budget).

### 3. The verdict (domain, pure) — `judgeIdentity(incoming, candidate)`

Returns `{ verdict: 'same' | 'possible' | 'no', reasons[] }`, first rule that fires:

| # | Shares | Name | Verdict |
|---|---|---|---|
| 1 | ~~a non-junk DNI~~ | ~~any~~ | removed — a DNI is in rows 2–3 (decision 1 correction) |
| 2 | DNI, phone, email or social account | compatible | same |
| 3 | DNI, phone, email or social account | incompatible | possible |
| 4 | nothing | full name compatible, 2+ words (however common) | possible |
| 5 | — | — | no |

- *Compatible* = `namesCompatible` from `src/domain/apiExactMatch.ts` (every word of the shorter name in the longer, any order, one typo per word; aliases count). The sheet's within-file `namesAgree` moves to the same rule.
- *Junk identifier* (any type): placeholder value, or found on more than 3 differently-named profiles → it does not count as shared.
- Rule 4 applies however many profiles share the name (Jon, 2026-11-02: «always go to Revisar»). Accepted cost: very common names always land in «Revisar».
- An incoming person with no contacts at all can only reach rule 4 or 5.

### 4. What each surface does (Jon confirmed, 2026-11-02)

| Surface | same | possible |
|---|---|---|
| Sheet import | «Actualizar» (default) | «Revisar» |
| Social-post import | listed, pre-selected | listed, not pre-selected |
| «Nuevo adoptante» · «Agregar conviviente» · interview | «¿Es este perfil?», first | «¿Es este perfil?», after |
| «Ya existe en otro perfil» warning | shown | shown |
| Public form · contract · API creating a profile | pair in «Pendientes de revisar» | pair in «Pendientes de revisar» |
| API exact | activity added to that profile | new profile + pair in «Pendientes de revisar» |
| Search box · API fuzzy | top of the main list | today's ranking |

«Ya existe en otro perfil» receives one contact only, so its candidates are judged on that contact alone (rules 2–3 with the name treated as compatible).

### 5. Search box and API fuzzy

Identifiers typed in the query (phone already; add email, DNI, handle) are pulled out into `PersonFacts`; candidates judged **same** go to the top of the main list. API fuzzy passes its structured fields directly instead of joining them into text. Plain-name ranking is unchanged.

### 6. The golden test

The 7 examples of the comparison page (plus junk-DNI and visible-name-social cases) become one test that runs every surface's real entry point on a migrated DB (`src/test-utils/migratedDb`) and asserts the action each takes. A surface that drifts from the verdict fails the build.

## Rollout (each step ships to staging on its own)

1. `PersonFacts` + `judgeIdentity` + junk guards + the golden test (surfaces still old: the test documents today's gaps as expected failures).
2. Sheet import (fixes the partner-phone «Actualizar» and the silent same-name row).
3. «Nuevo adoptante» form family + social-post import (DNI, handles).
4. «Pendientes de revisar» creation and API exact (socials accepted; a DNI like a phone).
5. Search box + API fuzzy ranking.
6. ~~Visible-name socials → «Conocido/a como»~~ — dropped (Jon, 2026-11-02, decision 5).

## Calls made in the design (Claude, technical — check while reading)

- **Housemates' contacts never count as the candidate's.** Since households as profiles (v2.58.0) every profile tokenizes only itself (`householdSearch.test.ts` pins it), so a partner's phone is only on the partner's own profile.
- **«Actualizar» on «same» is a default, not a silent write.** The sheet's Duplicados step still shows it before anything is saved. Only API exact acts without a human, as today.
- **DNI sources:** `id` contact entries plus labeled ids in notes («DNI 30123456»), exactly what the index holds today (`extractIds`, ≥5 chars, ≥4 digits). The form (`id` entries), the sheet (DNI column → `ids`), the post import (`id` entries) and the API (`documentId`) all feed `documentIds`. One normalizer (`normalizeIdValue`).
- **Junk counts are computed by retrieval, not the verdict:** for each shared identifier, the number of distinct names among live (non-deleted) profiles holding it. The verdict stays pure and takes those counts as input. The sheet's within-file grouping keeps its own guard.
- **Rule 4 compares full names with `namesCompatible`** against candidates found by the `name_full` token or name words (primary names and aliases), not scoped to the viewer. Retrieval stays bounded, so with a very common name only the best-ranked candidates are listed.
- **Visibility unchanged:** retrieval is not viewer-scoped (as duplicate mode today); everything shown goes through the existing hydration and PII masking, and «Pendientes» pairs are created across owners as today (collaborative vetting).
- **Several «same» candidates:** the one sharing the most identifiers wins (then the profile's own name over an alias, then the most recent activity — today's `pickBestMatch`); the others stay listed («También coincide con» / `otherMatches`).
- **API exact contract:** `matchedOn` gains `social`, announced in the API changelog before release. A DNI + another name answers `ambiguous` / `name_mismatch` (new profile + «Pendientes» pair), like a phone + another name; `nameMatchedAs` keeps its values (no `document`).
- **Golden test shape:** a table of expected actions per surface; each rollout step flips its own surface's expectations from today's behavior to the verdict's. No skipped or `fails` tests.

## Open (Jon)

Nothing. Surface table confirmed; rule 4 has no rarity threshold.

## Left to the builder

Module boundaries and names, the query budget, how the verdict's reasons map to the existing match chips, and keeping the API v1 response schema backward compatible (new `matchedOn: 'social'` value must be announced in the API changelog).
