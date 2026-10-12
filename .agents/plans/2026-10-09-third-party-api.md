# Third-party API v1: search + record

**Status:** built on branch `feature/public-api-v1` (2026-10-09), behind `ENABLE_PUBLIC_API` (off). Not deployed. See "Implementation notes" at the end. The product decisions below are Jon's and are final unless he reopens them.

## Goal

A rescue's own tools (its adoption form, spreadsheet automation, management app) can:

1. **ask whether a person is already known**, and how they are rated, and
2. **save** an adoption request or other record about that person,

without anyone re-typing it into BuenAdoptante.

## Product decisions (Jon, 2026-10-09)

| # | Decision |
|---|---|
| 1 | Third parties are **each rescue connecting its own tools**. There is one API key per rescuer or org. A vendor acting for many rescues (delegated / OAuth) is out of scope. |
| 2 | Saved records **go live directly**, with no inbox. **Every API transaction is logged and admins can review it.** |
| 3 | The API **answers whether the person is flagged** (rating + flags + record counts), masked the same way as logged-in search. |
| 4 | **Stay on the Cloudflare free tier.** |
| 5 | Search has two modes. **Fuzzy** is the same engine as the homepage. **Exact** requires `fullName` + one of `email` / `phone` / `documentId`. |
| 6 | Exact search has **three outcomes**: `found`, `not_found`, `ambiguous`. `ambiguous` carries the worst rating among the candidates, so a client can still block automatically. |
| 7 | `context` (the record type) is required. An exact search can **save the record in the same call** (option "c"). |
| 9 | `rating` is optional on every record type and is **never inferred**. Missing means `NULL`. |
| 10 | Each saved record notifies the rescuer like a form submission. The rescue guide documents all search fields. |
| 11 | A rescue can **void its own API records** (`POST /api/v1/records/{id}/void`). |
| 12 | Rescuers see **their own** API transaction log (Settings → API) **in v1**. Admins see everyone's. |
| 13 | Every search answer carries **links to the HTML pages**: the profile, and the record when one was saved. |
| 14 | v1 endpoints: `search`, `me`, `records/{id}/void`, plus interactive docs at `/api/v1/docs`. |
| 8 | If the identifier matches but the name doesn't match the profile, any alias or any household member, the outcome is **`ambiguous` (`name_mismatch`)**. |

## Hosting

- **Inside the existing Pages app**, as route handlers under `src/app/api/v1/`. There is no new service and no new cost.
- A separate Worker (same D1/R2 bindings) is the later option, for when releases need to be independent. It saves no money, because the free quota is per account.
- Put all API logic in `src/lib/api/` + `src/domain/`, so a later move to a Worker is a copy and not a rewrite.

### Free-tier budget (shared with the whole site)

| Limit (per day, per account) | API cost | Consequence |
|---|---|---|
| 100k requests | 1 per call | **A client in a retry loop can take the site down until 00:00 UTC.** Per-key daily caps are mandatory in v1. |
| 100k D1 rows written | about 12 per saved record (profile, tokens, record, history, audit, log, notification); 1 per search (log) | Room for about 8k saved records a day |
| 5M D1 rows read | **exact** ≈ tens of rows (token index); **fuzzy** ≈ the whole `adopters` table plus enrichment (LIKE scan) | Fuzzy gets a much lower per-key cap. See `project_findadopters_likescan_scaling`. |
| 10 ms CPU per request | text only | **No image upload in v1**, which would overrun the CPU limit |

## Authentication: API keys

Add a new table, `api_keys`, through a hand-written migration (drizzle-kit hangs):

- `id`, `owner_email` (the rescuer, used as `addedBy`), `org_id` (nullable), `name` (the label the rescuer gives it)
- `key_hash` (SHA-256 of the secret; the secret is shown once and never stored), `key_prefix` (first 8 chars, so the key can be recognized in lists)
- `scopes` (JSON: `search`, `search:fuzzy`, `record:write`)
- `daily_cap_exact`, `daily_cap_fuzzy`
- `created_at`, `last_used_at`, `revoked_at`

**Wire format:** `Authorization: Bearer ba_live_<32 random bytes base62>`, plus `ba_test_…` keys that only work on staging.

**Rules:**
- Compare hashes in constant time.
- A revoked or unknown key gets `401`, and the response body never says which.
- The API is **server-to-server only**: no CORS headers, so a key pasted into browser JS fails.
- Check that `src/middleware.ts` leaves `/api/v1/*` alone. It has no session gate there, and API clients send no `x-deployment-id`, so the deploy-skew guard stays inert for them. Assert both in a test.

**Who issues keys:** v1 is admin-issued only (Admin → API keys). Rescuer self-serve in Settings comes later.

## Endpoint: `POST /api/v1/search`

### Request

```json
{
  "mode": "exact",
  "context": "adoption_request",
  "person": {
    "fullName": "María José Pérez",
    "email": "maria@example.com",
    "phone": "+54 9 11 6462-2274",
    "documentId": { "value": "30.123.456", "country": "AR" },
    "address": "Av. Siempreviva 742, CABA",
    "socials": [{ "platform": "instagram", "handle": "@mariajose" }]
  },
  "save": {
    "externalId": "jotform-5512",
    "animalName": "Luna",
    "species": "dog",
    "date": "2026-10-09",
    "rating": null,
    "notes": "Aplicó por el formulario de la web"
  }
}
```

- **`mode`** is `exact` or `fuzzy`.
- **`context`** is required. It takes the `RECORD_TYPES` values except `available`, which describes an animal: `adoption_request`, `adoption`, `foster`, `follow_up`, `returned_pet`, `observation`.
- **`socials[].platform`** takes the tokenizer's set: `facebook`, `instagram`, `tiktok`, `x`, `threads`.
- **`save`** is optional and **only allowed with `mode: "exact"`**, because a fuzzy result has no confirmed subject.
- **`Idempotency-Key`** (header) is required whenever `save` is present. A replay returns the stored response and writes nothing.
- **`save.externalId`**, the client's own id, must be unique per key. It is the second line of defence against duplicate records.

### Exact mode

**Validation.** Return `422 exact_requires_name_and_identifier` unless `fullName` is present together with at least one of `email`, `phone`, `documentId`.

`fullName` must be a **real full name**: at least 2 words of at least 2 characters each, after folding accents and case. Otherwise return `422 full_name_required`. Without this, "María" plus a shared family phone would come back `found` under the word-subset rule.

**Address and socials** are accepted and logged, but they don't decide the outcome.

**Identifier match.** It runs on the token index only, normalized the same way the tokenizer normalizes:

| Field | Token | Normalization |
|---|---|---|
| email | `email` | lowercase, trimmed |
| phone | `phone`, `phone_suffix` | **Superseded at merge (2026-10-12):** tokenizer v7 (v2.56.155) reads phones by country with libphonenumber. The API uses the same reader as the index and the duplicate check, `phoneDuplicateTokens(phone, keyOwnerCountry)` (src/domain/phoneNumber.ts), so "+54 9 11 6585-1333" and "11 6585-1333" are one number. Validation uses `readPhones`. |
| documentId | `id_number` | `[a-z0-9]` only |

**Name check.** It runs against each identifier hit.
- Fold accents and case, then compare as a set of words: every word of the shorter name must appear in the longer one, and a one-letter typo per word is allowed (reuse `fuzzyNameScore`).
- The name is compared against the profile name, its **aliases**, and its **household members** (`project_family_alias_are_name_tokens`).
- The response reports which one matched in `nameMatchedAs`: `profile` | `alias` | `household_member`.

**Decision.** This is a pure function in `src/domain/apiExactMatch.ts`, unit-tested:

| Distinct live profiles hit by the identifier | Name compatible? | Outcome |
|---|---|---|
| 0 | n/a | `not_found` |
| 1 | yes | `found` |
| 1 | no | `ambiguous` / `name_mismatch` |
| ≥2 | exactly 1 compatible | `found` (that one) |
| ≥2 | 0 or ≥2 compatible | `ambiguous` / `multiple_profiles` |

Never pick one profile silently. The dangerous error is a false `not_found` on a flagged person, so if in doubt, return `ambiguous`.

### Fuzzy mode

- Join the `person` fields into one query string and call `findAdopters({ mode: 'discovery' })`. **Do not write a second ranking.**
- The viewer is the key's `owner_email`, so masking and the visibility rules are exactly what that rescuer sees logged in.
- **Side effects of discovery mode.** Decide each one explicitly:
  - The `searches` row must be tagged `source: 'api'`.
  - `trackPending` / `recordPendingSearch` (findAdopters.ts:965, :1343) must be **off**. It belongs to the in-app flow and would add the rescue's API traffic to their pending-search list.
  - Any search-hit or profile-view event (`EVENT_TYPES`) must be tagged or skipped. Otherwise other rescuers' "your profile was seen" counts and the PostHog and retention numbers fill with machine traffic.
  - Audit the call path for anything else that writes or notifies before wiring it up.
- Return at most `SEARCH_RESULT_LIMIT` results.

### Profile summary (shared by both modes)

- `rating` comes from `computeAvgRating`.
- `ratingLevel` / `ratingLabel` come from `getRatingDisplayLevel` / `RATING_LABEL_KEYS`. Level 0 means not rated, and must never be reported as "dangerous".
- `flags` come from `buildFlags`.
- `tooManyRequests` / `tooManyAdoptions` currently live in the components (`AdopterProfileV2.tsx:184`, `AdopterForm.tsx:1431`, via `computeMaxDensityPeriod` with config thresholds). **Move that into `src/domain/` first** and make the profile UI and the API both call it. Don't duplicate it.
- `records` holds counts per record type. `lastRecordAt` is the date of the latest record.
- `profileId`, and `url` = `https://<host>/adopter/{profileId}`.
- Links work for logged-in BuenAdoptante users, with the viewer's own masking. A logged-out visitor is sent to login and then back to the link (the existing `callbackUrl` flow).
- **The summary never contains contact data the client didn't send** (`project_match_card_pii_leak`).

### Responses

```json
{ "result": "found",
  "profile": { "url": "…", "matchedOn": ["phone"], "nameMatchedAs": "profile",
               "rating": 1.5, "ratingLevel": 2, "ratingLabel": "poor",
               "flags": ["inaccurate"], "tooManyRequests": true,
               "records": { "adoption": 2, "returned_pet": 1 }, "lastRecordAt": "2026-08-12" },
  "saved": { "recordId": "…", "recordUrl": "https://…/adopter/{id}?record={recordId}", "profileCreated": false },
  "requestId": "…" }

{ "result": "not_found", "saved": { "recordId": "…", "recordUrl": "…", "profileUrl": "…", "profileCreated": true }, "requestId": "…" }

{ "result": "ambiguous", "reason": "multiple_profiles", "candidates": 2,
  "candidateUrls": ["https://…/adopter/a", "https://…/adopter/b"],
  "worstRating": { "rating": 1.0, "ratingLevel": 1, "ratingLabel": "dangerous" },
  "saved": { "recordId": "…", "profileCreated": true }, "requestId": "…" }

{ "mode": "fuzzy", "results": [ { "relevancePercent": 87, "maskedName": "M. J. P.", "profile": { … } } ], "requestId": "…" }
```

**Record links:** `/adopter/{profileId}?record={recordId}` opens the profile, expands the activity section, scrolls to the card `#adoption-{recordId}` and flashes it. `AdopterProfileV2.tsx` already does this for search matches, so reuse that code.

**Errors** follow the existing error rules (an `errorId` on every error):

| Status | Meaning |
|---|---|
| `400` | malformed JSON |
| `401` | bad key |
| `403` | missing scope |
| `409` | idempotency key reused with a different body |
| `422` | validation |
| `429` | daily cap hit, with a `Retry-After` header |
| `500` | server error, with `errorId` |

### Save semantics (decision 7)

| Outcome | What gets written |
|---|---|
| `found` | Append the record to **that** profile. The exact-match rules count as confirmation of the subject. |
| `not_found` | Create a profile **plus** the record, using the form's path: `createAdopterFromSubmission` with the new `source: 'api'`, tokenize, then write `duplicate_candidates`. |
| `ambiguous` | Create a **new** profile **plus** the record, and register the candidates in `duplicate_candidates`, the same as the adoption form does today. Never attach to a guessed profile (`feedback_never_write_unconfirmed_subject`). |

- **Compute the returned profile summary before writing the new record.** Otherwise a rescue's own just-saved `adoption_request` can flip `tooManyRequests` and flag the person because of the rescue's own submission. The response describes the person as they stood **before** this call.
- `addedBy` is the key's `owner_email`.
- `adopter_history` notes "via API key ‹name›".
- Notify the rescuer **once per saved record**, the same way the form does (decision 10).
- Use `runAfterResponse` for background work (`project_background_work_on_cloudflare`).

## Transaction log + admin review (decision 2)

Add a new table, `api_requests`:

- `id` (= `requestId`), `key_id`, `owner_email`, `created_at`
- `mode`, `context`, `outcome`, `http_status`, `error_id`
- `request_body` (JSON), `response_summary` (JSON)
- `profile_ids` (JSON), `record_id`, `profile_created`
- `idempotency_key`, `external_id`, `duration_ms`

**Privacy:**
- `request_body` holds PII. It is **admin-only** and **purged after 90 days** (cron or admin action).
- `logger` / Axiom only get `requestId`, `keyId`, `mode`, `outcome` and `errorId`, never the person data.

**Admin → API.** One page with two tabs:
- **Keys:** issue, revoke, set caps, last used.
- **Transactions:** filter by key, outcome and date. The detail view shows the request and response, links to the profile and record, and offers "deshacer". Deshacer soft-deletes a record the API created; if the API also created the profile and nothing else references it, the profile is soft-deleted too.

**Settings → API (rescuer, decision 12).** The same transactions list, filtered to the rescuer's own keys. It shows the key name and prefix, today's usage against the caps, and "Anular" on records their own key created (same code as the void endpoint). Rescuers see their **own** `request_body` (they sent it). Issuing keys stays admin-only in v1.

**Daily caps** are counted from `api_requests` (rows for this key and mode today). That costs one indexed read per call, so no extra service is needed.

## Other endpoints (decision 14)

- **`GET /api/v1/me`** answers `{ key: { name, prefix, scopes }, rescuer: { name, email }, caps: { exact, fuzzy }, usedToday: { exact, fuzzy } }`. It's the "test connection" call.
- **`POST /api/v1/records/{id}/void`** soft-voids a record **only if this key created it** (checked against `api_requests.record_id` for this `key_id`); otherwise `404`. It's idempotent, and it's logged as its own transaction. If the API also created the profile and nothing else references it, the profile is soft-deleted too. Uses the same function as the admin and Settings "Anular".
- **`GET /api/v1/openapi.json`** is generated from the zod schemas the routes validate with, so the spec can't drift from the code.
- **`/api/v1/docs`** is an interactive explorer (Scalar, from the CDN) on top of the spec. Partners try calls with a `ba_test_` key on staging.

## Build order

1. **Pre-launch data fix.** Backfill tokens for the **7 live untokenized profiles**; exact mode can't see them. Then add a check that fails CI or alerts if that count rises.
2. **Domain.**
   - `apiExactMatch.ts` (validation, name compatibility, decision table).
   - Move the "too many requests / adoptions" density rule into `src/domain/`.
   - Unit tests for both.
3. **Migration.** Add `api_keys` and `api_requests`, and add `'api'` to `AdopterSource`. Run the `schema-sync` workflow.
4. **`src/lib/api/`.** Key auth, caps, idempotency, the request log, and the profile summary builder. Keep identity helpers out of any `'use server'` file (`project_server_action_auth_audit`).
5. **Route** `src/app/api/v1/search/route.ts`, then exact mode, then fuzzy, then save.
6. **Admin page** for keys and transactions, plus **Settings → API** for each rescuer's own log and voids, with i18n in es + en + pt. Add the `?record=` deep link on the profile page.
7. **`/me` and `/records/{id}/void`**, the **OpenAPI spec** and **`/api/v1/docs`**, and a short ES guide for rescues covering every search field.
8. **E2E:**
   - each auth failure;
   - one test per row of the exact-mode decision table, using dedicated `test-api-fixture-*` rows;
   - an international-format phone finds a stored 8-digit phone;
   - a one-word `fullName` → 422;
   - idempotent replay;
   - save on each outcome;
   - cap → 429;
   - fuzzy masking matches the logged-in homepage.
9. **Rollout.** Ship to staging behind a `ENABLE_PUBLIC_API` flag (wired in all 5 places). Then **independent security review before production**: this is a new unauthenticated-by-session write surface. Then hand one rescue one key.

## Open questions

**Answered by Jon (2026-10-09):**
1. **Ratings:** optional for **every** record type and **never inferred**. A record saved without a rating stores `NULL`. The existing "2 stars when none given" fallbacks are bugs and are fixed separately (branch `fix/no-inferred-ratings`). The API must reject a rating outside 1–5, never coerce it.
2. **Notifications:** every saved record notifies the key owner, with org fan-out, the same way a form submission does: one notification per event (confirmed).
3. **Rescue guide:** documents **every** search field (name, email, phone, document ID, address, socials) and both modes, regardless of current data coverage.

**Technical (mine):**
- Whether `ambiguous` with `save` should also send the admin a notification to merge, given the 637 duplicate pairs already pending.
- Monitor the share of fuzzy calls; if it dominates the read budget, prioritise the LIKE-scan root fix.

## Data snapshot (prod, 2026-10-09)

| Item | Count |
|---|---|
| Live profiles | 1,253 |
| Untokenized live profiles | 7 |
| Email tokens | 386 |
| Phone tokens | 1,126 |
| Document ID tokens (≤73 profiles) | 73 |
| `duplicate_candidates` pending | 637 |
| `duplicate_candidates` merged | 145 |
| Email values shared by more than one live profile | 1 |
| Phone values shared by more than one live profile | 2 |
| Document ID values shared by more than one live profile | 1 |

## Implementation notes (2026-10-09)

**Where things are:**
- Wire contract: `src/lib/api/schemas.ts` (zod). It is also the source of the generated spec (`src/lib/api/openapi.ts`).
- Exact-match rules: `src/domain/apiExactMatch.ts` (pure, unit-tested).
- Per-call wrapper (flag, key, log, caps, idempotency): `src/lib/api/handler.ts`.
- Reads: `src/lib/api/profiles.ts`.
- Writes and void: `src/lib/api/records.ts`.
- Review queries, with the owner scoping in one place: `src/lib/api/review.ts` and `reviewRoutes.ts`.
- Migration: `drizzle/0082_public_api.sql`.

**Deviations from the plan above:**
- **"Too many requests / adoptions" did not need moving.** `enrichAdopters` already computes it server-side for the search cards, so the API reuses that.
- **Fuzzy discovery** goes through `findAdoptersAsViewer`, which uses the key owner as the viewer. It is reachable only server-side; `FindAdoptersOptions` was not widened, because the session action forwards those options from the browser. API calls skip the popular-searches log, the `search_hit` stats and the pending-search capture. Search-match PII grants still happen, the same as the rescuer's own search box.
- **Fuzzy results:** full-coverage matches come first, then the homepage's partial-coverage matches, capped at `SEARCH_RESULT_LIMIT`.
- **Void:**
  - Events have no soft-delete column, so a voided event is deleted and its row is copied into the profile's `adopter_history` (`api_record_voided.removedEvent`).
  - Animals (adoption / foster) are soft-deleted.
  - An API-created profile with nothing left on it is soft-deleted.
- **Placement contexts:** `adoption` / `foster` create a new animal owned by the key's rescuer, which then shows in their /my-animals.
- **A found profile is not edited.** New contact data the client sent for a `found` person does not modify the profile; only the record is added.
- **Keys:** `ba_test_` on any host but buenadoptante.org. Staging and prod have separate databases, so a key only works where it was issued.
- **Caps:** default exact 500/day and fuzzy 50/day. Calls refused for the cap don't count against it.

**Still owed before the flag goes on in production:**
1. Backfill tokens for the 7 untokenized live profiles. Exact mode can't see them. No new code needed: the admin duplicate scan (`/api/admin/duplicates` POST, the Duplicados page) re-tokenizes every profile whose `token_hash` is stale or NULL. Run it once on production.
2. Independent security review of this branch (a new write surface authenticated without a session).
3. A staging walkthrough with a `ba_test_` key, using `/api/v1/docs`.
4. A check on staging that the Scalar CDN script loads (CSP is not served today, so it should).
