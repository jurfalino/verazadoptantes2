---
description: How to commit, tag, and deploy changes. MUST be followed for ANY git push.
---

# Deployment Workflow

> **🚨 GOLDEN RULE: NEVER push directly to `master`. All changes go through staging first.**

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
Wait for the Cloudflare build to complete (~2-3 min), then ask the user to verify.

7. **Only after user confirms staging is good**, merge staging to master:
```
git push origin staging:master
```

8. If tagging a version, tag AFTER the staging-to-master push:
```
git tag -a v<version> -m "<message>"
git push origin v<version>
```

## ⛔ Forbidden Commands
These commands must NEVER be run without explicit user approval:
- `git push origin master`
- `git push origin HEAD:master`
- Any push that targets the `master` branch directly
