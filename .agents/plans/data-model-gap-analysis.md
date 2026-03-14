# Data Model Gap Analysis — Prod vs Current Schema

## Scope

- **Schema source:** `src/db/schema.ts` (current application data model).
- **Migrations:** `drizzle/*.sql` applied in **lexicographic filename order** by `wrangler d1 migrations apply`.
- **Prod:** `pet-adoption-db` (remote). CI applies migrations on every push to `master`.

---

## 1. Schema vs migrations coverage

All tables and columns in `schema.ts` are created or altered by the existing migration set:

| Table | Created in | Notes |
|-------|------------|--------|
| adopters | 0000, 0003_greedy (alter) | familyMembers, notes, sourceUrl, country, tokenHash, deletedAt via 0007, 0010, 0014, 0016 |
| adopter_images | 0000, 0004_add_adoption_id, 0017, 0018 | adoptionId, media_type, thumbnail_url |
| adopter_flags | 0000 | — |
| adopter_history | 0000 | — |
| adoptions | 0000, 0002, 0005, 0006_identity, 0010, 0019 | on_behalf_of, identity_verified, source_url, age, sex, color, microchip, recordType, deliveredToHome, verifiedAddress via later migs |
| adopter_stats | 0003_*, 0021 | user_id in 0021 |
| app_config | 0003_* | — |
| duplicate_tokens, duplicate_candidates | 0006_lame, 0014 | — |
| data_requests | 0006_lame, 0011 | — |
| user, account, session, verificationToken | 0002 | 0008 normalizes user ids |
| user_profiles | 0006_lame, 0012, 0016 | country, country_confirmed |
| audit_log | 0006_lame, 0012 | — |
| notifications | 0006_lame, 0020 | — |
| form_submissions | 0006_lame, 0022 | answers_json in 0006_lame and 0023 |
| searches | 0000, 0015 | unique on query |

No **missing** table or column was found: the migration set, in order, is intended to produce the current schema.

---

## 2. Migration conflicts / idempotency issues

### 2.1 `answers_json` — duplicate column risk (needs fix)

- **0006_lame_lady_ursula.sql** creates `form_submissions` **with** `answers_json` (line 69).
- **0023_add_answers_json.sql** runs `ALTER TABLE form_submissions ADD COLUMN answers_json TEXT`.
- **Order:** Lexicographic order runs `0006_identity_verified` then `0006_lame_lady_ursula` then … then `0022` then `0023`.
- **Effect:** On any DB where 0006_lame has run, `form_submissions` already has `answers_json`. When 0023 runs, it fails with **duplicate column name: answers_json**.
- **Fix:** Remove `answers_json` from the `CREATE TABLE form_submissions` in **0006_lame_lady_ursula.sql** so that **0023** is the single migration that adds this column. Then:
  - Fresh DB: 0006_lame creates `form_submissions` without `answers_json`; 0022 is no-op; 0023 adds `answers_json`.
  - Existing prod (0022 already applied): 0023 adds `answers_json`; 0006_lame’s CREATE is no-op when re-run.

### 2.2 `0020_add_notifications.sql` — not idempotent

- **0020** uses `CREATE TABLE notifications` **without** `IF NOT EXISTS`.
- **0006_lame** uses `CREATE TABLE IF NOT EXISTS notifications`.
- **Order:** 0006_lame runs before 0020, so 0006_lame creates `notifications` first. When 0020 runs, it tries `CREATE TABLE notifications` and can fail with **table already exists** on re-runs or in environments where 0006_lame was applied.
- **Fix:** Change 0020 to `CREATE TABLE IF NOT EXISTS notifications (...)` so it is safe to run after 0006_lame or on re-runs.

### 2.3 Duplicate migration prefixes (0003, 0004, 0006)

- Two **0003** files and two **0004** and two **0006** files exist. Order is lexicographic (e.g. 0003_adopter_enhancements before 0003_greedy_frog_thor). No change required for correctness, but worth being aware of for future edits.

---

## 3. Prod state after latest push

- After **push staging → master**, CI runs **Apply D1 Migrations** and runs `wrangler d1 migrations apply pet-adoption-db --remote`.
- Only migrations **not** yet in `d1_migrations` are executed. If 0023 was never applied (e.g. prod had 0022 but not 0023), then 0023 runs once and adds `answers_json`. If 0006_lame was later changed to include `answers_json`, then on a **new** environment 0006_lame creates the column and 0023 can fail.
- **Conclusion:** To avoid failures on current and future prod/staging runs, apply the two fixes below.

---

## 4. Recommended migrations changes

| # | File | Change |
|---|------|--------|
| 1 | `drizzle/0006_lame_lady_ursula.sql` | Remove `answers_json` from the `form_submissions` CREATE TABLE block so 0023 is the only migration that adds this column. |
| 2 | `drizzle/0020_add_notifications.sql` | Use `CREATE TABLE IF NOT EXISTS notifications` instead of `CREATE TABLE notifications`. |

No new migration file is required; only the above two edits.

---

## 5. Verification after changes

- Run migrations against a **fresh** D1 DB (local or remote) and confirm no errors.
- Optionally run again (idempotent re-run) and confirm no “already exists” or “duplicate column” errors.
- Confirm `form_submissions` has column `answers_json` and `notifications` exists.
