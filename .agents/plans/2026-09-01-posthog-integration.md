# PostHog integration: session replay + product analytics alongside Clarity and Amplitude

**Status:** Design approved 2026-09-01. Not yet implemented. Flag: `ENABLE_POSTHOG` (admin-UI toggled, defaults off).
**Author:** drafted 2026-09-01 (interactive design session).
**Target version:** `2.49.0` — minor, per [[feedback_patch_not_minor_for_small]]: a new cross-cutting vendor is a significant feature, not polish.
**Related:** [[reference_clarity_input_masking]], [[project_clarity_via_zaraz]], [[project_buildtime_envvars]], `src/components/ClarityScript.tsx`, `src/lib/zaraz.ts`, `src/app/layout.tsx`.

---

## 1. Context & problem

The trigger: **you cannot see what users typed into the search box in a Clarity session recording.** That is not a misconfiguration. Per [Clarity's masking docs](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking) — *"Content in the input boxes is masked in all modes and can't be customized."* Neither `Relaxed` masking mode nor `data-clarity-unmask="true"` on the field changes it; input text is never uploaded. See [[reference_clarity_input_masking]].

v2.48.3 worked around this with a Clarity custom tag (`clarity('set', 'search_query', …)`). It works, but the term lands in the session metadata panel rather than inside the replay, and it required an explicit decision to send adopter PII to Microsoft. **That change is reverted as part of this work** — PostHog records the input natively, so the workaround has no remaining purpose.

Today's telemetry stack:

| Tool | Loaded by | Purpose |
|---|---|---|
| Microsoft Clarity | Cloudflare Zaraz (never app code — see [[project_clarity_via_zaraz]]) | Session replay, heatmaps |
| Amplitude | Cloudflare Zaraz | 12 distinct `zarazTrack` events across 9 components |
| Axiom | `src/lib/logger.ts` | Server logs, including raw search queries at `findAdopters.ts:1189` |

## 2. Goals / non-goals

**Goals**
- Session replay in which the search input's typed text is readable.
- Product analytics (funnels, retention) in the same tool, correlated with replays by person.
- No CSP changes, no adblock blind spot, no LCP regression.
- Killable from the Admin UI without a deploy.

**Non-goals (this change)**
- Migrating the 12 Amplitude events. They stay on `zarazTrack` untouched.
- Removing Clarity. It keeps running in parallel (see §5 open question).
- Touching `contract-app` (separate Vite app, own deploy pipeline) or the public showcase domain ([[project_public_surface_separation]]).
- Any privacy-policy edit (see §5, decision D1).

## 3. Design

### 3.1 Loading and the feature flag

`posthog-js` as an npm dependency in app code. **Cloudflare Zaraz cannot be used**: its PostHog managed component is server-side event forwarding only and [cannot do session replay](https://posthog.com/questions/use-cloudflare-zaraz), which is a client-side rrweb capability. So unlike Clarity and Amplitude, PostHog does *not* follow the Zaraz house pattern — this is a deliberate, forced exception and should be commented as such at the call site.

`layout.tsx` is already an async server component that resolves a DB-backed flag server-side:

```tsx
// src/app/layout.tsx:100 — existing precedent
chatEnabled = await getFeatureFlag('ENABLE_CHAT_WIDGET');
```

`ENABLE_POSTHOG` mirrors it exactly, and the flag value plus the project key are passed as **props** into a client `<PostHogProvider>`.

Two traps this avoids, both already learned the hard way in this repo:
- **No client-side `/api/config` fetch.** `HomeClient.tsx:27` records that exactly this pattern cost ~2s of LCP on the homepage and was removed. Reading the flag server-side in the layout keeps that win.
- **No `NEXT_PUBLIC_*` key.** Those are inlined at build time and Cloudflare runtime vars never reach them — the problem `src/lib/contractUrl.ts` exists to work around ([[project_buildtime_envvars]]). Passing the key down from the server sidesteps it entirely.

PostHog project API keys are public by design (write-only, meant to ship in client bundles), so there is no secret to protect here — but it still gets read server-side rather than inlined, for the per-environment reason above.

### 3.2 Reverse proxy — same-origin `/ingest/*`

`posthog.init(key, { api_host: '/ingest' })`, with `/ingest/*` forwarding to `us.i.posthog.com` and `us-assets.i.posthog.com` (US region — decision D3).

Same-origin is the load-bearing property:
- **Zero CSP changes.** `next.config.ts:49-61` enforces a per-host `connect-src` allowlist. A same-origin path is covered by `'self'`. A subdomain (`ph.buenadoptante.org`, PostHog's own recipe) would *not* be, and would need both a CSP entry and a DNS record.
- **Adblock resistance.** This matters more than usual because of decision D2: Clarity runs through Zaraz same-origin and is not blocked. A directly-connected PostHog would lose the parallel comparison on a technicality rather than on merit. Per PostHog's guidance, avoid obvious path names — `/ingest` is chosen over `/analytics` or `/tracking`.

**V1 — RESOLVED 2026-09-01: use a Route Handler, not a Next.js rewrite.**

Two findings ruled the rewrite out:
1. `cloudflare/next-on-pages` was **archived in September 2025** — read-only and unmaintained. CI runs it at `.github/workflows/ci.yml:191` (v1.13.16). Cloudflare's current Next.js path is the OpenNext adapter. *Standing risk, out of scope here, but it should not be news later.*
2. External-destination rewrites on that adapter [silently dropped query parameters](https://github.com/cloudflare/next-on-pages/issues/429). Fixed long before v1.13.16, but the failure mode — ingestion breaks while looking like "no data arrived" — is unacceptable to build on top of an unmaintained adapter that can't be verified without deploying.

The proxy is therefore `src/app/ingest/[...path]/route.ts` (edge runtime): same-origin, zero CSP change, deploys with the app, no new infra, no dependency on rewrite semantics, and consistent with the many edge route handlers already in `src/app/api/`.

**Accepted cost (decision D4a):** every replay batch becomes a Pages Function invocation. Session replay POSTs roughly every 5s per active tab — on the order of 60–80 requests per 5-minute session, so ~14k/day at ~200 sessions/day. That fits inside the Pages free limit (100k/day) and far inside the paid Workers limit (10M/month), but it is real and scales with traffic. It also means the honest answer to "does this add Cloudflare compute?" is **yes**, unlike the v2.48.3 Clarity tag, which added none.

To keep it testable, URL mapping is a **pure function** in `src/lib/posthogProxy.ts` with vitest coverage; the route handler stays a thin shell around it. This matters because e2e cannot exercise the real proxy without hitting PostHog's network from CI.

### 3.3 Masking — none (decision D1)

```ts
session_recording: {
  maskAllInputs: false,
  // no maskTextSelector — page text records in cleartext
}
```

Search box, adopter creation/edit forms, and profile pages all record in cleartext. `input[type="password"]` stays masked by rrweb unconditionally; the app is Google-OAuth-only, so nothing is lost there.

**Verification debt (V2):** the exact `posthog-js` **web** default for `maskTextSelector`. PostHog's docs confirm `maskAllInputs` defaults to `true`, but the text-masking default could not be confirmed from the docs — the "all text is masked by default" language found in search results belongs to the **mobile** SDKs, not web. Check `posthog-js` source before relying on it. This only affects whether the config is explicit or redundant, not the outcome.

### 3.4 Identity

`posthog.identify(userId, { email, name, role })` driven by the NextAuth session, on the same trigger and with the same field shape as `ClarityScript.tsx:75-78`. During the parallel run this keeps a session attributable in both tools, which is what makes the comparison meaningful.

Reuse the dedupe guard from `ClarityScript` (a `useRef` on the last identified user id) so identify fires once per identity change, not per render.

### 3.5 Autocapture and events

Autocapture **on** — clicks and pageviews with no instrumentation, consistent with D1. The 12 `zarazTrack` events stay on Amplitude untouched; no migration, no dual-send.

### 3.6 Performance

`posthog-js` with session replay is substantially heavier than the Clarity snippet. Given the documented LCP history, init is deferred to after hydration / idle rather than blocking first paint, and the homepage's Lighthouse LCP is measured before and after. **A measurable LCP regression on `/` blocks the change** — the homepage is `runtime = 'edge'` specifically for cold-start speed and that should not be traded away for telemetry.

## 4. Implementation plan (phased, staging-first)

**Phase 0 — RESOLVED.** V1 settled in favour of a Route Handler (see §3.2).

**Phase 1 — Revert v2.48.3.** Remove `tagClaritySearch` and its two call sites from `SearchSection.tsx`; delete `src/lib/clarity.ts`; restore `ClarityScript.tsx` to its own inline poll and `declare global`. Clarity identity sync keeps working exactly as before.

**Phase 2 — Proxy.** `/ingest/*` → PostHog. Verify a request reaches PostHog from staging before any SDK work.

**Phase 3 — Provider.** `posthog-js` dependency, `src/components/PostHogProvider.tsx` (client), flag + key wired from `layout.tsx`. Deferred init. Identity sync.

**Phase 4 — Flag plumbing.** `ENABLE_POSTHOG` in `src/config/features.ts`, defaults, and the Admin → Config toggle list, mirroring `ENABLE_CHAT_WIDGET`. Note: `PUBLIC_FLAG_KEYS` in `/api/config/route.ts` is **not** needed, because the flag is read server-side in the layout and never by a client component — unlike the 5-place case in [[feedback_feature_flag_5_place]].

**Phase 5 — Verify on staging.** Flag on, search a phone number, confirm the replay shows the digits. Lighthouse LCP on `/` before vs after.

## 5. Decisions & open questions

**D1 — Record everything; privacy policy unchanged.** (User, 2026-09-01.)

I flagged that `src/app/privacy/page.tsx:62-63` states *"Los datos no se comercializan, no se utilizan con fines publicitarios ni se comparten con terceros ajenos a la plataforma"*, and that session replay records adopter profile pages — names and contact details as ordinary text, not merely the search box. The user's decision is to record everything and leave the policy as written.

Recorded rationale: *"terceros ajenos a la plataforma"* is defensible as excluding infrastructure processors, which is the same reading that already covers Cloudflare (hosting + D1), Google (OAuth), and Axiom — the last of which already receives raw search queries with adopter PII at `findAdopters.ts:1189`. Session replay differs from those in **degree** (whole rendered pages vs. selected log fields), not in kind. Revisit if the platform ever faces a data-subject access request or an EU/Argentine regulator question.

Also worth noting for the record: with masking off, PostHog receives *more* than Clarity does today. Clarity's Balanced mode masks numbers and email addresses in page text (though **not** names, which already reach Microsoft in cleartext).

**D2 — Run PostHog, Clarity and Amplitude in parallel.** (User, 2026-09-01.) Additive change, lowest risk, nothing lost.

> **OPEN — needs a date.** Three replay/analytics scripts on every page is the standing failure mode of "parallel for now": it persists indefinitely, triples the PII surface, and costs page weight. **Set a cut date for Clarity.** Not blocking implementation; blocking calling this finished.

**D3 — PostHog Cloud US region.** (User, 2026-09-01.) Lowest latency for Argentina/LatAm rescuers, no new jurisdiction beyond the existing US SaaS stack. One-way door: projects cannot be migrated between regions.

**D4 — Same-origin path proxy at `/ingest/*`.** (User, 2026-09-01.) See §3.2.

**D4a — Implemented as a Next.js Route Handler, accepting the Pages Function cost.** (User, 2026-09-01, after V1 was resolved.) The alternatives were a standalone Cloudflare Worker (same compute cost, extra wrangler config and CI step) or a direct connection with CSP entries (zero Cloudflare compute, but adblockers would silently skew the very Clarity-vs-PostHog comparison D2 exists to run). The user accepted the compute cost for the simpler, unskewed option.

**D5 — v2.48.3 is reverted, not shipped.** Its only purpose was working around a Clarity limitation that PostHog does not have.

## 6. Testing

- **Playwright:** with the flag on, `window.posthog` initializes and the `/ingest` endpoint is reachable. Guard against locale-specific selectors ([[feedback_e2e_locale_agnostic_selectors]]).
- **Manual on staging (the real acceptance test):** search a **phone number** — not just a name — and confirm the replay shows real digits. A name-only check proves nothing about the case most likely to be masked.
- **Performance:** Lighthouse LCP on `/`, before vs after. A regression blocks the change.
- **Flag off:** no PostHog network requests, no console errors, no bundle execution.

## 7. Touch list

| File | Change |
|---|---|
| `src/app/layout.tsx` | `ENABLE_POSTHOG` flag read + `<PostHogProvider>` |
| `src/components/PostHogProvider.tsx` | **new** — client init, deferred, identity sync |
| `src/config/features.ts` | flag registration + default |
| `src/app/admin/(admin-only)/config/page.tsx` | admin toggle + i18n label (es/en/pt — **all three**) |
| `src/lib/posthogProxy.ts` | **new** — pure URL mapper (+ vitest) |
| `src/app/ingest/[...path]/route.ts` | **new** — thin edge proxy shell |
| `package.json` | `posthog-js` |
| `src/components/SearchSection.tsx` | **revert** v2.48.3 tagging |
| `src/lib/clarity.ts` | **delete** |
| `src/components/ClarityScript.tsx` | **revert** to inline poll |
| `CHANGELOG.md`, `package.json` | v2.49.0 |

## 8. Rollback

Admin → Config → `ENABLE_POSTHOG` off. No deploy, no migration, nothing to undo — the flag gates the entire provider. Full removal is `npm rm posthog-js` plus deleting the provider and the proxy route.
