/**
 * Landing-pages smoke spec (v2.19.15) — admin session.
 *
 * Picked up by the `[authed]` Playwright project via its name-matching
 * testMatch (`(?<![a-z])authed\.spec\.ts`). Covers the SAME non-admin
 * routes as `landing-pages-smoke.spec.ts` (admin can view everything an
 * unprivileged user can — different code path through `resolveVisibility`,
 * worth confirming neither path crashes) PLUS the admin-only routes
 * (`/admin/audit`, `/admin/business-logic`, `/admin/adopters`) that only
 * load with an admin session.
 *
 * Same shape as the user-session smoke: each route gets a navigate, a no-5xx
 * assertion, a visible-anchor assertion, and a no-console-error assertion.
 * No business logic asserted — that's other specs' job.
 */

import { test } from '@playwright/test';
import { runSmokeRoute, type SmokeRoute } from './landing-pages-smoke-shared';

const ROUTES: SmokeRoute[] = [
    // Same routes as the user smoke — admin path through visibility is a
    // separate code branch and worth re-asserting against.
    { path: '/', anchor: /search records|buscar registros|BuenAdoptante/i },
    { path: '/my-adopters', anchor: /my adopters|mis adoptantes|adoptantes/i },
    { path: '/my-adoptions', anchor: /my adoptions|mis adopciones|adopciones/i },
    { path: '/my-animals', anchor: /my animals|mis animales|animales/i },
    { path: '/organizations', anchor: /organizations|organizaciones/i },

    // Admin-only routes — these only render when the viewer is admin.
    {
        path: '/admin/audit',
        anchor: /audit log|registro de auditor/i,
        timeout: 20000, // /admin/audit fan-outs three D1 batches on load.
    },
    {
        path: '/admin/business-logic',
        anchor: /lógica de negocio|business logic/i,
    },
    {
        path: '/admin/adopters',
        anchor: /adopters|adoptantes/i,
    },
];

test.describe('Landing-pages smoke (admin session)', () => {
    for (const route of ROUTES) {
        test(`${route.path} loads without crash`, async ({ page }) => {
            await runSmokeRoute(page, route);
        });
    }
});
