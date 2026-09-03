# Social-network duplicate detection: platform-aware token normalization

**Status:** Decisions locked (2026-08-25) — ready to turn into a build plan.
**Author:** drafted 2026-08-25 (session follow-up to v2.46.4 branded social rows).
**Related:** `project_findadopters_likescan_scaling`, `project_family_alias_are_name_tokens`, `docs/D1_COMPATIBILITY.md`.

---

## 1. Context & problem

An adopter's social handles are one of the **strong identity signals** used for
duplicate detection (weight `3`, same tier as phone/email/id; never
popularity-down-ranked — `src/app/actions/findAdopters.ts:601` and
`STRONG_SIGNAL_TYPES` at ~:619). Yet the social **token index** is
*form-sensitive* and *platform-blind*, so the fast exact-match path misses
matches it should catch and leans on a slower fallback.

### How it works today (grounded)

**Tokenize** (`src/lib/tokenizer.ts`):
- `extractTokens()` builds one `allText` blob from `contactInfo + name +
  addressInfo + familyMembers` (:378) and runs `extractSocials(allText)`; each
  result is stored verbatim as a `social` token via `add('social', social)`
  (:392). `add()` stores the value with no further normalization (:305).
- `extractSocials()` (:198) lowercases and strips `https://www.` but **keeps**
  the `@` and the full host/path. So the stored token is one of:
  `@juan`, `facebook.com/juan`, `instagram.com/juan`, `tiktok.com/@juan`, …
- The structured `platform` field on a `contactEntries` row is **never used** —
  tokenization is blob-based.

**Match** (`src/app/actions/findAdopters.ts`, duplicate mode):
1. **Exact token index** — social tokens match **character-for-character**
   (`eq(tokenValue, token.value)`, :488–491).
2. **LIKE fallback on the blob** — `socialLikeNeedle()` (:372) reduces *any*
   form (URL or `@handle`) to the bare handle (strip `@`, protocol, `www`, take
   the last URL path segment), skips bare domains + platform stopwords, then
   `contactInfo LIKE '%handle%'` (:534–537).

### The gap

| Case | Exact index | LIKE fallback |
|---|---|---|
| Both stored identically (`@juan` ↔ `@juan`) | ✅ match | ✅ |
| URL ↔ bare handle, same account (`facebook.com/juan` ↔ `@juan`) | ❌ **miss** | ✅ (slow) |
| Same handle, different platform (FB `@juan` ↔ IG `@juan`) | ❌ miss (unless identical text) | ✅ (slow) |

So cross-form / cross-platform matches ride **only** on the LIKE fallback — the
blob-scanning path with known **burst-scaling problems on large imports**
(`project_findadopters_likescan_scaling`; 2.40.x). The precise, indexed path
that phone/email enjoy is effectively unavailable to socials.

### Non-problem (scope guard)

v2.46.4 (branded social rows) is **display-only** and does not touch tokenization
or matching. This spec is an independent robustness improvement, not a fix for a
regression.

---

## 2. Goals / non-goals

**Goals**
- The **exact token index** reliably catches the same social account regardless
  of stored form (URL vs `@handle`) on the **same platform**.
- Tokenizer and query use **one shared handle-normalization function**, so the
  index and the needle agree by construction (today they don't).
- Reduce reliance on the LIKE-scan fallback for socials.
- **Treat a shared handle as a merge signal** (product decision): 2+ records
  sharing a handle should surface as a merge candidate. The one case to manage is
  a handle appearing on *many* records (a rescuer's own contact mis-entered) —
  handled as a data-quality guard, not by weakening matches (§4, #3-revised).

**Non-goals**
- Cross-platform handle reuse (same `@handle` on FB *and* IG belonging to one
  person) must remain a *weak* signal — surfaced by the low-weight
  `social_handle` token (§3.3), never a strong exact match (§5).
- No change to phone/email/id/name tokenization.
- No UI change **except** the paired network-first composer (§6), which is scoped
  as a companion and can ship separately.

---

## 3. Design

### 3.1 Shared handle normalizer

Lift the reduction logic proven in `socialLikeNeedle` into a shared,
side-effect-free helper in `tokenizer.ts` (query-specific stopword filtering
stays at the call site). **Critical correction (per review):** "take the last
URL path segment" is an Instagram/TikTok/X/Threads shape — those put the
username in the path. **Facebook does not.** Facebook identities come in three
forms and the stable identifier is often a *numeric ID*, not a path segment:

| Facebook URL form | Handle we want |
|---|---|
| `facebook.com/sofia.ortellado.7` (vanity) | `sofia.ortellado.7` |
| `facebook.com/profile.php?id=100012345678901` | `100012345678901` (numeric) |
| `facebook.com/people/Full-Name/100012345678901/` | `100012345678901` (numeric) |

A naive "last segment" rule turns `profile.php?id=N` into the garbage token
`profile.php`, which would **collapse every numeric-ID Facebook profile into one
strong duplicate**. (The current `socialLikeNeedle` has this same latent bug — it
just rides the weaker LIKE path. We must NOT promote it to the exact index
without fixing it.) So the normalizer is **platform-aware**:

```ts
// tokenizer.ts — pure, no contactEntries import (avoids the documented cycle)
// Returns the stable handle/id for a social value, or null if none is derivable.
// `platform` (when known from the structured entry) disambiguates host-less handles.
export function normalizeSocialHandle(value: string, platform?: string | null): string | null {
    let v = (value || '').toLowerCase().trim();
    const url = v.replace(/^https?:\/\//, '').replace(/^www\.|^m\.|^web\./, '');

    // ── Facebook: numeric id first, else vanity ─────────────────────────────
    // Match on host OR an explicit platform hint (a bare handle typed under a
    // Facebook entry has no host).
    const isFb = /^(facebook\.com|fb\.com|fb\.me)\b/.test(url) || platform === 'facebook';
    if (isFb) {
        const numeric = url.match(/(?:profile\.php\?id=|\/people\/[^/]*\/)(\d{5,})/)
                     || value.match(/\bid=(\d{5,})\b/);
        if (numeric) return `id:${numeric[1]}`;                   // e.g. "id:100012345678901"
        const vanity = url.match(/^(?:facebook\.com|fb\.com|fb\.me)\/([a-z0-9.]+)/);
        if (vanity && vanity[1] !== 'profile.php') return vanity[1].replace(/^@+/, '');
        // bare handle typed under a fb entry:
        if (!url.includes('/') && !url.includes('.com')) return v.replace(/^@+/, '') || null;
        return null;                                              // unparseable fb url
    }

    // ── IG / TikTok / X / Threads / generic: username is the last path seg ──
    v = v.replace(/^@+/, '').replace(/^https?:\/\//, '').replace(/^www\./, '');
    const m = v.match(/^([a-z0-9.-]+\.[a-z]{2,})(?:\/(.*))?$/);   // host[/path]
    if (m) {
        const path = (m[2] || '').replace(/[/?#].*$/, '').replace(/\/+$/, '');
        if (!path) return null;                                   // bare domain
        v = (path.split('/').filter(Boolean).pop() || '').replace(/^@+/, '');
    }
    if (!v || v.length < 3) return null;
    return v;                                                     // e.g. "juan", "andrea.bobcik"
}
```

Notes:
- The numeric-FB handle is prefixed (`id:100…`) so it can never be confused with
  a vanity handle that happens to be all digits.
- **Inherent limit:** a Facebook account reachable by *both* its numeric ID and a
  vanity name won't unify across those two forms — a `profile.php?id=N` record
  and a `facebook.com/johnsmith` record for the same person produce different
  tokens. Accepted: it falls back to weaker signals (name/phone/email), and the
  alternative (guessing they're the same) is unsafe.
- Non-profile X/TikTok paths (`x.com/i/...`, `x.com/status/...`, `.../video/...`)
  can yield junk segments; the query-side stopword/min-length guard filters the
  obvious ones. Enumerating reserved path words is a possible hardening, not
  required for v1.

`socialLikeNeedle` (query side) becomes a thin wrapper: `normalizeSocialHandle` +
the query-only `SOCIAL_STOPWORDS` / min-length guard. Single source of truth for
"what is the handle" — so the index and the needle can never disagree, including
on the Facebook numeric-vs-vanity distinction.

### 3.2 Platform reaches the tokenizer (mirror the `aliases` pattern)

`extractTokens(adopter, adoptions?, aliases?)` already accepts structured
contact data the caller deserializes (to avoid the tokenizer→contactEntries
circular import — see the alias precedent in `src/app/actions/duplicates.ts:42`
and `src/app/api/admin/duplicates/route.ts:211`). Add a parallel param:

```ts
extractTokens(adopter, adoptions?, aliases?, socials?: { value: string; platform?: string }[])
```

Callers (the two that tokenize) derive it exactly like `aliases`:

```ts
const socials = deserializeContactEntries(adopter.contactEntries)
    .filter(e => e.type === 'social')
    .map(e => ({ value: e.value, platform: e.platform }));
```

Both call sites (`duplicates.ts`, `api/admin/duplicates/route.ts`) get the new
argument. Legacy adopters with no structured `contactEntries` fall back to the
existing blob extraction (platform `undefined`).

### 3.3 The token value — **RECOMMENDED: dual token (platform-scoped + handle)**

> **Revised after the import-flow review (§3.5).** The original single
> platform-scoped token has a fatal symmetry hole: the *stored* side usually
> knows the platform (structured `contactEntries`), but the *query* side
> (search box, "create new", import review) very often has only a **bare
> handle** with no platform. `@juan` typed in the form would produce `juan`
> while the stored record has `facebook|juan` → they'd never exact-match. So we
> emit **two** tokens per social, at different weights.

For each social (structured first, then any blob-only extras):
- `platform = entry.platform ?? detectSocialPlatform(value) ?? null`.
- `handle = normalizeSocialHandle(value, platform)` — skip if null. Passing
  `platform` drives the Facebook numeric-vs-vanity logic (§3.1).
- Emit:
  1. **`social_handle`** = `handle` — **always** (weight `3`, §4). Platform-
     agnostic; this is what a bare-handle query hits, and a match on it alone is
     merge-worthy (per the product decision).
  2. **`social`** = `` `${platform}|${handle}` `` — **only when platform known**
     (weight `3`). The confident same-account match; scored together with
     `social_handle` as one signal (max, not sum — §4).

The query side builds the same pair from each input social (detecting platform
when the input is a URL) and exact-matches both token types.

**Why this shape**
- **Symmetry:** every social always yields `social_handle:<handle>` on both the
  index and query side, so a bare-handle query matches regardless of whether
  either side knew the platform. No silent misses.
- **Handle match = merge signal.** Any shared handle (same platform, or the
  bare-handle case) clears the merge bar — that's the product intent. The
  `social` token adds specificity when both sides know the platform, but a
  handle-only match is already merge-worthy.
- **Cross-platform for free:** FB `@juan` ↔ IG `@juan` match via
  `social_handle:juan` — no LIKE fallback needed (resolves old question #2).
- **The "shared handle on many records" risk** (a rescuer's own contact
  mis-entered on adopter records) is handled as a *data-quality guard*
  (detect + warn/exclude), NOT by down-ranking the match — see §4 (#3 revised).
- **Facebook:** `facebook.com/juan` and `@juan`+platform=facebook both emit
  `social:facebook|juan` + `social_handle:juan`; `profile.php?id=N` emits
  `social:facebook|id:N` + `social_handle:id:N`.

### 3.4 Alternatives considered

- **Single platform-scoped token** (original recommendation): clean and precise,
  but breaks the query-side symmetry above — a bare-handle form/import query
  can't match a platform-scoped stored token. **Rejected** once §3.5 surfaced it.
- **Option A — bare handle only** (`juan`, weight 3, no platform token): loses
  the same-account specificity the `social` token adds and can't distinguish a
  URL match from a bare-handle guess. The dual token keeps the bare-handle match
  (merge-worthy) *and* adds platform-scoped specificity when available.

### 3.5 Import & form query symmetry (why dual-token)

Confirmed by tracing the code:
- **Import tokenization needs no new call site.** `importUpsert.ts:140` calls
  `tokenizeAdopter` (= `duplicates.ts:47`, one of the two `extractTokens`
  sites already in the touch list). Fixing `duplicates.ts` fixes import
  tokenization automatically.
- **Import stores platform for URL-form socials only** (`importUpsert.ts:101`
  sets `platform: detectSocialPlatform(value)`); a bare-handle import gets no
  platform. Consistent with the tokenizer's `social_handle` fallback — the
  handle token still indexes it.
- **The form/import dedup *query* passes bare strings.** `findFormDuplicates`
  forwards `socials: string[]` to `findAdopters` (`findFormDuplicates.ts:56`);
  `findAdopters` builds a social token from the raw string
  (`findAdopters.ts:450`) — no platform. This is the symmetry hole that makes
  the always-emitted `social_handle` token mandatory (not optional).
- Import review's "duplicate candidate" suggestions therefore keep working, and
  actually improve (URL-form imports now hit the fast index via `social`).

---

## 4. Scoring / confidence

**Product decision (this round):** a social handle is a *merge* signal, not
something to weaken. Two or more records sharing a handle should surface as a
merge candidate. **No popularity down-ranking** — the earlier `social_handle: 6`
idea is dropped.

Two social token types, **both strong / merge-worthy**:

| Token | Value | Weight | Strong-signal? | Down-ranked? |
|---|---|---|---|---|
| `social` | `platform\|handle` | 3 | yes | no |
| `social_handle` | `handle` | 3 (Decision 1, §9) | yes | no |

- Add `social_handle` to `weights`; add **both** `social` and `social_handle` to
  `STRONG_SIGNAL_TYPES`. Add **neither** to `POPULARITY_THRESHOLDS`.
- **Double-count note:** a same-platform match fires *both* tokens (3+3=6). To
  keep a social match ≈ phone/email tier (3), score the `(social,
  social_handle)` pair for a given handle as **one** contribution — take the
  **max**, not the sum. (Or accept the sum as "same account = extra strong."
  Open Q1.) A cross-platform / platform-unknown match fires only
  `social_handle` → 3, so a lone handle match still clears the merge bar — which
  is the intent.

### #3 revised — "handle on many records" is a data-quality issue, not a weight

Per your direction: a handle on **many** records usually means a rescuer entered
**their own** social contact on adopter records, not the adopter's. Quietly
halving weights would weaken *legitimate* 2-record merges to fight a data-entry
bug — wrong lever. Instead, detect and correct the mis-entry:

- **Detect:** a social handle whose global record-count exceeds a threshold is
  treated as a **shared / rescuer contact** (a real adopter handle appears on a
  handful of records at most; a rescuer's own handle appears on dozens).
- **Warn-at-entry already exists.** `DuplicateHint` (mounted in the composer,
  `ContactEntriesSection.tsx:927`) already fires when a social is added that
  matches other records — it calls `findAdopters` and lists matches with
  "Ver perfil" / "Marcar como duplicados". The dual-token change *improves* this
  path (URL↔handle now hit the fast index). So the guard is **not** a new warning
  — it's making the existing surfaces high-count-aware:
  - *DuplicateHint copy for the high-count case:* today it shows up to 3 matches
    as "possible duplicate". When the match **count** exceeds a threshold, switch
    the message to "this handle is on N records — the adopter's, or your own / a
    rescuer's contact?" so a shared contact reads as a data-quality prompt, not a
    merge suggestion. (Small change to an existing component.)
  - *Exclude from batch candidate generation:* the admin scan
    (`duplicate_candidates`) would still pair a high-count handle across all its
    records (one rescuer handle on 50 records → ~1,200 false candidates). Skip
    candidate generation for handles above the threshold. This is **exclusion**,
    not weight-halving.
  - *(Optional) admin data-quality view:* list high-count handles for cleanup.
- **Threshold is for detection/exclusion, not weighting** — consistent with "no
  down-ranking". A real adopter handle appears on a handful of records; a
  rescuer's own handle appears on dozens, so the threshold sits between.
- **Likely a follow-up.** v1 ships the dual-token matching; the high-count
  awareness lands right after (same token index). Flagged here so v1 doesn't ship
  stronger matching *without* a plan for the rescuer-contact noise it can create.

---

## 5. False-positive analysis

Per the product decision, a shared handle across a *few* records is a wanted
merge, not a false positive. The genuine risk is narrower:

- **The rescuer-contact case** — one social handle (a rescuer's own) mis-entered
  on many adopter records → a web of false pairwise merge candidates. This is
  the load-bearing risk now, and it is addressed by the §4 (#3-revised)
  data-quality guard (detect high-count handle → warn at entry + exclude from
  matching), **not** by weakening real matches. Because v1's stronger matching
  can *create* this noise, the guard should land with or immediately after v1
  (Decision 2, §9) — do not ship strong social matching and leave the noise
  unmanaged.
- **The Facebook trap (§3.1)** — the naive "last path segment" rule would
  collapse every `facebook.com/profile.php?id=N` into the garbage token
  `profile.php`, a catastrophic all-numeric-FB-profiles collision. The
  platform-aware normalizer keys FB numeric URLs on the numeric ID instead, and
  this also fixes the same latent bug in today's `socialLikeNeedle`.

---

## 6. Companion UX change — network-first social composer

This is a **paired UX change**, not strictly required by the tokenization work,
but it directly improves the data the tokenizer receives — especially the
Facebook numeric-ID capture that §3.1 depends on. Ship it alongside, or as an
immediately-following patch.

### Current flow (input-first)

In the composer and the per-entry edit (`ContactEntriesSection`), a social entry
shows a single input with the generic placeholder `@usuario o URL`
(`ce_input_ph_social`). The `SocialPlatformPicker` only renders **after** the
user has typed something (`editDraft.value.trim().length > 0`,
`ContactEntriesSection.tsx:676`). If the typed value is a recognizable URL,
`detectSocialPlatform` **locks** the platform ("auto" badge); otherwise the user
must pick the network manually.

### Proposed flow (network-first)

For `type='social'`, render the `SocialPlatformPicker` **immediately** (before any
value is typed), and drive the input's placeholder from the picked network:

- **No network picked yet** → keep the generic placeholder `@usuario o URL`.
- **Network picked** → show a network-specific placeholder (table below).
- **URL auto-detect still wins:** if the user pastes a recognizable URL, keep the
  existing `detectSocialPlatform` → locked "auto" behavior (it overrides the
  manual pick). Unchanged.

The network-first order is what makes the per-network placeholder possible, and
for Facebook it's the lever that steers users to paste the *profile link* (which
carries the numeric ID) instead of inventing a vanity handle.

### Per-network placeholders

New i18n keys `ce_input_ph_social_<platform>` (fallback to `ce_input_ph_social`
for the not-yet-picked state and any unmapped platform):

| Platform | es | en | pt |
|---|---|---|---|
| instagram | `@usuario` | `@username` | `@usuário` |
| tiktok | `@usuario` | `@username` | `@usuário` |
| x | `@usuario` | `@username` | `@usuário` |
| threads | `@usuario` | `@username` | `@usuário` |
| **facebook** | `facebook.com/usuario o enlace del perfil` | `facebook.com/username or profile link` | `facebook.com/usuario ou link do perfil` |
| other | `URL o usuario` | `URL or username` | `URL ou usuário` |

Rationale: handle networks store the `@handle` as their stable identity, so
`@usuario` is the exact form we want. Facebook's durable identifier is the
numeric ID that only appears in the URL, so its placeholder nudges to the link
(§3.1). Handle networks still accept a pasted URL (the normalizer reduces it) —
the `@usuario` placeholder is the simplest correct example, not a restriction.

### Scope note — import grid

The ImportWizard bulk-edit grid (`ContactEntriesInput.tsx`) has its own
social-row + picker and is **out of scope** for v1 (it's a dense edit table, not
a guided composer). Applying the same network-first placeholder there is an
optional follow-up (Decision 5b, §9).

---

## 7. Migration & rollout

1. Bump `TOKENIZER_VERSION` `v3 → v4` (`src/lib/tokenizer.ts:269`). The social
   token **value format changes** (`@juan`/`facebook.com/juan` → `facebook|juan`),
   so all social tokens must be regenerated.
2. **Full re-scan** via the existing admin path: `DuplicatesPanel` → "Scan Now"
   (`POST /api/admin/duplicates`). The scan deletes each adopter's old tokens and
   reinserts (`duplicates.ts:50`; route :216–230), then recomputes
   `duplicate_candidates`. No bespoke migration script needed — same operational
   step already used for the 2.45.0 tokenizer bump.
3. **D1 notes** (`docs/D1_COMPATIBILITY.md`): token inserts are already chunked
   multi-row (`duplicates.ts` ~:53). No `inArray`. Expect **read-replica lag** —
   right after a re-scan, matches converge over a few seconds
   (`project_d1_replica_lag`); acceptable for dedup.
4. Sequencing: this can ship in the **same** re-scan as any other pending
   tokenizer change to avoid a second full scan.

---

## 8. Testing

Unit (`src/lib/tokenizer` + a new spec) — **Facebook cases are the priority**:
- IG/TikTok/X/Threads (path = username): `instagram.com/erika.salinas`→
  `erika.salinas`; `tiktok.com/@x`→`x` (note: 1-char tail; min-length guard);
  `x.com/juanp`→`juanp`; `threads.net/@ana`→`ana`.
- Facebook vanity: `facebook.com/sofia.ortellado.7`→`sofia.ortellado.7`;
  `@juan` + `platform=facebook` → `juan`.
- **Facebook numeric (regression guards):**
  `facebook.com/profile.php?id=100012345678901`→`id:100012345678901`;
  `facebook.com/people/Juan-Perez/100012345678901/`→`id:100012345678901`;
  **two different** `profile.php?id=…` URLs → **different** tokens (must NOT both
  collapse to `profile.php`).
- Nulls: bare domain `facebook.com`→`null`; `''`→`null`; `ab`→`null`.
- `extractTokens` with structured socials emits **two** tokens per social:
  `facebook.com/juan` and `@juan`(`platform=facebook`) both →
  `social:facebook|juan` + `social_handle:juan`; `profile.php?id=N` →
  `social:facebook|id:N` + `social_handle:id:N`; a platform-unknown bare handle
  → `social_handle:juan` only (no `social`).

Integration (`findAdopters` duplicate mode — validate query logic via the
system `sqlite3` CLI per `project_e2e_node26_bettersqlite`, since Playwright/
better-sqlite3 can't run locally on Node 26):
- URL vs `@handle` **same platform** → matches via `social` + `social_handle`
  (scored as one signal, §4), no LIKE needed.
- **Bare-handle query** (`@juan`, no platform) vs a platform-scoped stored
  record → still matches via `social_handle`. *This is the import/form symmetry
  case — the key regression guard.*
- Same handle **different platform** (FB vs IG) → matches via `social_handle`
  (merge-worthy) — no LIKE fallback needed.
- Scoring: a same-platform social match contributes ≈ the phone/email tier (not
  double), per the max-not-sum rule (§4).
- (If the §4 shared-handle guard ships in scope) a handle exceeding the
  high-count threshold is flagged/excluded and does not generate pairwise
  candidates.

Companion UX (§6) — Playwright, runs in CI (locale-agnostic selectors per
`feedback_e2e_locale_agnostic_selectors`):
- Composer: pick `type=social` → the network picker shows **before** typing;
  placeholder is generic until a network is picked, then network-specific
  (assert Facebook shows the "…enlace del perfil" copy, IG shows `@usuario`).
- Pasting a recognizable URL still locks the platform ("auto"), overriding the
  manual pick.

Regression: `ce-chip` / display untouched; existing dedup specs stay green.

---

## 9. Decisions (locked 2026-08-25)

Design/normalization (§3.1–3.5), scoring (§4), and false-positive framing (§5)
are settled. The prior open questions are resolved as follows:

1. **Token weights.** `social` = 3 and **`social_handle` = 3**; the
   `(social, social_handle)` pair for one handle is scored as **max, not sum**,
   so a same-platform match stays at the phone/email tier (not 6). Any handle
   match is merge-worthy.
2. **High-count-handle guard → follow-up (not v1).** Warn-at-entry already exists
   (`DuplicateHint`). The follow-up adds: (a) count-aware copy in `DuplicateHint`
   for the shared/rescuer case, (b) exclusion of high-count handles from **batch**
   candidate generation. **Threshold set at build time** from a quick query of
   current handle counts (working assumption: exclude a handle on **> ~8** distinct
   records). v1 ships the dual-token matching; the guard lands immediately after
   so stronger matching never runs without noise management (§5).
3. **Merge = suggested, never auto.** Shared-handle matches surface as merge
   *candidates* through the existing `duplicate_candidates` + `DuplicateMergeModal`
   flow; a human confirms. (The rescuer-contact case makes auto-merge unsafe.)
4. **Bundle the re-scan.** The `TOKENIZER_VERSION v3→v4` bump + one full re-scan
   is bundled with any other pending tokenizer work (e.g. the family/alias
   name-token gap) so only one "Scan Now" is spent.
5. **Companion UX (§6).** (5a) Ship the network-first composer **together with, or
   just before,** the dedup change — the Facebook link nudge improves the numeric
   IDs the tokenizer sees. (5b) Apply it to the **main adopter composer/edit** in
   v1; the ImportWizard grid (`ContactEntriesInput`) is a follow-up.

**Sequencing that falls out of the above:**
1. v1a — §6 network-first composer + per-network placeholders (composer/edit).
2. v1b — dual-token tokenizer (§3) + query-side (§4), `TOKENIZER_VERSION v4`,
   one re-scan (bundled).
3. v2 — high-count-handle guard (§4 #3-revised): DuplicateHint copy + batch
   exclusion (+ optional admin view).

---

## 10. Touch list (when approved)

- `src/lib/tokenizer.ts` — add `social_handle` to the `TokenType` union;
  export `normalizeSocialHandle`; bump `TOKENIZER_VERSION` `v3→v4`;
  `extractTokens` new `socials` param; emit the **dual token** per social
  (`social` = `platform|handle` when platform known, `social_handle` = `handle`
  always).
- `src/app/actions/findAdopters.ts` — build the same **pair** on the query side
  (detect platform for URL inputs); `socialLikeNeedle` → wrapper over
  `normalizeSocialHandle`; add `social_handle: 3` to `weights`, add
  `social`+`social_handle` to `STRONG_SIGNAL_TYPES`; score the pair as max-not-sum
  (§4). **No** `POPULARITY_THRESHOLDS` change.
- `src/app/actions/duplicates.ts` (= `tokenizeAdopter`, also the import path via
  `importUpsert.ts:140`) + `src/app/api/admin/duplicates/route.ts` — derive &
  pass structured `socials` (mirror `aliases`). No separate import-tokenize site.
- Import: no change needed to `importUpsert.ts` beyond what it already does
  (`detectSocialPlatform` on stored socials); dedup-review keeps working (§3.5).

**Follow-up (shared / rescuer-handle guard — §4 #3-revised; Decision 2, §9):**
- Entry-time warning when a social handle already exists on ≥N records
  (`addContactEntry` / composer).
- Exclude flagged high-count handles from candidate generation
  (`findAdopters` / the scan's candidate step).
- Optional admin data-quality list of high-count handles.
- Tests: new `tokenizer` handle-normalization spec; dedup query-logic checks.
- Ops: admin "Scan Now" after deploy (same as 2.45.0).

**Companion UX (§6):**
- `src/components/ContactEntriesSection.tsx` — render `SocialPlatformPicker`
  before the value is typed (network-first); placeholder driven by the picked
  platform.
- `src/components/SocialPlatformPicker.tsx` — (already selectable) no change
  expected beyond being mounted earlier; verify empty/no-selection state.
- `src/i18n/locales/{es,en,pt}.ts` — add `ce_input_ph_social_{instagram,tiktok,
  x,threads,facebook,other}`; keep `ce_input_ph_social` as the not-yet-picked
  fallback. **Update all three locales together** (per CLAUDE.md i18n rule).
- Optional follow-up: `src/components/ContactEntriesInput.tsx` (import grid).
