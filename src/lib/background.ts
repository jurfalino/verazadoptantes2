import { getRequestContext } from '@cloudflare/next-on-pages';
import { logger } from './logger';

/**
 * Run work that should not delay the response — and make sure it actually runs.
 *
 * On Cloudflare a worker may be torn down as soon as its response is sent, so a
 * bare `doSomething().catch(...)` is a race the heavier jobs lose. That is how
 * "someone added a contact detail" notifications and the automatic access request
 * never ran once in production between May and 2026-09-19 (0 rows, 0 log lines),
 * while lighter fire-and-forget writes (profile views, search hits) survived.
 *
 * `ctx.waitUntil` is the platform's guarantee: the worker stays alive until the
 * promise settles, without making the user wait. Where there is no such context
 * (local dev, tests, a non-edge route) we simply wait for the work — slower, but
 * never silently skipped.
 *
 * Never throws: a failed side effect must not undo the action that triggered it.
 * It is logged with the task name and the caller's context instead.
 *
 * Always `await` the call. It resolves immediately when waitUntil took the work.
 */
export async function runAfterResponse(
    name: string,
    task: () => Promise<unknown>,
    context: Record<string, unknown> = {},
): Promise<void> {
    const guarded = (async () => {
        try {
            await task();
        } catch (e) {
            logger.error(`background task failed: ${name}`, e, context);
        }
    })();

    try {
        const { ctx } = getRequestContext();
        if (ctx?.waitUntil) {
            ctx.waitUntil(guarded);
            return;
        }
    } catch {
        // No request context — fall through and wait.
    }
    await guarded;
}
