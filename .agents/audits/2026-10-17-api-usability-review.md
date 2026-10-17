# Third-party API v1 — usability review (senior EM, 2026-10-17)

Read-only review of origin/staging v2.56.193, for how easy the API is to understand,
use and troubleshoot for a partner developer. `match` / `saved.action` landed in
2.56.194 (Jon). The API is OFF in production with no partners: breaking changes are cheap now.

## Ranked improvements
1. **Copy-paste docs break or write data.** One fixed Idempotency-Key in every scenario curl (2nd scenario → 409);
   "Ejemplos de pedidos" without headers; guide examples use a phone no demo person has (creates profiles on
   staging); staging guide curls point at production with ba_live_. Fix: `$(uuidgen)`, full curl everywhere, the
   page's own host, staging scenarios default to X-Dry-Run. S.
2. **Dry run hides what it would do.** Return `saved.action` = what it WOULD do + `dryRun: true`, no ids. S.
3. **Demo people drift** (a real not_found run creates Sofía; later runs answer found/not_rated). Add `createdAt`
   and `createdByYou`/`source` to the profile summary; demo identifiers always dry-run for ba_test_ keys or a
   nightly reset. S–M.
4. **Two duplicate guards disagree; recovery in prose.** `idempotency_key_reused` covers 4 situations (in progress,
   different body, too old, partly saved); originals only in message text. Distinct codes + `originalRequestId`,
   `activityId`, `profileId` fields; let `externalId` act as the idempotency key when the header is missing. M, breaking.
5. **Retry compares raw bytes** — key order/spacing → 409. Hash normalised JSON. S.
6. **Validation: one error at a time, no field.** `error.field`, `error.details[]`, `error.docUrl`; a Spanish
   error-code table with how to fix. S.
7. **Invisible quota; failed calls count.** Don't count 4xx/replays; `RateLimit-*` headers; separate code for the
   all-calls ceiling and show it in /me. S.
8. **No way to look up a past call.** `GET /api/v1/requests/{requestId}`, `GET /api/v1/activities?externalId=`;
   requestId searchable in Settings → API; replay returns `originalRequestId`. M.
9. **Same fact in several places** (worstRating ×3; candidates as URLs only; flags/records plain strings). risk as
   single source; `candidates: [{profileId,url,nameMatchedAs}]`; enums. S–M, breaking.
10. **401 lumps causes** — say "test key, use staging" / "malformed header" (unknown+revoked stay merged). S.
11. **No change policy** — publish one (+ changelog); Idempotency-Key `required: false` in the spec (fuzzy doesn't need it). S.
12. Lower: fuzzy glues fields, drops results silently, `truncated` without total/paging; state the es/en mix is deliberate.

## Ship-blockers before turning the API on in production
- **Risk fails open**: a D1 hiccup in enrichment returns `[]` → a 1★ person reads not_rated, no flags. Must 5xx or `risk.complete: false`.
- **Production docs write real data**: the minimal curl with a live key creates a fake person in prod. Reserved example data; prod refuses documented identifiers.
- `match`/`saved` split (done 2.56.194) incl. dry-run behaviour (item 2).
- Structured distinct 409s (item 4).
- Copy-paste docs fixed (item 1).
- The independent security review (plan step 9).
- Risk to flag: `activity_required` pushes partners to save throwaway observations to re-check someone (pollutes profiles, can trigger too_many_requests). Say what to send instead.
