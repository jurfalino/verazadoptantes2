---
description: How to commit, tag, and deploy changes. MUST be followed for ANY git push.
---

# Deployment Workflow

> **🚨 GOLDEN RULE: NEVER push directly to `master`. All changes go through staging first.**

> **🚨 GOLDEN RULE: When checking deployed versions, ALWAYS use `remotes/origin/*` branches, NEVER local branches.**
> Local branches can be stale. What's deployed is what's on the remote.
> ```
> git log remotes/origin/staging --oneline -1   # ← Staging version
> git log remotes/origin/master --oneline -1    # ← Production version
> ```
> Run `git fetch origin` first if unsure whether remote refs are current.

## Environment URLs

| Branch | URL | OAuth? |
|--------|-----|--------|
| `master` | `buenadoptante.org` | ✅ |
| `staging` | `staging.verazadoptantes2.pages.dev` | ✅ |
| `feature/*` | not deployed (no auto-deploy on feature branches) | n/a |

## How Deploys Happen

> **🚨 Cloudflare's git auto-deploy is OFF.** Pushing to a branch does NOT trigger a Cloudflare-side build.
> All deploys run via the GitHub Actions pipeline (`.github/workflows/ci.yml`), which calls
> `wrangler pages deploy` after every prerequisite job passes.

Pipeline jobs on push to `staging` or `master`:

```
build-and-lint  →  migrate-{staging|production}  →  e2e (Playwright)  →  deploy-{staging|production}
```

- **`build-and-lint`** must pass (tsc, lint, `npm run build`).
- **`migrate-*`** applies D1 migrations via wrangler.
- **`e2e`** runs the full Playwright suite. **It is a blocking dependency for the deploy job** — failing tests will prevent the deploy. (The comment in the YAML claims tests are "non-blocking", but `deploy-staging`/`deploy-production` both list `e2e` in `needs:`, so it gates the deploy.)
- **`deploy-*`** runs `npx @cloudflare/next-on-pages` then `npx wrangler pages deploy ... --branch="<staging|master>"`.

End-to-end pipeline takes **~8–15 minutes**. Watch progress at:
- `gh run list --branch <staging|master> --limit 3`
- `gh run watch <run-id>`
- Or the GitHub Actions tab on the repo.

> ⚠️ **Feature branches are never deployed.** No CI job is gated on `feature/*` pushes — the pipeline only runs on `staging`/`master`. To preview a feature branch, merge it into `staging` first.

## Version Increment (MANDATORY — Semantic Versioning)

> **🚨 Every deployment MUST increment the version. No exceptions.**

| Change Type | Who can authorize | Version Part | Example |
|-------------|-------------------|-------------|--------|
| Bugfixes, small tweaks, config | Agent (autonomous) | **Build** (`x.y.z-BUILD`) | `2.9.2` → `2.9.2-1` → `2.9.2-2` |
| Small improvements, new small features | Agent (autonomous) | **Patch** (`x.y.Z`) | `2.9.2` → `2.9.3` |
| Significant features, breaking changes | **USER ONLY** | **Minor** (`x.Y.0`) | `2.9.3` → `2.10.0` |
| Major rewrites, breaking API changes | **USER ONLY** | **Major** (`X.0.0`) | `2.10.0` → `3.0.0` |

> ⚠️ **NEVER bump minor or major version without explicit user authorization.**
> When in doubt, use **patch** for improvements or **build suffix** for fixes.

Run this BEFORE committing (step 4):
```
npm version <version> --no-git-tag-version
```

## Steps

1. Run TypeScript type check to verify zero errors:
// turbo
```
npx tsc --noEmit
```
If errors exist, fix them before proceeding.

2. Run lint warning ratchet check (current threshold: **123 warnings**):
// turbo
```
npx next lint 2>&1 | Select-String "Warning:" | Measure-Object | Select-Object -ExpandProperty Count
```
Compare the count against the threshold of **122**. If the count is **higher than 123**, STOP and tell the user:
> "⚠️ Lint warnings increased from 122 to [N]. You should fix the new warnings before deploying, or acknowledge the increase."
Wait for user acknowledgment before proceeding. If the user acknowledges, update the threshold in this workflow file to match the new count.
If the count is **equal or lower**, proceed silently.

3. **Update CHANGELOG.md** (MANDATORY — do NOT skip):
   - Add a new `## [version] - YYYY-MM-DD` section at the top of `CHANGELOG.md`
   - Group changes under `### Added`, `### Changed`, `### Fixed`, `### Removed` as appropriate
   - Every tagged version MUST have a corresponding changelog entry
   > ⚠️ This step exists here — before staging — so it is included in the commit. It was previously step 10 (after tagging) and was systematically skipped, leaving ~22 releases undocumented.

4. Stage all changes:
```
git add -A
```

5. Review what's being committed:
// turbo
```
git diff --cached --stat
```
> 🔍 **Checkpoint:** Verify that `CHANGELOG.md` appears in the diff. If it does not, STOP — go back to step 3.

6. Commit with version-prefixed message (version is MANDATORY in the commit message):
```
git commit -m "v<version>: <description>"
```
> Example: `git commit -m "v2.9.3: fix empty alt tags on adopter thumbnails"`

7. **Push to STAGING only — NEVER to master:**
```
git push origin HEAD:staging
```

8. **STOP. Tell the user the deploy is in flight:**
```
Staging URL: https://staging.verazadoptantes2.pages.dev
GitHub Actions run: https://github.com/jurfalino/verazadoptantes2/actions
```
The full pipeline (build-and-lint → migrate-staging → e2e → deploy-staging) takes **~8–15 min**. The new build only goes live after `deploy-staging` finishes — not when the push lands on the branch. Check progress with:
```
gh run list --branch staging --limit 3
gh run watch <run-id>   # to follow live
```
> ⚠️ If the pipeline fails (any of build, lint, migrations, e2e, deploy), **the staging URL still serves the previous build** — there is no Cloudflare-side fallback deploy. Investigate the failed job logs in GitHub Actions, fix, and push again.

Ask the user to verify the changes on the staging URL once the deploy job is green.

9. **WAIT FOR EXPLICIT PRODUCTION DEPLOYMENT APPROVAL.**
> ⚠️ The user MUST say one of these exact phrases before you push to master:
> - "push to master"
> - "merge to master"
> - "deploy to production"
> - "looks good, push it"
>
> Asking to "tag a version", "looks good on staging", or any other phrasing does NOT count as approval.
> **NEVER infer push-to-master approval. When in doubt, ASK.**

Create a Pull Request from `staging` to `master` using the GitHub CLI:
// turbo
```
gh pr create --base master --head staging --title "chore: release v<version>" --body "Deploying v<version> to production."
```
> If `gh` CLI fails (e.g. due to authentication), provide the user with the direct URL to open the PR themselves:
> `https://github.com/jurfalino/verazadoptantes2/pull/new/staging`

10. Wait for the PR to be merged by the user. If tagging a version, tag AFTER the staging-to-master merge:
```
git tag -a v<version> -m "<message>"
git push origin v<version>
```



## 🗃️ Database Migrations

> **🚨 MANDATORY: After ANY change to `src/db/schema.ts`, run `/schema-sync` to verify the local D1 database matches.**
> Failing to do this will cause silent query failures locally (server actions return `null` instead of data).

If schema changes were made (drizzle/ folder has new files), migrations auto-apply via the GitHub Actions `migrate-staging` / `migrate-production` jobs on push. These jobs run BEFORE `deploy-*`, so a migration failure aborts the deploy.

### Manual Migration (if CI fails)
```bash
# Staging
npx wrangler d1 migrations apply pet-adoption-db-staging --remote

# Production
npx wrangler d1 migrations apply pet-adoption-db --remote
```

### Verify Migration Status
```bash
npx wrangler d1 execute pet-adoption-db --remote --command "SELECT name FROM d1_migrations ORDER BY name;"
```

## 🚨 Emergency Rollback

### Option 1: Cloudflare Dashboard (Fastest, no pipeline run)
Cloudflare keeps every deploy that the pipeline ever pushed, regardless of where it came from.
1. Cloudflare Dashboard → Pages → `verazadoptantes2` → Deployments
2. Find the last known-good deployment for the branch
3. Click "Rollback to this deployment"
> This bypasses GitHub Actions entirely — instant.

### Option 2: Git Revert (re-runs the full pipeline)
```bash
git checkout master
git pull
git revert HEAD
git push origin master   # ← only via PR, see Forbidden Commands
```
This kicks off the full ~10–15 min pipeline. Only use when you also want CI/migrations to run on the rollback (e.g. the bad commit added a migration that needs reverting too).

## ⛔ Forbidden Commands
These commands must NEVER be run without explicit user approval:
- `git push origin master`
- `git push origin HEAD:master`
- Any push that targets the `master` branch directly
- Running `git push origin staging:master` (This is completely forbidden now, always use a PR to merge staging to master)
