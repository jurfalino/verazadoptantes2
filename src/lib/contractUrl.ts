/**
 * Server-side resolver for the public Vite contract-app base URL.
 *
 * Why this exists: `NEXT_PUBLIC_*` env vars are inlined at build time, so
 * a single build artifact can't point to different Vite-app hosts per env
 * (staging vs prod). We read `CONTRACT_BASE_URL` from the Cloudflare worker
 * binding at runtime instead, with fallbacks for local dev.
 *
 * Set this per-environment in the Cloudflare Pages "Environment variables"
 * tab — different value on the staging deployment vs production.
 */
export async function getContractBaseUrl(): Promise<string> {
    let value: string | undefined;
    try {
        const { getRequestContext } = await import('@cloudflare/next-on-pages');
        const { env } = getRequestContext();
        value = (env as unknown as Record<string, string | undefined>).CONTRACT_BASE_URL;
    } catch {
        // outside the worker (local dev / build-time) — fall through
    }
    const raw = value || process.env.CONTRACT_BASE_URL || process.env.NEXT_PUBLIC_CONTRACT_URL || 'https://adoptions.pages.dev';
    return raw.replace(/\/+$/, '');
}
