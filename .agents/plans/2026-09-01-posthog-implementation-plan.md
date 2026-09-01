# PostHog Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostHog session replay + product analytics to BuenAdoptante behind `ENABLE_POSTHOG`, with the search input readable in replays, running in parallel with Clarity and Amplitude.

**Architecture:** `posthog-js` initialises in a client `PostHogProvider` mounted from the async server `layout.tsx`, which resolves the DB-backed flag and the project key server-side and passes both as props. All PostHog traffic goes through a same-origin `/ingest/*` edge Route Handler that proxies to `us.i.posthog.com`, so the existing CSP needs no changes and adblockers see only first-party requests.

**Tech Stack:** Next.js 15.1.6 (App Router, edge runtime), TypeScript, `posthog-js`, Cloudflare Pages, Drizzle/D1 for the flag, vitest for unit tests, Playwright for e2e.

**Spec:** `.agents/plans/2026-09-01-posthog-integration.md`

## Global Constraints

- **Target version: `2.49.0`.** Bump `package.json` + `CHANGELOG.md` in Task 7. One version for the whole feature — do not bump per task.
- **Branch: `staging`.** Never push to `master`. Deploy is `git push origin HEAD:staging`.
- **Lint ratchet: warnings must not exceed 125.** Check with `npm run lint` (currently 120).
- **`npx tsc --noEmit` must be clean** before every commit.
- **`npm run build` must pass** before pushing — a `'use server'` file may only export async functions, and that failure passes tsc and lint.
- **i18n: `es`, `en` AND `pt`.** All three files in `src/i18n/locales/`. Default locale is `es`; a key missing from `es.ts` renders the raw key path to users.
- **Flag default: `false`.** `ENABLE_POSTHOG` ships off and is turned on from Admin → Config.
- **PostHog region: US.** `us.i.posthog.com` and `us-assets.i.posthog.com`. This is a one-way door.
- **No masking.** `maskAllInputs: false`, no `maskTextSelector`. Per spec decision D1.
- **Do not touch** `contract-app/`, the public showcase domain, Clarity, or the 12 `zarazTrack` call sites.

---

### Task 0: Create the PostHog project (human step)

**This task cannot be done by an agent.** It produces the project key every later task depends on.

- [ ] **Step 1: Create a US-region project**

Sign up at https://us.posthog.com. When creating the project, confirm the region selector reads **US** — projects cannot be migrated between regions later.

- [ ] **Step 2: Copy the project API key**

Project settings → "Project API key". It starts with `phc_`. This key is public by design (write-only, intended to ship in client bundles), so it is not a secret — but it is still read server-side so the value can differ per environment without a rebuild.

- [ ] **Step 3: Set it for local dev**

Add to `.env.local`:

```
POSTHOG_PROJECT_KEY=phc_your_key_here
```

- [ ] **Step 4: Set it on Cloudflare Pages**

Cloudflare Dashboard → Pages → `verazadoptantes2` → Settings → Environment variables. Add `POSTHOG_PROJECT_KEY` to **both** the Preview and Production environments.

Deliberately **not** `NEXT_PUBLIC_POSTHOG_KEY`: `NEXT_PUBLIC_*` vars are inlined at build time and Cloudflare runtime env vars never reach them. This is the problem `src/lib/contractUrl.ts` exists to work around.

---

### Task 1: Revert the v2.48.3 Clarity search tag

**Files:**
- Delete: `src/lib/clarity.ts`
- Restore: `src/components/ClarityScript.tsx`
- Restore: `src/components/SearchSection.tsx`
- Restore: `CHANGELOG.md`, `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean tree at v2.48.2. No `clarityTag`, no `whenClarityReady`, no `tagClaritySearch` anywhere.

**Why:** the tag was a workaround for Clarity's uncustomizable input masking. PostHog records the input natively, so it has no remaining purpose. See spec decision D5.

- [ ] **Step 1: Confirm these four files are uncommitted modifications**

```bash
git status --short src/components/ClarityScript.tsx src/components/SearchSection.tsx CHANGELOG.md package.json package-lock.json src/lib/clarity.ts
```

Expected: `M` on all five tracked files, `??` on `src/lib/clarity.ts`.

`package-lock.json` is in this list because `npm version 2.48.3` touched it and Step 2 checks it out. If it shows anything other than `M` — or if it carries unrelated dependency work — STOP and revert it selectively instead, or that work is silently destroyed.

If any show as committed instead, STOP — the revert becomes a `git revert` of a real commit, not a checkout, and the commands below are wrong.

Leave `.claude/settings.local.json` and `.vscode/settings.json` alone; they are unrelated local changes.

- [ ] **Step 2: Revert**

```bash
git checkout -- src/components/ClarityScript.tsx src/components/SearchSection.tsx CHANGELOG.md package.json package-lock.json
rm src/lib/clarity.ts
```

- [ ] **Step 3: Verify nothing references the deleted module**

```bash
grep -rn "lib/clarity\|clarityTag\|whenClarityReady\|tagClaritySearch" src/
```

Expected: no output.

- [ ] **Step 4: Verify the version is back to 2.48.2**

```bash
node -p "require('./package.json').version"
```

Expected: `2.48.2`

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: No commit**

This task restores committed state, so there is nothing to commit. Move to Task 2.

---

### Task 2: Pure PostHog URL mapper

**Files:**
- Create: `src/lib/posthogProxy.ts`
- Test: `src/lib/posthogProxy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolvePostHogTarget(pathSegments: string[], search: string): string` — returns the absolute PostHog URL a proxied request should be forwarded to. Also exports `POSTHOG_API_HOST` and `POSTHOG_ASSET_HOST` as `string` constants. Task 3 consumes all three.

**Why a separate pure module:** e2e cannot exercise the real proxy without hitting PostHog's network from CI, so the routing logic — which is where the bugs live — gets unit tests instead. Matches the repo's `src/lib/piiAccess.ts` + `piiAccess.test.ts` pattern.

- [ ] **Step 1: Write the failing test**

Create `src/lib/posthogProxy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolvePostHogTarget, POSTHOG_API_HOST, POSTHOG_ASSET_HOST } from './posthogProxy';

describe('resolvePostHogTarget', () => {
    it('routes static asset paths to the assets host', () => {
        expect(resolvePostHogTarget(['static', 'array.js'], '')).toBe(
            `${POSTHOG_ASSET_HOST}/static/array.js`
        );
    });

    it('routes array paths to the assets host', () => {
        expect(resolvePostHogTarget(['array', 'phc_abc', 'config.js'], '')).toBe(
            `${POSTHOG_ASSET_HOST}/array/phc_abc/config.js`
        );
    });

    it('routes everything else to the API host', () => {
        expect(resolvePostHogTarget(['e'], '')).toBe(`${POSTHOG_API_HOST}/e`);
    });

    // Regression guard: next-on-pages issue #429 silently dropped query params
    // on external rewrites, which is why this proxy is a route handler at all.
    it('preserves the query string', () => {
        expect(resolvePostHogTarget(['e'], '?ip=1&ver=1.0')).toBe(
            `${POSTHOG_API_HOST}/e?ip=1&ver=1.0`
        );
    });

    it('preserves the query string on asset paths', () => {
        expect(resolvePostHogTarget(['static', 'recorder.js'], '?v=2')).toBe(
            `${POSTHOG_ASSET_HOST}/static/recorder.js?v=2`
        );
    });

    it('handles an empty path', () => {
        expect(resolvePostHogTarget([], '')).toBe(`${POSTHOG_API_HOST}/`);
    });

    it('does not treat a path merely containing "static" as an asset', () => {
        expect(resolvePostHogTarget(['e', 'static'], '')).toBe(`${POSTHOG_API_HOST}/e/static`);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/posthogProxy.test.ts
```

Expected: FAIL — `Failed to resolve import "./posthogProxy"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/posthogProxy.ts`:

```ts
/**
 * PostHog reverse-proxy URL mapping.
 *
 * All PostHog traffic is proxied same-origin through `/ingest/*` (see
 * `src/app/ingest/[...path]/route.ts`). Same-origin is load-bearing twice
 * over: the CSP in `next.config.ts` allowlists `connect-src` per host, and
 * `'self'` covers a path but would not cover a `ph.` subdomain; and
 * adblockers that would drop a request to `us.i.posthog.com` cannot
 * distinguish `/ingest` from the app's own API.
 *
 * This module is pure so the routing can be unit-tested — CI cannot exercise
 * the real proxy without reaching PostHog over the network.
 *
 * Region is US and is a one-way door: PostHog cannot migrate a project
 * between regions.
 */

export const POSTHOG_API_HOST = 'https://us.i.posthog.com';
export const POSTHOG_ASSET_HOST = 'https://us-assets.i.posthog.com';

/** Path prefixes PostHog serves from its static-asset host rather than the API host. */
const ASSET_PREFIXES = ['static', 'array'];

/**
 * Map a proxied `/ingest/*` request to its absolute PostHog URL.
 *
 * @param pathSegments - the `[...path]` catch-all segments, without `/ingest`
 * @param search - the original query string, including the leading `?` (or empty)
 */
export function resolvePostHogTarget(pathSegments: string[], search: string): string {
    const host = ASSET_PREFIXES.includes(pathSegments[0]) ? POSTHOG_ASSET_HOST : POSTHOG_API_HOST;
    return `${host}/${pathSegments.join('/')}${search}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/posthogProxy.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Type check and lint**

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

Expected: tsc silent; lint `0 errors` and warnings ≤ 125.

- [ ] **Step 6: Commit**

```bash
git add src/lib/posthogProxy.ts src/lib/posthogProxy.test.ts
git commit -m "posthog: pure URL mapper for the /ingest reverse proxy"
```

---

### Task 3: The `/ingest/*` edge Route Handler

**Files:**
- Create: `src/app/ingest/[...path]/route.ts`

**Interfaces:**
- Consumes: `resolvePostHogTarget` from `@/lib/posthogProxy` (Task 2), and `logger` from `@/lib/logger`.
- Produces: live `GET`/`POST`/`OPTIONS` handlers at `/ingest/*`. Task 5 points `posthog.init({ api_host: '/ingest' })` at this.

- [ ] **Step 1: Write the handler**

Create `src/app/ingest/[...path]/route.ts`:

```ts
export const runtime = 'edge';

import { resolvePostHogTarget } from '@/lib/posthogProxy';
import { logger } from '@/lib/logger';

/**
 * Same-origin reverse proxy for PostHog ingestion and assets.
 *
 * Why this exists rather than a Next.js `rewrite`: `@cloudflare/next-on-pages`
 * was archived in September 2025, and external-destination rewrites on it once
 * silently dropped query parameters (cloudflare/next-on-pages#429). Fixed long
 * before our v1.13.16, but "ingestion breaks and looks like no data arrived" is
 * not a failure mode to build on an unmaintained adapter. A route handler owns
 * the forwarding explicitly and is covered by unit tests on the URL mapper.
 *
 * Cost, stated plainly: every session-replay batch is a Pages Function
 * invocation. Roughly 60-80 requests per 5-minute session. Accepted trade for
 * zero CSP changes and adblock resistance (spec decision D4a).
 */

async function proxy(request: Request, pathSegments: string[]): Promise<Response> {
    const search = new URL(request.url).search;
    const target = resolvePostHogTarget(pathSegments, search);

    // Rebuild headers rather than forwarding wholesale: `host` must reflect the
    // PostHog origin (fetch sets it from the URL, so we drop ours), and cookies
    // are first-party to buenadoptante.org and have no business at PostHog.
    const headers = new Headers();
    for (const [key, value] of request.headers) {
        const k = key.toLowerCase();
        if (k === 'host' || k === 'cookie' || k === 'content-length') continue;
        headers.set(key, value);
    }

    // Without this, PostHog geolocates every session to a Cloudflare edge IP,
    // because the proxy is the client as far as it can tell.
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) headers.set('x-forwarded-for', clientIp);

    // Decide once. Reading `request.body` in a condition can mark the stream
    // disturbed on some runtimes, and a body/duplex mismatch is the classic
    // "works in next dev, fails on Workers" bug.
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

    try {
        const upstream = await fetch(target, {
            method: request.method,
            headers,
            body: hasBody ? request.body : undefined,
            // `duplex: 'half'` is required by undici/workers whenever a request
            // body is streamed through, and invalid when there is none.
            ...(hasBody ? { duplex: 'half' } : {}),
        } as RequestInit);

        return new Response(upstream.body, {
            status: upstream.status,
            headers: upstream.headers,
        });
    } catch (e) {
        // Telemetry must never break the page. Log and return 204 so posthog-js
        // treats the batch as delivered rather than retrying in a hot loop.
        logger.warn('posthog proxy: upstream fetch failed', {
            target,
            method: request.method,
            error: e instanceof Error ? e.message : String(e),
        });
        return new Response(null, { status: 204 });
    }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
    return proxy(request, (await ctx.params).path);
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
    return proxy(request, (await ctx.params).path);
}

export async function OPTIONS(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
    return proxy(request, (await ctx.params).path);
}
```

Note: `params` is a Promise in Next 15 — awaiting it is required, not optional.

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no output. If `duplex` errors, the cast on `RequestInit` is what silences it — it is a valid runtime option that the DOM lib types omit.

- [ ] **Step 3: Verify the proxy works locally**

```bash
npm run dev
```

In a second terminal:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:3000/ingest/static/array.js
```

Expected: `200 application/javascript` (or `text/javascript`). A `404` means the catch-all route did not register; a `500` means the fetch failed — check the dev server output for the `posthog proxy` warn line.

- [ ] **Step 4: Verify query parameters survive**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/ingest/e?ip=1&ver=test"
```

Expected: **`400`** from PostHog — it rejects the empty payload. That is the success condition, not a bug: a 400 arriving at all proves the request reached PostHog's API *with* its query string intact, which is precisely the regression ([next-on-pages#429](https://github.com/cloudflare/next-on-pages/issues/429)) that motivated the route-handler approach.

A `500` means the proxy itself threw — check the dev server for the `posthog proxy: upstream fetch failed` line. A `404` means the route did not register.

- [ ] **Step 5: Lint**

```bash
npm run lint 2>&1 | tail -3
```

Expected: `0 errors`, warnings ≤ 125.

- [ ] **Step 6: Commit**

```bash
git add "src/app/ingest/[...path]/route.ts"
git commit -m "posthog: same-origin /ingest reverse proxy (edge route handler)"
```

---

### Task 4: Register the `ENABLE_POSTHOG` flag

**Files:**
- Modify: `src/config/features.ts` (the `FEATURE_FLAGS` object)
- Modify: `src/app/admin/(admin-only)/config/page.tsx` (flag list, defaults, type)
- Modify: `src/i18n/locales/es.ts`, `en.ts`, `pt.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ENABLE_POSTHOG` as a valid `FeatureFlag`, readable via `await getFeatureFlag('ENABLE_POSTHOG')`. Task 6 consumes this.

**Note:** `PUBLIC_FLAG_KEYS` in `src/app/api/config/route.ts` is deliberately **not** touched. That list exists for flags read by *client* components; this flag is read server-side in `layout.tsx` only. `ENABLE_PII_ACCESS_GATING` carries the same "server-side only, deliberately NOT in PUBLIC_FLAG_KEYS" note — follow that precedent.

- [ ] **Step 1: Add the flag with its default**

In `src/config/features.ts`, inside the `FEATURE_FLAGS` object, add:

```ts
    // PostHog session replay + product analytics (v2.49.0). Runs in PARALLEL
    // with Clarity and Amplitude — it replaces neither yet. Unlike those two
    // (loaded by Zaraz), PostHog is an app-code dependency: Zaraz's PostHog
    // component is server-side only and cannot do session replay.
    // Recording is UNMASKED by explicit decision — see the privacy note in
    // .agents/plans/2026-09-01-posthog-integration.md (D1).
    // Default off — server-side only, deliberately NOT in PUBLIC_FLAG_KEYS.
    ENABLE_POSTHOG: false,
```

- [ ] **Step 2: Add the flag to the admin page in all FOUR places**

The page hand-curates its flag list, its type, its defaults, and its hydration mapping. Missing any one makes the admin toggle a silent no-op. In `src/app/admin/(admin-only)/config/page.tsx`, mirroring `ENABLE_CHAT_WIDGET` at lines 33, 69, 98 and 158:

```ts
// ~line 33, in the config type:
        ENABLE_POSTHOG?: string;

// ~line 69, in the rendered flag list:
        { key: 'ENABLE_POSTHOG', labelKey: 'flag_label_posthog', descKey: 'flag_desc_posthog' },

// ~line 98, in the defaults object:
        ENABLE_POSTHOG: false,

// ~line 158, in the fetched-config hydration:
                        ENABLE_POSTHOG: data.config?.ENABLE_POSTHOG === 'true',
```

Verify all four landed:

```bash
grep -c "ENABLE_POSTHOG" "src/app/admin/(admin-only)/config/page.tsx"
```

Expected: `4`

- [ ] **Step 3: Add the i18n label and description**

The keys are `flag_label_posthog` and `flag_desc_posthog`, next to `flag_label_chat_widget` at `src/i18n/locales/es.ts:131`. Add to **all three** locale files:

```ts
// es.ts
        flag_label_posthog: 'PostHog (grabación de sesiones)',
        flag_desc_posthog: 'Graba sesiones y analítica de producto. Corre en paralelo con Clarity, no lo reemplaza. Requiere POSTHOG_PROJECT_KEY configurado en Cloudflare Pages. La grabación NO enmascara lo que se escribe.',

// en.ts
        flag_label_posthog: 'PostHog (session recording)',
        flag_desc_posthog: 'Records sessions and product analytics. Runs in parallel with Clarity, does not replace it. Requires POSTHOG_PROJECT_KEY set in Cloudflare Pages. Recording does NOT mask typed input.',

// pt.ts
        flag_label_posthog: 'PostHog (gravação de sessões)',
        flag_desc_posthog: 'Grava sessões e análise de produto. Roda em paralelo com o Clarity, não o substitui. Requer POSTHOG_PROJECT_KEY configurado no Cloudflare Pages. A gravação NÃO mascara o que é digitado.',
```

A key missing from `es.ts` renders the raw key path to users, because `es` is the default locale. The "does not mask" sentence is deliberate — whoever flips this toggle should know what it turns on.

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 5: Verify the toggle renders**

```bash
npm run dev
```

Visit http://localhost:3000/admin/config as an admin. Expected: a "PostHog" toggle, off, with the Spanish label — **not** a raw key path like `admin.config.enable_posthog`.

- [ ] **Step 6: Commit**

```bash
git add src/config/features.ts "src/app/admin/(admin-only)/config/page.tsx" src/i18n/locales/
git commit -m "posthog: ENABLE_POSTHOG feature flag + admin toggle (es/en/pt)"
```

---

### Task 5: The client PostHog provider

**Files:**
- Modify: `package.json` (add `posthog-js`)
- Create: `src/components/PostHogProvider.tsx`

**Interfaces:**
- Consumes: `/ingest` from Task 3.
- Produces: `export default function PostHogProvider({ enabled, projectKey }: { enabled: boolean; projectKey: string | null }): null`. Task 6 mounts it.

- [ ] **Step 1: Install the dependency**

```bash
npm install posthog-js
```

- [ ] **Step 2: Verify the real masking defaults before writing config**

Spec verification debt V2 — the docs could not confirm the web `maskTextSelector` default, and the "all text masked by default" language found in search results belongs to the mobile SDKs.

```bash
grep -rn "maskTextSelector\|maskAllInputs" node_modules/posthog-js/dist/*.d.ts | head -20
```

Record what you find in the commit message. If `maskAllInputs` does **not** default to `true`, the explicit `false` below is redundant but harmless — keep it for clarity either way.

- [ ] **Step 3: Write the provider**

Create `src/components/PostHogProvider.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';

/**
 * PostHog session replay + product analytics (v2.49.0).
 *
 * Runs in PARALLEL with Clarity and Amplitude — replaces neither yet.
 *
 * Why this is app code and not a Zaraz tool, unlike every other tag on this
 * site: Zaraz's PostHog component forwards events server-side and cannot do
 * session replay, which needs client-side rrweb. This is a forced exception to
 * the house pattern, not a preference.
 *
 * Why props instead of `NEXT_PUBLIC_*`: those are inlined at build time and
 * Cloudflare runtime env vars never reach them (see `src/lib/contractUrl.ts`).
 * `layout.tsx` resolves the flag and key server-side and passes them down, so
 * the value can differ per environment without a rebuild — and the flag costs
 * no client fetch, which matters because a client `/api/config` fetch once cost
 * ~2s of LCP on the homepage (see `HomeClient.tsx`).
 *
 * PRIVACY: recording is deliberately UNMASKED — search terms, adopter forms and
 * profile pages all record in cleartext. User decision, 2026-09-01; rationale in
 * .agents/plans/2026-09-01-posthog-integration.md (D1). `input[type="password"]`
 * is still masked unconditionally by rrweb.
 */
export default function PostHogProvider({
    enabled,
    projectKey,
}: {
    enabled: boolean;
    projectKey: string | null;
}) {
    const { data: session } = useSession();
    const initialized = useRef(false);
    const lastIdentifiedUserId = useRef<string | null>(null);

    useEffect(() => {
        if (!enabled || !projectKey || initialized.current) return;
        if (typeof window === 'undefined') return;

        // Defer past first paint. posthog-js with replay is far heavier than the
        // Clarity snippet, and `/` is `runtime = 'edge'` specifically for cold
        // starts — telemetry must not buy itself LCP.
        const start = () => {
            if (initialized.current) return;
            initialized.current = true;
            posthog.init(projectKey, {
                api_host: '/ingest',
                ui_host: 'https://us.posthog.com',
                autocapture: true,
                capture_pageview: true,
                session_recording: {
                    maskAllInputs: false,
                },
            });
        };

        const w = window as Window & {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        };
        if (typeof w.requestIdleCallback === 'function') {
            w.requestIdleCallback(start, { timeout: 3000 });
        } else {
            // Safari has no requestIdleCallback.
            setTimeout(start, 1500);
        }
    }, [enabled, projectKey]);

    useEffect(() => {
        if (!enabled || !initialized.current) return;

        const userId = (session?.user as { id?: string } | undefined)?.id;
        const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
        const email = session?.user?.email;
        const name = session?.user?.name;

        // Only on actual identity change, not every render — same guard as
        // ClarityScript.
        if (userId === lastIdentifiedUserId.current) return;
        if (!userId) {
            lastIdentifiedUserId.current = null;
            return;
        }
        lastIdentifiedUserId.current = userId;

        posthog.identify(userId, {
            email: email ?? undefined,
            name: name ?? undefined,
            role: isAdmin ? 'admin' : 'viewer',
        });
    }, [session, enabled]);

    return null;
}
```

- [ ] **Step 4: Type check and lint**

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

Expected: tsc silent; `0 errors`, warnings ≤ 125.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/PostHogProvider.tsx
git commit -m "posthog: client provider with deferred init and identity sync"
```

---

### Task 6: Mount the provider from the layout

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `PostHogProvider` (Task 5), `getFeatureFlag` (Task 4), `POSTHOG_PROJECT_KEY` (Task 0).
- Produces: PostHog live on every page when the flag is on.

- [ ] **Step 1: Import the provider**

Add alongside the existing `ClarityScript` import near `src/app/layout.tsx:21`:

```tsx
import PostHogProvider from '@/components/PostHogProvider';
```

- [ ] **Step 2: Resolve the flag server-side**

Directly after the chat-flag block that ends at `src/app/layout.tsx:103`, add the same shape — including the `logger.warn` in the catch, since this repo forbids silently swallowing:

```tsx
  // PostHog session replay + analytics. Same DB → env → default resolution as
  // the chat flag. Falls closed to false: telemetry off is the correct
  // degraded state, and a D1 hiccup must not take down every page render.
  let posthogEnabled = false;
  try {
    posthogEnabled = await getFeatureFlag('ENABLE_POSTHOG');
  } catch (e) {
    logger.warn('Layout posthog-flag lookup failed', { error: e instanceof Error ? e.message : String(e) });
  }
```

`logger` is already imported in `layout.tsx` for the chat-flag catch — no new import needed.

- [ ] **Step 3: Mount it next to ClarityScript**

At `src/app/layout.tsx:144`, directly after `<ClarityScript />`:

```tsx
          <PostHogProvider
            enabled={posthogEnabled}
            projectKey={process.env.POSTHOG_PROJECT_KEY ?? null}
          />
```

Inside `<SessionProvider>` is required — the provider calls `useSession()`.

- [ ] **Step 4: Type check and build**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```

Expected: tsc silent, build completes. The build check is not optional — `layout.tsx` is a server component and build-only failures are a known trap in this repo.

- [ ] **Step 5: Verify it stays off when the flag is off**

```bash
npm run dev
```

Load http://localhost:3000, open DevTools → Network, filter `ingest`. Expected: **no** requests, and `window.posthog` undefined in the console.

- [ ] **Step 6: Verify it turns on**

Set `ENABLE_POSTHOG=true` in `.env.local`, restart dev, reload. Expected: requests to `/ingest/*` appear within ~3s of load, and `window.posthog.__loaded` is `true`.

Then remove the line from `.env.local` — the flag ships off.

- [ ] **Step 7: Commit**

```bash
git add src/app/layout.tsx
git commit -m "posthog: mount provider from layout behind ENABLE_POSTHOG"
```

---

### Task 7: e2e guard, version bump, CHANGELOG

**Files:**
- Create: `tests/posthog.spec.ts`
- Modify: `package.json`, `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: v2.49.0, ready to push to staging.

- [ ] **Step 1: Write the e2e guard**

Create `tests/posthog.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

/**
 * SCOPE — read before trusting this file. This asserts the OFF-state only, and
 * CI gets that state for free: the flag defaults false AND there is no
 * POSTHOG_PROJECT_KEY in CI, so the provider returns early on two independent
 * conditions. This test therefore passes even if the provider is completely
 * broken. Its real value is narrow: it catches a flag inversion, and it catches
 * PostHog loading when it should not.
 *
 * The feature's only genuine test is manual — Task 8 Step 5 on staging, with a
 * real project key and the admin toggle on. Do not read this spec as coverage.
 */
test('does not load PostHog when the flag is off', async ({ page }) => {
    const ingestRequests: string[] = [];
    page.on('request', (r) => {
        if (r.url().includes('/ingest')) ingestRequests.push(r.url());
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // The provider defers init by up to 3s; wait past that window.
    await page.waitForTimeout(4000);

    expect(ingestRequests).toEqual([]);
    const loaded = await page.evaluate(
        () => (window as unknown as { posthog?: { __loaded?: boolean } }).posthog?.__loaded ?? false
    );
    expect(loaded).toBe(false);
});
```

No Spanish or English text selectors here — this spec is locale-agnostic by construction, which sidesteps the recurring locale trap in this repo's e2e suite.

- [ ] **Step 2: Run it**

```bash
npx playwright test tests/posthog.spec.ts --project=unauthed
```

Expected: PASS.

If better-sqlite3 fails to build (Node 26 is known-incompatible in this repo), skip local execution and let CI run it. Note that in the commit message rather than claiming it passed.

- [ ] **Step 3: Bump the version**

```bash
npm version 2.49.0 --no-git-tag-version
```

Minor, not patch: a new cross-cutting vendor is a significant feature.

- [ ] **Step 4: Write the CHANGELOG entry**

Add above the `## [2.48.2]` heading in `CHANGELOG.md`:

```markdown
## [2.49.0] - 2026-09-01

### Added — PostHog session replay + product analytics (behind `ENABLE_POSTHOG`, default off)

Clarity masks the contents of every `<input>` in **all** masking modes and, per its docs, that "can't be customized" — so search terms were unreadable in replays and no Clarity setting could change it. PostHog records them natively.

Runs in **parallel** with Clarity and Amplitude; it replaces neither yet. Unlike both of those, PostHog is an app-code dependency rather than a Zaraz tool — Zaraz's PostHog component is server-side only and cannot do session replay.

All traffic goes through a same-origin `/ingest/*` edge route handler (`src/app/ingest/[...path]/route.ts`) proxying to the US region. Same-origin means zero CSP changes and no adblock blind spot. It is a route handler rather than a Next.js rewrite because `@cloudflare/next-on-pages` was archived in September 2025 and external rewrites on it once silently dropped query parameters — a failure that would look like "no data arrived". The URL mapping is a pure, unit-tested function in `src/lib/posthogProxy.ts`. Cost: each replay batch is a Pages Function invocation.

**Privacy:** recording is deliberately unmasked — search terms, adopter forms and profile pages record in cleartext (user decision 2026-09-01; rationale and dissent recorded in `.agents/plans/2026-09-01-posthog-integration.md`, D1). `input[type="password"]` remains masked by rrweb.

Also reverts the v2.48.3 Clarity `search_query` custom tag, which was a workaround for the limitation PostHog does not have.
```

- [ ] **Step 5: Final checks**

```bash
npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3
```

Expected: tsc silent; `0 errors` and warnings ≤ 125; build completes.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md tests/posthog.spec.ts
git commit -m "v2.49.0: PostHog session replay + analytics behind ENABLE_POSTHOG"
```

---

### Task 8: Deploy and verify on staging

**Files:** none.

- [ ] **Step 1: Ask before pushing, then push**

**STOP. Do not run this automatically after Task 7.** Pushing to `staging` triggers the deploy pipeline — an outward-facing action. Confirm with the user that they want it deployed now, then:

```bash
git push origin HEAD:staging
```

If they'd rather sit on it, Tasks 1–7 are complete and committed locally; this task resumes whenever they say go.

- [ ] **Step 2: Capture the run ID**

Wait ~30s for the run to be created, then:

```bash
gh run list --branch staging --limit 3
```

Match `displayTitle` to `v2.49.0` before watching. Grabbing "latest" too early watches the *previous* run and reports a false success.

- [ ] **Step 3: Watch it**

```bash
gh run watch <run-id> 2>&1 | tee /tmp/posthog-deploy.log
```

`--exit-status` is unreliable in this repo. Read the log and look for `FINAL:` / the concluding status before believing it.

- [ ] **Step 4: Turn the flag on**

Staging → Admin → Config → toggle **PostHog** on. No deploy needed.

- [ ] **Step 5: The real acceptance test**

On staging, search for a **phone number** — not just a name. Open the session in PostHog → Session replays.

Expected: the typed digits are readable in the replay. A name-only check proves nothing about the case most likely to be masked, which is exactly the case this whole change exists to fix.

- [ ] **Step 6: Check LCP did not regress**

Run Lighthouse on the staging homepage with the flag **on**, and compare LCP against a run with it **off**. A measurable regression blocks promotion to production — `/` is `runtime = 'edge'` for cold-start speed and telemetry should not spend it.

- [ ] **Step 7: Report back**

Report: replay readable yes/no, LCP before/after, and any `posthog proxy: upstream fetch failed` warnings in Axiom. Do **not** open a PR to `master` without explicit sign-off.

---

## Open item (not blocking implementation)

**Clarity cut date is still unset.** "Parallel for now" without a date is how three tracking scripts end up running for a year — tripling the PII surface and the page weight. Once Task 8 confirms PostHog works, agree a date to remove Clarity from Zaraz and delete `ClarityScript.tsx`.
