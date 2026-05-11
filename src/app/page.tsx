export const runtime = 'edge';
import HomeClient from '@/components/HomeClient';
import { getPublicConfig, PUBLIC_FLAG_DEFAULTS } from '@/lib/publicConfig';

/**
 * Homepage server-component wrapper. Fetches the public feature flags
 * server-side and passes them as `initialConfig` to the client component
 * (HomeClient). This eliminates the v2.14.8-5-era pattern where the homepage
 * `useState({})` + `useEffect(fetch('/api/config'))` deferred all flag-gated
 * UI to post-hydration — that pattern was the main contributor to a ~17s
 * LCP p99 reported via Cloudflare Web Analytics on cold-start workers + slow
 * connections.
 *
 * `getPublicConfig()` is 30s-cached per worker (see src/lib/publicConfig.ts),
 * so this server-side fetch adds ~no latency on warm workers; cold workers
 * pay ~50-200ms for the D1 read, which we'd be paying client-side anyway
 * but on a path that delays first paint. Net effect: LCP element renders
 * in the SSR HTML on first byte.
 */
export default async function Page() {
    const initialConfig = await getPublicConfig().catch(() => ({ ...PUBLIC_FLAG_DEFAULTS }));
    return <HomeClient initialConfig={initialConfig} />;
}
