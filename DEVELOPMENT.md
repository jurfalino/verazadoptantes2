# Development & Deployment Workflow

This document explains how to safely make changes without breaking production.

## 🔒 The Golden Rule

**Never push directly to `main`.** Always use feature branches and pull requests.

---

## 📋 Development Workflow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Feature Branch │ ──▶ │  Pull Request   │ ──▶ │   main branch   │
│  (your work)    │     │  (review + CI)  │     │  (production)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
   Preview URL            CI Checks Run           Cloudflare Deploys
   (auto-created)         (must pass)             (to production)
```

### Step-by-Step

1. **Create a feature branch**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes and commit**
   ```bash
   git add .
   git commit -m "Add new feature"
   git push origin feature/my-new-feature
   ```

3. **Open a Pull Request on GitHub**
   - Go to your repo on GitHub
   - Click "Compare & pull request"
   - Add a description of your changes

4. **Wait for CI checks to pass**
   - Build ✓
   - Lint ✓
   - Type-check ✓
   - (Playwright tests if applicable)

5. **Test the Preview URL**
   - Cloudflare automatically creates a preview at `<commit-hash>.your-project.pages.dev`
   - Test your changes there before merging

6. **Merge to main**
   - Only after all checks pass and you've tested the preview
   - This triggers the production deployment

---

## 🚨 Emergency: Something Broke Production

### Option 1: Rollback in Cloudflare Dashboard (Fastest)
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to Pages → Your Project → Deployments
3. Find the last working deployment
4. Click the three dots → "Rollback to this deployment"

### Option 2: Revert the Git Commit
```bash
git checkout main
git pull
git revert HEAD   # Creates a new commit that undoes the last one
git push origin main
```

---

## 🛡️ What the CI Workflow Checks

| Check | What it catches |
|-------|-----------------|
| `npm run build` | Compilation errors, missing imports |
| `npx tsc --noEmit` | TypeScript type errors |
| `npm run lint` | Code style issues, potential bugs |

If any of these fail, the PR cannot be merged (if branch protection is enabled).

---

## 🔧 Setting Up Branch Protection (Recommended)

On GitHub:
1. Go to Settings → Branches → Add rule
2. Branch name pattern: `main`
3. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass before merging
     - Select: `Build & Lint`
   - ✅ Require branches to be up to date before merging
4. Save changes

This prevents anyone (including you) from pushing directly to `main`.

---

## 📁 Files Created

- `.github/workflows/ci.yml` - The CI workflow
- `DEVELOPMENT.md` - This file
