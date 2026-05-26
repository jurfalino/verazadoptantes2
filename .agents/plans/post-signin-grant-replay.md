# Post-signin search-match grant replay

## Context

A bug surfaced after PII gating shipped: an unauthenticated user searches
(say "Juan García 1123456789"), sees the matching adopter card with the
matched fields unmasked (transient reveal), clicks the card → redirected
to sign-in → after OAuth, lands on `/adopter/<id>` → contact fields are
masked again. The unmasked reveal seen in search results disappears at
the auth boundary.

Why: at search time the viewer is unauthenticated. `findAdopters` does
the transient render but cannot persist a grant — grants are keyed on
`granteeEmail` and unauth viewers have none. The callbackUrl passed to
`openLogin` is the bare profile URL — `?q=` is dropped. After signin,
the profile page has no record of what the user proved they knew.

## The fix — URL-based replay

Carry the original query in the URL across the auth boundary, then replay
the same match-and-write-grants logic on the post-signin profile load.

Three small touches:

1. **`SearchSection.tsx:395`** — search-result link gets `?q=<urlencode(query)>` appended.
2. **`SearchSection.tsx:386`** — `openLogin(...)` callback URL is the same URL (with `?q=`), so NextAuth preserves it through OAuth.
3. **`src/app/adopter/[id]/page.tsx`** — accept `q` in `searchParams`. When `q` is present and the viewer is authenticated, call a new helper `replaySearchMatchGrants({ adopterId, query, viewerEmail })` **before** the parallel data fetch. The helper writes grants idempotently. `getAdopter` / `getAdopterPiiContext` then resolve visibility with the freshly written grants in scope, all in the same request.

## The helper

New export in `src/lib/piiAccessServer.ts`:

```ts
export async function replaySearchMatchGrants(opts: {
    adopterId: string;
    query: string;
    viewerEmail: string;
}): Promise<{ written: number }>;
```

Implementation outline:
1. Cheap pre-checks: gating on, query non-empty, viewerEmail real
   (`isRealActorEmail`). Bail returning `{ written: 0 }` otherwise.
2. Load the adopter's `name` and `contactEntries` in one cheap query.
3. Load existing grants for `(viewerEmail, adopterId)` — entryRef hashes only.
4. Run `matchSearchEntries` and `matchSearchNameTokens` (same as findAdopters
   discovery path).
5. For each match whose `entryRef` is not in the existing-hash set, insert a
   row into `pii_access_grants` with `origin='search_match'` (a new origin
   value `'signin_replay'` is *not* worth a schema change — same semantic
   — but log + audit identify the path).
6. Log at `info` with `{ adopterId, viewerEmail, written, fromOrigin: 'signin_replay' }`.
   `logAudit` with `action='pii_search_match_grant_replay'` + counts.
7. Write failures are caught + logged at `warn` (degraded, not broken).
   Never throws — the page render must not be blocked by a grant-write hiccup;
   the user can always use the verify input as a fallback.

## Optional bonus

`?q=` could pre-populate the verify-known-info input. If the replay didn't
unlock everything the user expected (e.g. the field that matched in search
has since been edited by the owner and the value-hash no longer matches),
the original query sits in the input ready to retry or extend. Cheap, ship
it in the same commit.

## Edge cases

- **`?q=` present, viewer privileged** → skip replay (everything's already
  visible; no work to do).
- **`?q=` present, no matches** → no grants written; everything stays
  masked; the verify input is the user's next step.
- **`?q=` present on a re-visit** → idempotent. The existing-hash check
  ensures we don't double-insert.
- **URL shared with someone else** → recipient triggers the replay against
  their own account. They can only earn grants for fields the query
  genuinely matches against that adopter — and they could earn those same
  grants by typing the query into search themselves. Audit log records the
  grantee email if abuse needs tracing. Acceptable.
- **No `?q=`** (user landed via direct link) → no replay; page behaves
  exactly like today.
- **`q` is malformed / oversize** → cap at a generous limit (e.g. 500 chars),
  trim, otherwise treat as legal input. Matcher is robust to weird inputs.

## What stays the same

- Owner / admin / editor experience unchanged.
- Unauth search results unchanged (the transient reveal is what triggers
  the click in the first place).
- Matcher rules unchanged.
- No schema change, no migration, no new feature flag.

## Files

**Modified:**
- `src/components/SearchSection.tsx` — append `?q=` to link href + login
  callback URL.
- `src/app/adopter/[id]/page.tsx` — accept `q` in searchParams; call
  `replaySearchMatchGrants` between auth and the main Promise.all.
- `src/lib/piiAccessServer.ts` — new export `replaySearchMatchGrants`.
- `src/components/PiiVerifyKnownInfo.tsx` — accept optional `prefill` prop
  and seed the input with it (the page passes `q` through).
- `src/components/AdopterProfileV2.tsx` — thread `q` through to
  `PiiVerifyKnownInfo`.

## Verification

- `npx tsc --noEmit`; `npm run lint` (≤125 warnings).
- Unit: extract the inner match-+-dedupe logic into something testable, OR
  cover via an integration test that exercises the helper against an
  in-memory adopter row. At minimum, a unit test confirms the helper is
  idempotent (calling twice with the same query writes only on the first
  call).
- E2E manual on staging with the flag on:
  - Unauth user searches by phone → clicks result → signs in → profile
    shows that phone unmasked, other fields masked.
  - Same flow but with name + phone in the query → both name tokens and
    the phone field unmasked.
  - Auth user (already privileged) opens a search result URL with `?q=` →
    page renders normally, helper short-circuits, no extra grant rows.
  - Unauth user shares the URL → recipient (also auth, non-privileged) →
    replay writes grants for their account. Audit log records their email.

## Versioning

Build-suffix bump under the 2.15.0 PII series — focused bug fix, no
schema change.

## Out of scope

- A "session"-bound version of the replay (cookie-based) — see plan
  body for why URL is preferred.
- Replay from non-search entry points (related-records cards, duplicate
  modals). If those surface the unmasked reveal too, the same `?q=` rule
  should extend to them, but it's a different audit.
- A grant-revocation path triggered by a URL share — out of scope; the
  existing admin-revoke flow handles the rare case.
