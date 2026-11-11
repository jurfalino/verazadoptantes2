/**
 * Cloudflare Pages middleware: old addresses (adoptions.pages.dev, adoptions-staging.pages.dev, www) answer a
 * 301 to the same path on CANONICAL_HOST (enadopcion.org / staging.enadopcion.org). Unset → every request
 * passes through unchanged. The rule lives in src/canonicalHost.ts (tested).
 */
import { canonicalRedirect } from '../src/canonicalHost';

interface Ctx {
    request: Request;
    env: { CANONICAL_HOST?: string };
    next: () => Promise<Response>;
}

export const onRequest = async (context: Ctx): Promise<Response> => {
    const to = canonicalRedirect(context.request.url, context.env.CANONICAL_HOST);
    if (to) return Response.redirect(to, 301);
    return context.next();
};
