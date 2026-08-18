# Follow-up Communications with the Adopter

> Status: PLANNED, deferred (not scheduled to start). Full design approved-in-principle on
> 2026-06-20; implementation postponed by the user. Re-confirm scope before starting.

## Context

After an adoption, rescuers currently have no structured way to stay in touch with the
adopter. We want timed **follow-up prompts** the rescuer can send to the adopter **via WhatsApp
in one click** (prefilled, localized message). Two trigger families:

- **Adaptation check-ins** — relative to the adoption date (first night, a few days, two weeks,
  a month) to confirm the pet is settling in.
- **Health milestones** — computed from the pet's age and neuter status (complete the vaccine +
  deworming series for young pets; schedule castration as the pet nears ~6 months).

The intended outcome: the system proactively reminds the rescuer when a follow-up is due, the
rescuer sends it with one tap, and each send is recorded so the app knows what's been done.

### Confirmed product decisions
1. **Proactive notifications** — a scheduled job fires an in-app notification (bell) when a
   follow-up comes due, so the rescuer is reminded without visiting the page.
2. **Surfaced in all three places** — (a) a "Seguimientos" panel on the adopter profile page,
   (b) a per-animal "follow-up due" badge on `/my-animals`, (c) the existing notifications bell/page.
3. **Tracking** — clicking "send via WhatsApp" logs a `recordType='follow_up'` activity record on
   the adoption, which also marks that follow-up as done.

### Proposed schedule (researched, Argentina/es-AR context)
Adaptation check-ins (relative to `adoptions.date`): **+1d, +3d, +14d, +30d** (and an optional
**+90d**). Health milestones (from `adoptions.estimatedBirthDate` + `adoptions.neutered`):
**vet/vaccination + deworming** if the pet was adopted under **8 months** (per the user's ask;
booster-series detail in copy); **neuter/spay** when the pet nears **6 months** of age and
`neutered != 1`. Basis: dogs get distemper+parvo at 6/8 weeks, rabies
~20–24 weeks, deworming every 15 days to 3 months; cats get triple felina from 6–8 weeks (boosters
every 3–4 weeks), rabies from 12 weeks; Argentina public castration programs require the animal to
be **>6 months and healthy**. Timings live as a domain constant, not hardcoded in UI/cron.

## Architecture & build order

`computeFollowups(...)` in `src/domain/followups.ts` is the **shared brain** consumed by all three
surfaces *and* the cron worker (it's pure, so the standalone Worker can import it directly — the
Worker cannot import `'use server'` actions). Build order:

**Phase 1 (no scheduler):** domain → wa.me builder → data-access actions → adopter panel +
my-animals badge + manual "mark sent". Ship behind a feature flag.
**Phase 2 (proactive):** the Cloudflare Cron Worker that fires `follow_up_due` notifications.

---

## 1. DOMAIN — `src/domain/followups.ts` (NEW, pure; no db/server imports)

- **Constants** (no magic strings): `FOLLOWUP_KEYS` (`adapt_1d`, `adapt_3d`, `adapt_14d`,
  `adapt_30d`, `adapt_90d`, `health_vacc_deworm`, `health_neuter`), `FOLLOWUP_KINDS`
  (`adaptation` | `health`), `FOLLOWUP_STATUS` (`done` | `due` | `upcoming` | `missed` |
  `not_applicable`).
- **`FOLLOWUP_SCHEDULE`**: array of `{ key, kind, copyKey, offsetDays?, condition?, windowDays }`.
  `windowDays` = the **actionable window** after `dueDate` during which the item stays `due` and the
  cron may notify; past it the item becomes `missed` (see below). Adaptation entries use `offsetDays`;
  health entries use a pure `condition` predicate over
  `{ ageMonthsAtAdoption, ageMonthsNow, neutered, species }`:
  - `health_vacc_deworm`: applicable iff `estimatedBirthDate` present AND age-at-adoption **< 8
    months** (honors the user's stated threshold; copy notes the full puppy/kitten booster series is
    most relevant under ~16 weeks, but the "visit the vet / confirm vaccines + deworming" nudge
    applies through 8 months). Due ≈ adoptionDate + small lead (~2d); generous `windowDays` (~60).
  - `health_neuter`: applicable iff `estimatedBirthDate` present AND `neutered !== 1`; due when the
    pet reaches ~6 months (`estimatedBirthDate + ~150d`); generous `windowDays` (~90).
  - Adaptation windows are tight (e.g. `adapt_1d`/`adapt_3d` ~5–7d, `adapt_14d` ~10d, `adapt_30d`
    ~21d) — a "first night" nudge sent weeks late is worse than not sent.
- **`computeFollowups(input)`** → `FollowupItem[]` where input is
  `{ adoptionDate, estimatedBirthDate, neutered, species, now, sentKeys: Set<string> }` (all `Date`
  objects — Drizzle converts the epoch-seconds columns on read). Per entry: resolve applicability →
  compute `dueDate` → `done` if `sentKeys.has(key)`; else if `now < dueDate` → `upcoming`; else if
  `now <= dueDate + windowDays` → `due`; else → **`missed`**; inapplicable → `not_applicable`.
- **Staleness bound is load-bearing.** Without `windowDays`, every past-due check-in stays `due`
  forever, which (a) floods the panel with stale, no-longer-actionable items and (b) makes the
  **first cron run fire a storm** — a 60-day-old adoption would have `adapt_1d/3d/14d/30d` all `due`
  with no prior notification → 4 late notifications at once, ×every recent adoption. `windowDays`
  neutralizes both: pre-launch / long-past items resolve to `missed` and never notify. The panel
  hides `missed` (or shows it greyed, non-actionable); the cron notifies **only `due`**. Optionally
  also pass a launch-date cutoff so nothing before launch ever notifies.
- **`parseFollowupKey(comments: string|null): string|null`** — reads the key back from a logged
  follow_up record (see matching scheme below). Pure, shared by data-access + Worker.
- Pure helpers `addDays`, `weeksBetween`, `monthsBetween` (exported for unit tests).

### Schedule-key ↔ record matching — **no schema migration**
Store the key in the follow_up record's **`comments` column as JSON**: `{"followupKey":"adapt_3d"}`.
Verified safe: `AdoptionHistory.tsx:428-447` only renders `comments` when it parses to
`{contractScreenshot}`, otherwise `return null` — so this JSON does not leak into the timeline. And
`saveAdoption`'s INSERT path spreads `...data` (`adoptions.ts:84-85`), so `comments` persists on
create (the update allow-list omits it, but follow_up records are only ever created). `sourceUrl`
was rejected — it renders as a clickable link.

## 2. INFRASTRUCTURE

- **`src/lib/whatsapp.ts` (NEW)** — `buildWhatsAppLink(phone, country, text) → { href, mode }`.
  Use a **hand-rolled dialing-code map** keyed by the ISO alpha-2 codes already in
  `src/config/countries.ts` (add `src/config/dialingCodes.ts`), **not** libphonenumber-js
  (edge/bundle weight). Must handle, as correctness cases (AR is the primary market):
  - **AR mobile `9` insertion**: `+549<area><number>` for `country==='AR'`.
  - **Already-prefixed input**: phone values in `contactEntries` are stored as typed and may already
    carry `+54` / `0054` / leading `54` — strip non-digits, detect/strip an existing dialing code,
    never double-prefix.
  - **Bare national digits** (from `cleanPhone`/`extractPhones`): prepend the dialing code from `country`.
  - **Missing/ambiguous country**: return `mode:'broadcast'` → `https://wa.me/?text=<encoded>`
    (existing behavior) so the button still works recipient-less; panel shows a "sin destinatario" hint.
  Phone selection: first `type==='phone'` from `deserializeContactEntries(adopter.contactEntries)`.
- **`src/lib/interpolate.ts` (NEW)** — `interpolate(template, params)` replacing `/{(\w+)}/g`.
  Required because `t()` (`LanguageContext.tsx:54-78`) is a pure key lookup with **no interpolation**
  (verified). Single render path for both the client panel and the Worker.

## 3. DATA ACCESS — `src/app/actions/followups.ts` (NEW, `'use server'`)

- **`getAdopterFollowups(adopterId)`** → per adoption `{ adoptionId, animalName, items }`. Load the
  adopter's adoptions (reuse `getAdoptions` in `adoptions.ts`); for each `recordType==='adoption'`,
  gather sibling `follow_up` rows, build `sentKeys` via `parseFollowupKey`, call `computeFollowups`.
  D1: **loop with `Promise.all`, never `inArray`/IN-with-array**.
- **`logFollowupSent({ adopterId, adoptionId, followupKey, animalName, species })`** — **reuse
  `saveAdoption()`** with `recordType: RECORD_TYPES.FOLLOW_UP`, `date: new Date()`,
  `comments: JSON.stringify({ followupKey })`. That already writes the audit row, `adopterHistory`,
  and `revalidatePath`. Add an explicit `logAudit({ action:'followup_sent', target: adopterId,
  details:{ adoptionId, followupKey } })`; register `'followup_sent'` in `ACTIVITY_ACTIONS`
  (`activity.ts`) if it should appear in the org feed. "Done" is implicit on next compute.

## 4. CRON WORKER — `workers/followup-cron/` (NEW, **Phase 2**)

Cloudflare **Pages has no cron triggers** (verified — no `[triggers]` in `wrangler.toml`), so this is
a **standalone Worker** with its own `wrangler.toml`, bound to the **same D1** (same `database_id`).

- The Worker **cannot import `'use server'` actions**. It imports the **pure** `computeFollowups` /
  `FOLLOWUP_SCHEDULE` / `parseFollowupKey`, imports `es.ts` + `interpolate` for copy, and
  **replicates `createNotification`'s insert as raw D1 SQL — including the
  `NOTIF_ENABLED_follow_up_due` kill-switch read** against `app_config` (else the admin kill switch
  won't apply to cron-fired notifications).
- `scheduled()` daily (`crons = ["0 9 * * *"]`): query `adoptions WHERE record_type='adoption'`
  bounded to recent rows (~last 120d); per row build `sentKeys`, run `computeFollowups(now)`, take
  **only `status==='due'`** (never `missed` — that's what prevents the cold-start storm). **Two dedup
  layers:** (1) `sentKeys` (a logged follow_up suppresses re-notify);
  (2) `NOT EXISTS` against `notifications` where `type='follow_up_due'` and `metadata` carries the
  `{adoptionId, followupKey}` pair. Recipient = `adoptions.addedBy` (the rescuer) — **skip rows
  where `addedBy==='anonymous'`/not an email** (known limitation: legacy unattributed adoptions
  can't be notified). Notification `url` deep-links to `/adopter/<adopterId>#adoption-<adoptionId>`
  (the card already renders `id={\`adoption-${id}\`}`).
- D1 in the Worker: epoch-seconds (`strftime('%s','now')`), no array IN, tolerate read-replica lag
  (Layer 2 prevents dupes even if a just-logged follow_up hasn't replicated).
- Add a Worker deploy step to CI.

## 5. PRESENTATION

- **`src/components/FollowupsPanel.tsx` (NEW)** — rendered in `AdopterProfileV2.tsx` (page
  `src/app/adopter/[id]/page.tsx`) alongside `AdoptionHistory`. Per adoption: list `FollowupItem`s
  (hide `not_applicable`; hide or grey-out `missed` as non-actionable), grouped due → upcoming →
  done, status pills using **themed colors only**
  (follow_up = violet, matching the timeline stripe; reuse `getRecordTypeColors`). One-click WhatsApp
  button = `buildWhatsAppLink(phone, adopter.country, interpolate(t('followups.messages.<copyKey>'),
  {animalName, adopterName}))`; on click `window.open(href)` then `logFollowupSent(...)` and
  optimistically flip to `done`. Separate **"marcar como enviado"** affordance logs without opening
  WhatsApp. Reuse inline-SVG icon conventions (`RecordTypeIcon`), no emoji for functional icons.
- **`src/app/my-animals/page.tsx`** — extend the `Animal` interface with `followupDue?: boolean`,
  compute it server-side via `computeFollowups` per animal, render a small violet "seguimiento
  pendiente" pill in the detail-pills region.
- **Notifications bell** — register `type='follow_up_due'` in **all three** TYPE_LABELS sites
  (`admin/notifications/page.tsx` + its kill-switch row, `notificaciones/page.tsx`,
  `components/NotificationBell.tsx`). Deep link lands on the anchored adoption card.

## 6. i18n — `followups` namespace in BOTH `src/i18n/locales/es.ts` and `en.ts`
Peer of `notifications`. Keys: `panel_title`, `status_due/upcoming/done`, `send_whatsapp`,
`mark_sent`, `no_recipient_hint`, `badge_due`, `notif_title`, `notif_body`, and
`messages: { <copyKey>: ... }` per schedule entry, using `{placeholder}` via `interpolate()`.
Spanish-first, warm. Examples:
- `messages.adapt_3d`: `"¡Hola {adopterName}! 🐾 Ya pasaron unos días desde que {animalName} llegó a su nuevo hogar. ¿Cómo viene la adaptación? Cualquier duda, estamos para ayudarte."`
- `messages.adapt_30d`: `"¡Hola {adopterName}! Se cumple un mes con {animalName} 🎉 ¿Cómo están? Nos encantaría ver una fotito si tenés."`
- `messages.health_neuter`: `"¡Hola {adopterName}! {animalName} ya está llegando a la edad ideal para la castración 🩺 ¿Querés que te pasemos info de veterinarias?"`

## 7. Rollout
- **No schema migration** (follow_up `comments` JSON + `notifications.metadata` cover both dedup
  layers). Confirm during build.
- Feature flag `ENABLE_FOLLOWUPS` in `src/config/features.ts` — add to **both** `FEATURE_FLAGS`
  and the hardcoded list in `getAllFeatureFlags` (easy to miss). Client-visible → also add to
  `PUBLIC_FLAG_KEYS` (the 5th plumbing site; panel + badge are non-admin UI).
- Ship Phase 1 behind the flag; enable the cron Worker (Phase 2) last.

---

## Critical files
- **NEW:** `src/domain/followups.ts`, `src/lib/whatsapp.ts`, `src/lib/interpolate.ts`,
  `src/config/dialingCodes.ts`, `src/app/actions/followups.ts`,
  `src/components/FollowupsPanel.tsx`, `workers/followup-cron/{index.ts,wrangler.toml}`.
- **EDIT:** `src/i18n/locales/es.ts` + `en.ts`; `src/config/features.ts` +
  `src/lib/publicConfig.ts` (PUBLIC_FLAG_KEYS); `src/components/AdopterProfileV2.tsx`;
  `src/app/my-animals/page.tsx`; `src/app/actions/activity.ts` (ACTIVITY_ACTIONS); TYPE_LABELS in
  `src/app/admin/notifications/page.tsx` + `src/app/notificaciones/page.tsx` +
  `src/components/NotificationBell.tsx`. Reuse `saveAdoption`/`getAdoptions` (`adoptions.ts`),
  `deserializeContactEntries` (`contactEntries.ts`), `logAudit` (`audit.ts`), date utils (`dates.ts`).

## Risks / known dependencies
- **`estimatedBirthDate` sparsity (data dependency).** Both health milestones only fire when
  `estimatedBirthDate` is populated. If that column is mostly empty in real data, health follow-ups
  will rarely trigger — the adaptation check-ins (which need only `adoptions.date`) carry the
  feature. Worth quantifying fill-rate early so this is an expectation, not a surprise; consider
  prompting for pet age when an adoption lacks it.
- **AR WhatsApp `9`-insertion + double-prefix** — correctness in the primary market (§2).
- **Worker can't import server actions** — replicate the notification insert + kill-switch as raw
  SQL (§4).
- **`addedBy='anonymous'`** legacy adoptions are un-notifiable — accepted limitation.
- **Three TYPE_LABELS mirrors + duplicate feature-flag list + PUBLIC_FLAG_KEYS** — half-registration
  risk; all sites enumerated above.
- **`t()` has no interpolation** — solved by `interpolate()`.

## Verification
1. Unit-test `computeFollowups` (pure) — offset boundaries, window expiry → `missed`,
   `not_applicable` health entries, `done` after a sent record; and `buildWhatsAppLink` for AR
   (verify the `9`), already-prefixed input (no double prefix), missing country (broadcast fallback).
2. Seed an adoption with `date` ~31d ago, `estimatedBirthDate` ~5mo ago, `neutered=0` → expect
   `adapt_30d` + `health_neuter` = due (and the earlier `adapt_1d/3d/14d` = `missed`, not `due`).
2b. **Cold-start guard:** seed an adoption ~60d old → confirm zero `due` adaptation check-ins (all
   `missed`), so the first cron run fires no late-nudge storm.
3. `npx tsc --noEmit` clean; lint under the 125 ratchet.
4. In-app: adopter page → panel shows due items → click WhatsApp → prefilled localized link opens →
   a `follow_up` record logs (violet card, `comments` JSON doesn't leak) → item flips to `done`;
   `/my-animals` shows the due badge.
5. Phase 2: `wrangler dev --test-scheduled` against a local D1 copy → `follow_up_due` notification
   appears in the bell; second run produces **no duplicate** (Layer 2).
6. Playwright: mock `getAdopterFollowups`, assert panel sections + WhatsApp `href`, assert click
   calls `logFollowupSent`. Update any selectors touched. Cron is out of Playwright scope.
