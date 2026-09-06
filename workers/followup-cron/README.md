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
