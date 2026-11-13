/**
 * Cloudflare Pages middleware: old addresses (adoptions.pages.dev, adoptions-staging.pages.dev, www) answer a
 * redirect (302 for now) to the same path on the canonical host (enadopcion.org / staging.enadopcion.org), built
 * in by CI from the GitHub variable CANONICAL_HOST_STAGING / _PROD. Unset → every request passes through unchanged. The rule lives in src/canonicalHost.ts (tested).
 */
import { canonicalRedirect } from '../src/canonicalHost';
import { CANONICAL_HOST } from '../src/canonicalHost.generated';

interface Ctx {
    request: Request;
    env: { CANONICAL_HOST?: string };
    next: () => Promise<Response>;
}

export const onRequest = async (context: Ctx): Promise<Response> => {
    const to = canonicalRedirect(context.request.url, context.env.CANONICAL_HOST || CANONICAL_HOST);
    // 302 while the move is new: a wrong 301 stays cached in browsers forever. Switch to 301 once enadopcion.org is settled.
    if (to) return Response.redirect(to, 302);
    return context.next();
};
