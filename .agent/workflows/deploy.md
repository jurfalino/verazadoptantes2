---
description: How to commit, tag, and deploy changes. MUST be followed for ANY git push.
---

# Deployment Workflow

> **🚨 GOLDEN RULE: NEVER push directly to `master`. All changes go through staging first.**

## Environment URLs

| Branch | URL | OAuth? |
|--------|-----|--------|
| `master` | `buenadoptante.org` | ✅ |
| `staging` | `staging.verazadoptantes2.pages.dev` | ✅ |
| `feature/*` | `<hash>.verazadoptantes2.pages.dev` | ❌ |

## Steps

1. Run TypeScript type check to verify zero errors:
// turbo
```
npx tsc --noEmit
```
If errors exist, fix them before proceeding.

2. Stage all changes:
```
git add -A
```

3. Review what's being committed:
// turbo
```
git diff --cached --stat
```

4. Commit with a descriptive message:
```
git commit -m "<message>"
```

5. **Push to STAGING only — NEVER to master:**
```
git push origin HEAD:staging
```

6. **STOP. Tell the user to verify on staging:**
```
Staging URL: https://staging.verazadoptantes2.pages.dev
```
Wait for the Cloudflare build to complete (~2-3 min). CI checks (build, tsc, lint) must pass.
Ask the user to verify the changes on the staging URL.

7. **WAIT FOR EXPLICIT MASTER PUSH APPROVAL.**
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

8. If tagging a version, tag AFTER the staging-to-master push:
```
git tag -a v<version> -m "<message>"
git push origin v<version>
```

9. Update version in package.json BEFORE committing (step 4):
```
npm version <version> --no-git-tag-version
```

## 🗃️ Database Migrations

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
