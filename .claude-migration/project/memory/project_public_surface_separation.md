---
name: Public surface must live on its own domain, separate from BuenAdoptante
description: Showcase, form, and contract URLs must all share one domain, and that domain must NOT be buenadoptante.org. Drives the contract-app architecture.
type: project
originSessionId: ca293daf-bb1a-4040-a0c6-2403065d470b
---
All three public-facing flows — showcase (catalog/animal/org/user pages), adoption form, and contract signing — must be served from a **single domain** that is **different from buenadoptante.org** (the rescuer dashboard).

Today this is implemented by the Vite contract-app deployed to `adoptions.pages.dev` (Cloudflare Pages project `contrato`), with the Next app on `buenadoptante.org` providing only the rescuer/admin surface plus the APIs that the public app calls cross-origin.

**Why:** the adopter-facing funnel must be isolated from the rescuer dashboard's blast radius (auth incidents, middleware changes, dashboard deploys cannot break the conversion surface). Keeping all three public flows on the same domain matters for trust, link sharing, QR codes already printed, and a single SEO surface.

**How to apply:** never propose merging the public surface into the main Next app at `buenadoptante.org`. Never propose splitting showcase to one domain and form/contract to another — they go together. When evaluating migrations (e.g. Vite → Next), the target must be a standalone deploy on its own domain, not a merger.
