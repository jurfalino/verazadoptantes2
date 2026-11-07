# Flags vs alerts — one meaning each (2026-11-07)

## Definitions (Jon, 2026-11-07)
- **Alert** — "this person is not trustworthy to adopt an animal". System-computed:
  `too_many_adoptions`, `too_many_requests`, `housemate_low_rating`, `housemate_alerts`.
  A profile's OWN star rating is not an alert (it stays the rating).
- **Flag** — "some action may be needed on this profile", manual or automatic:
  `inaccurate`, `duplicate` (reported), `possible_duplicate` (system), `verified_identity`, `verified_address`.

## Constraints (Jon)
- **No UI changes.** No copy, no layout, no new chips, even where today's copy is loose
  (e.g. applicants' «Alertas en el perfil» on flags). One exception, approved: the
  pick-adopter → wizard path uses the Admin thresholds instead of hardcoded 5/90 · 3/30
  (prod is 2/10 · 3/30).
- Sign-in gate rule unchanged (1★ via `ratingBansAdopting`, plus the two period alerts).

## Never rename (stored or external values)
`adopter_flags.reason`, `blocked_logins.reason` codes (`low_rating`, `too_many_*`),
notification `type`s, audit actions, API field names, `'use server'` exports,
`data-testid`s Playwright uses (rename only together with the specs).
`app_config.WALKTHROUGH_DEMO_OVERLAY` JSON keeps reading the old `flags.tooManyAdoptions` shape.

## Commits, in order
1. **API** — stop returning `inaccurate` (profile.flags, risk.flags, enum, docs, doc
   scenario «Diego»); add `housemate_low_rating` {rating, ratingLevel, ratingLabel} and
   `housemate_alerts` to `profile.alerts` / `risk.alerts`, from `housemateAlertsFor` in a
   strict mode (a failed read or a spent budget → 503, the API's fail-closed rule).
   Additive per the docs' versioning note; `inaccurate` never appeared in a prod response
   (0 rows, 2026-11-07).
2. **One alerts computation + bug fixes** — PickAdopterForAnimalModal uses
   `getAdoptionConfig`; the dashboard / login gate / profile header reuse `periodAlerts`
   where the rule is the same; `verified_address` written with `flaggedBy` (was `addedBy`,
   not a column → 'anonymous'). No backfill of old rows (Jon's data).
3. **Rename (mechanical, last)** — split `AdopterFlags` into flags + `PeriodAlerts`;
   `OpenAlertKind`/`openAlertKinds`/`openAlerts` → flag names; `AlertPill`'s mixed kind
   type split; "density flags" comments → alerts; i18n alert keys out of `flags.*`
   (es + en + pt, every dynamic `t(\`…${kind}\`)` checked).

## Verification
tsc, lint ratchet, vitest, `npm run build`; Playwright for touched specs; independent
review before production (partner-facing API).
