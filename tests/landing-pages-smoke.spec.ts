/**
 * Landing-pages smoke spec (v2.19.15) — non-admin session.
 *
 * Before this spec, the e2e suite's `page.goto` calls only hit three routes
 * — `/adopter/create`, a known-404 adopter id, and `/import`. Every other
 * landing page (`/`, `/my-adopters`, `/my-adoptions`, `/my-animals`,
 * `/organizations`) had zero load-and-render coverage. v2.19.13 shipped a
 * `TypeError: e.getTime is not a function` crash on every `/my-adopters`
 * load and reached production unblocked, because the suite never noticed.
 *
 * Per route: visit, assert no 5xx, assert no `console.error` fired during
 * render, assert ONE expected DOM anchor (an h1 / heading / label). No
 * business-logic assertions — that's what the per-feature specs are for.
 * The job here is to catch *page-load crashes*.
 *
 * Runs in the `[user]` Playwright project (non-admin session). Admin-only
 * routes are covered by `landing-pages-authed.spec.ts` which the `[authed]`
 * project picks up via its name-matching testMatch.
 *
 * Runtime budget: <15 seconds total. No external network, no DB writes.
 */

import { test, expect } from '@playwright/test';
import { runSmokeRoute, type SmokeRoute } from './landing-pages-smoke-shared';

const ROUTES: SmokeRoute[] = [
    // Homepage — every visitor sees it; tab navigation lands here.
    { path: '/', anchor: /search records|buscar registros|BuenAdoptante/i },

    // My-* surfaces — owner views, hit hardest by v2.19.13 changes.
    { path: '/my-adopters', anchor: /my adopters|mis adoptantes|adoptantes/i },
    { path: '/my-adoptions', anchor: /my adoptions|mis adopciones|adopciones/i },
    { path: '/my-animals', anchor: /my animals|mis animales|animales/i },

    // Organizations — the OrgActivityFeed surface.
    { path: '/organizations', anchor: /organizations|organizaciones/i },
];

test.describe('Landing-pages smoke (user session)', () => {
    for (const route of ROUTES) {
        test(`${route.path} loads without crash`, async ({ page }) => {
            await runSmokeRoute(page, route);
        });
    }
});
