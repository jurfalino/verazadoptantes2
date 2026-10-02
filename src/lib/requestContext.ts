/**
 * The app's only way to reach the Cloudflare request context.
 *
 * Same as `getRequestContext` from '@cloudflare/next-on-pages', except
 * `env.DB` refuses writes while an admin is viewing the app as another user
 * (src/lib/readOnlyGuard.ts). Importing the package directly would bypass that,
 * so src/lib/requestContext.test.ts fails the build if anything does.
 */

import { getRequestContext as getCloudflareRequestContext } from '@cloudflare/next-on-pages';
import { guardedD1 } from '@/lib/readOnlyGuard';

const guardedEnvs = new WeakMap<CloudflareEnv, CloudflareEnv>();

function guardEnv(env: CloudflareEnv): CloudflareEnv {
    if (!env || typeof env !== 'object') return env;
    let guarded = guardedEnvs.get(env);
    if (!guarded) {
        guarded = new Proxy(env, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                return prop === 'DB' && value ? guardedD1(value as D1Database) : value;
            },
        });
        guardedEnvs.set(env, guarded);
    }
    return guarded;
}

export function getRequestContext(): { env: CloudflareEnv; ctx: ExecutionContext; cf: IncomingRequestCfProperties } {
    const context = getCloudflareRequestContext();
    return { env: guardEnv(context.env), ctx: context.ctx, cf: context.cf };
}
