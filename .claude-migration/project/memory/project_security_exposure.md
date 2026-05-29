---
name: project-security-exposure
description: "BuenAdoptante runtime exposure to Next.js advisories — which ones are reachable on this app's surface vs. theoretical"
metadata: 
  node_type: memory
  type: project
  originSessionId: ca293daf-bb1a-4040-a0c6-2403065d470b
---

When triaging Next.js security advisories on this project, two classes are reachable on the actual app surface (not theoretical):

1. **Middleware Authorization Bypass advisories** (e.g. GHSA-f82v-jwr5-mffw, GHSA-36qx-fr4f-26g5). `src/middleware.ts` gates `/my-animals`, `/my-adopters`, `/my-adoptions`, `/settings`, `/admin`. Any advisory that affects Next middleware auth or matcher behavior hits this surface directly.
2. **React Server Component advisories** (e.g. GHSA-9qr9-h5gf-34mp RCE, GHSA-mwv6-3258-q52c DoS). The app uses Server Components throughout (App Router); page.tsx-level RSC vulns are reachable.

Image Optimization advisories are also relevant — the homepage and adopter profile pages use `<Image>` extensively.

**Why:** when Dependabot raises 20+ next advisories at once, the instinct is to treat them as background noise. For this app they're not — the middleware and RSC surfaces are exactly where advisories tend to cluster.

**How to apply:** when reviewing Dependabot alerts, scan for `Middleware`, `Server Components`, or `Image` in the advisory title — those are always high-priority for BuenAdoptante regardless of CVSS score.

Related: [[project-buildtime-vs-runtime-deps]]
