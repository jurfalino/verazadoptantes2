# followup-cron

Daily reminder Worker for the follow-up feature (animal-timeline PR4). Cloudflare
**Pages has no cron**, so this standalone Worker runs `0 12 * * *` UTC (09:00 AR)
on the app's D1 and inserts `follow_up_due` rows into `notifications`.

- **Shares the pure domain**: imports `src/domain/followups.ts` by relative path.
  Never import anything from `src/app`, `src/db` or `'use server'` files here.
- **Gates**: bails unless `app_config.ENABLE_FOLLOWUPS = 'true'`, and honors the
  admin kill switch `NOTIF_ENABLED_follow_up_due = 'false'`.
- **Dedup**: only `due` slots (never `missed` — the window is the anti-storm
  guard), plus a per-(placement, slot) `dedupKey` in `notifications.metadata`
  checked before every insert. A slot notifies at most once, ever.
- **Deploy**: `.github/workflows/followup-worker.yml` on pushes touching this
  directory or the shared domain files. Staging deploys `--env staging`
  (`buenadoptante-followup-cron-staging` → `pet-adoption-db-staging`).

## Rollout / test runbook

1. Deploy staging (push to `staging` or workflow_dispatch → staging).
2. Ensure the flag: `npx wrangler d1 execute pet-adoption-db-staging --remote
   --command "INSERT OR REPLACE INTO app_config (key, value) VALUES ('ENABLE_FOLLOWUPS','true');"`
3. Trigger a test run locally against the STAGING db:
   `cd workers/followup-cron && npx wrangler dev --env staging --remote --test-scheduled`
   then `curl "http://localhost:8787/__scheduled?cron=0+12+*+*+*"`.
4. Check the run summary in the wrangler output (`{"op":"followup-cron",...}`)
   and the bell on staging (owner account of a due placement).
5. Run it AGAIN and verify `notified: 0, deduped: N` — the dedup must hold.
6. Only then merge to master (deploys the production Worker).

Manual deploy (if CI is down):
`npx wrangler deploy --config workers/followup-cron/wrangler.toml [--env staging]`

## Email delivery (v2.55.19, opt-in)

When a recipient has «Recibir recordatorios también por e-mail» enabled in
Configuración → Seguimientos (`followup_settings.emailReminders`), the Worker
also emails them. Bells stay per-slot (each is individually actionable); email
is **digested**: one message per recipient per run, listing every reminder that
fired. Items are queued only for slots that actually inserted a notification, so
the digest inherits the same once-ever (placement, slot, recipient) dedup, and a
send failure never blocks the bell.

`buildFollowupEmail` is ONE template that adapts to the count — a single item
renders the per-animal message with a button to that animal; several render a
list with per-row links and a button to /my-animals. Capped at
`EMAIL_DIGEST_MAX_ITEMS` with a "…y N más" line. Covered by
`src/lib/followupEmailCopy.test.ts` (the worker dir isn't in vitest's scope).

Config resolution (same convention as the email-OTP feature): env first, then
`app_config` rows — `RESEND_API_KEY` (required for sends; absent → emails are
silently skipped, bell only) and `EMAIL_FROM` (default
`noreply@buenadoptante.org`, requires the domain verified in Resend).
`APP_BASE_URL` in wrangler `[vars]` builds the email's deep link per env.
