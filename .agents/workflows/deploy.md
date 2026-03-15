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
| `feature/*` | `<hash>.verazadoptantes2.pages.dev` | ❌ |

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

2. Run lint warning ratchet check (current threshold: **68 warnings**):
// turbo
```
npx next lint 2>&1 | Select-String "Warning:" | Measure-Object | Select-Object -ExpandProperty Count
```
Compare the count against the threshold of **107**. If the count is **higher than 107**, STOP and tell the user:
> "⚠️ Lint warnings increased from 68 to [N]. You should fix the new warnings before deploying, or acknowledge the increase."
Wait for user acknowledgment before proceeding. If the user acknowledges, update the threshold in this workflow file to match the new count.
If the count is **equal or lower**, proceed silently.

3. Stage all changes:
```
git add -A
```

4. Review what's being committed:
// turbo
```
git diff --cached --stat
```

5. Commit with version-prefixed message (version is MANDATORY in the commit message):
```
git commit -m "v<version>: <description>"
```
> Example: `git commit -m "v2.9.3: fix empty alt tags on adopter thumbnails"`

6. **Push to STAGING only — NEVER to master:**
```
git push origin HEAD:staging
```

7. **STOP. Tell the user to verify on staging:**
```
Staging URL: https://staging.verazadoptantes2.pages.dev
```
Wait for the Cloudflare build to complete (~2-3 min). CI checks (build, tsc, lint) must pass.
Ask the user to verify the changes on the staging URL.

8. **WAIT FOR EXPLICIT MASTER PUSH APPROVAL.**
> ⚠️ The user MUST say one of these exact phrases before you push to master:
> - "push to master"
> - "merge to master"
> - "deploy to production"
> - "looks good, push it"
>
> Asking to "tag a version", "looks good on staging", or any other phrasing does NOT count as approval.
> **NEVER infer push-to-master approval. When in doubt, ASK.**

```
git push origin staging:master
```

9. If tagging a version, tag AFTER the staging-to-master push:
```
git tag -a v<version> -m "<message>"
git push origin v<version>
```

10. Update CHANGELOG.md with release notes BEFORE committing (step 5):
   - Add a new `## [version] - YYYY-MM-DD` section at the top
   - Group changes under `### Added`, `### Changed`, `### Fixed`, `### Removed` as appropriate



## 🗃️ Database Migrations

> **🚨 MANDATORY: After ANY change to `src/db/schema.ts`, run `/schema-sync` to verify the local D1 database matches.**
> Failing to do this will cause silent query failures locally (server actions return `null` instead of data).

If schema changes were made (drizzle/ folder has new files), migrations auto-apply via CI on push to staging/master.

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

### Option 1: Cloudflare Dashboard (Fastest)
1. Go to Cloudflare Dashboard → Pages → Deployments
2. Find last working deployment
3. Click "Rollback to this deployment"

### Option 2: Git Revert
```bash
git checkout master
git pull
git revert HEAD
git push origin master
```

## ⛔ Forbidden Commands
These commands must NEVER be run without explicit user approval:
- `git push origin master`
- `git push origin HEAD:master`
- Any push that targets the `master` branch directly
- Running `git push origin staging:master` without user confirmation that staging looks good
