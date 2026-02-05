# Development & Deployment Workflow

This document explains how to safely make changes without breaking production.

## 🔒 The Golden Rule

**Never push directly to `master`.** Always use feature branches → staging → master.

---

## 📋 Development Workflow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Feature Branch │ ──▶ │     staging     │ ──▶ │     master      │
│  (your work)    │     │ (test with OAuth)│    │  (production)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
   Preview URL            Fixed URL:               Production:
   (random hash)     staging.verazadoptantes2    buenadoptante.org
                          .pages.dev
```

### Step-by-Step

1. **Create a feature branch**
   ```bash
   git checkout master
   git pull origin master
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes and commit**
   ```bash
   git add .
   git commit -m "Add new feature"
   git push origin feature/my-new-feature
   ```

3. **Merge to staging for testing**
   ```bash
   git checkout staging
   git pull origin staging
   git merge feature/my-new-feature
   git push origin staging
   ```

4. **Test on staging URL** (with full OAuth support):
   ```
   https://staging.verazadoptantes2.pages.dev
   ```

5. **Open a PR from staging → master**
   - Wait for CI checks to pass
   - Merge to deploy to production

---

## 🌐 Environment URLs

| Branch | URL | OAuth Works? |
|--------|-----|--------------|
| `master` | `buenadoptante.org` | ✅ Yes |
| `staging` | `staging.verazadoptantes2.pages.dev` | ✅ Yes |
| `feature/*` | `<hash>.verazadoptantes2.pages.dev` | ❌ No |

---

## 🔧 Required Configuration

### Google Cloud Console
Add these **Authorized redirect URIs**:
```
https://buenadoptante.org/api/auth/callback/google
https://staging.verazadoptantes2.pages.dev/api/auth/callback/google
```

### Cloudflare Dashboard (Environment Variables)
| Variable | Production | Preview (staging) |
|----------|------------|-------------------|
| `AUTH_URL` | `https://buenadoptante.org` | `https://staging.verazadoptantes2.pages.dev` |
| `AUTH_SECRET` | (your secret) | (same as production) |

---

## 🚨 Emergency: Something Broke Production

### Option 1: Rollback in Cloudflare Dashboard (Fastest)
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to Pages → Your Project → Deployments
3. Find the last working deployment
4. Click "Rollback to this deployment"

### Option 2: Revert the Git Commit
```bash
git checkout master
git pull
git revert HEAD
git push origin master
```

---

## 🛡️ What CI Checks

| Check | What it catches |
|-------|-----------------|
| `npm run build` | Compilation errors, missing imports |
| `npx tsc --noEmit` | TypeScript type errors |
| `npm run lint` | Code style issues, potential bugs |
