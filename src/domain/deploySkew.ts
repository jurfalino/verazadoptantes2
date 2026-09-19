/**
 * Deployment skew: what to do with a request from a tab loaded on another build.
 *
 * The customer must not notice a deploy. Rejecting an old tab's request — even
 * politely, with a "reload" notice — makes our release their problem, and it
 * cannot help tabs loaded before the notice existed (v2.56.67's "one last
 * round" of "Búsqueda fallida"). Cloudflare Pages keeps every deployment alive
 * at its own URL, so instead we serve an old tab's saves and searches from the
 * deployment that tab was loaded from, where its action ids still exist. This is
 * what Vercel calls skew protection. Verified 2026-09-19: an old production
 * deployment answers such a forwarded request correctly, provided
 * `x-forwarded-host` carries the public host (Next's server-action origin check).
 *
 * Page navigations are different: rejecting one makes Next fall back to a full
 * browser navigation, which silently upgrades the tab. So those stay rejected.
 */

export type SkewDecision =
    | { kind: 'pass' }
    | { kind: 'reject' }
    | { kind: 'proxy'; origin: string };

/** Only our own Pages deployments may ever be a forwarding target. */
const DEPLOYMENT_URL = /^https:\/\/[a-z0-9]+\.verazadoptantes2\.pages\.dev$/;
const LOCAL_URL = /^http:\/\/localhost:\d+$/;

/** Parse the build-id → deployment-URL map CI bakes in. Invalid entries are dropped. */
export function parseDeployMap(raw: string | undefined | null, allowLocal = false): Record<string, string> {
    if (!raw) return {};
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return {}; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [buildId, url] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof url !== 'string') continue;
        if (DEPLOYMENT_URL.test(url) || (allowLocal && LOCAL_URL.test(url))) out[buildId] = url;
    }
    return out;
}

export function decideSkew(input: {
    clientBuildId: string | null | undefined;
    serverBuildId: string | null | undefined;
    isServerAction: boolean;
    alreadyProxied: boolean;
    map: Record<string, string>;
}): SkewDecision {
    const { clientBuildId, serverBuildId, isServerAction, alreadyProxied, map } = input;
    // Both sides must be known for a difference to mean anything.
    if (!clientBuildId || !serverBuildId || clientBuildId === serverBuildId) return { kind: 'pass' };
    if (alreadyProxied) return { kind: 'pass' };
    if (isServerAction && Object.hasOwn(map, clientBuildId)) {
        return { kind: 'proxy', origin: map[clientBuildId] };
    }
    return { kind: 'reject' };
}
