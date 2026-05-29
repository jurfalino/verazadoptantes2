---
name: Cloudflare Pages — production branch must match --branch flag
description: When deploying via wrangler pages deploy, --branch must match the project's production-branch setting or the deploy aliases as Preview, never as Production. The two contract-app projects use different production branches.
type: project
originSessionId: ca293daf-bb1a-4040-a0c6-2403065d470b
---
`wrangler pages deploy <dir> --project-name=<name> --branch=<X>` produces a **Preview** deployment unless `<X>` exactly matches the project's `production_branch` setting. Preview deployments get a unique `*-<hash>.pages.dev` URL but **never alias to the canonical `<project>.pages.dev`**.

The two contract-app projects on this account use *different* production branches and you cannot tell from the project name alone:

| Project | Production branch | Origin |
|---|---|---|
| `adoptions` | `master` | inherited from Cloudflare's git auto-deploy era |
| `adoptions-staging` | `production` | set explicitly via `wrangler pages project create --production-branch=production` |

`.github/workflows/contract-app.yml` reflects this with a conditional `--branch=${{ env.IS_PROD == 'true' && 'master' || 'production' }}`. **Don't "simplify" it to a single value.**

**Why:** the GH Actions deploy succeeded silently for hours, reporting `Deploy to Cloudflare Pages` as green, but `adoptions.pages.dev` continued serving an old build because every deploy was filed as `Environment: Preview`. The bug only became visible when grepping the live bundle for the baked-in API URL.

**How to apply:**
- When adding a new Pages project, set `--production-branch` explicitly at creation time. Pick one convention and stick to it — but you can't retroactively change it on existing projects without delete + recreate (which loses the existing `*.pages.dev` subdomain).
- Verify deploys with `npx wrangler pages deployment list --project-name=<name> --environment=production`. If the latest row isn't there, your deploy landed as Preview.
- When debugging "I deployed but the site didn't change", grep the live bundle (`curl -s <url> | grep -oE 'src="[^"]+\.js"'` then fetch that JS file) — the bundle hash tells you whether your build is actually live.
