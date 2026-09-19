import { checkCloudflareStatus } from './serviceStatus';
import { resolveErrorId } from './clientErrorReporter';
import { attemptStaleReload, markDeploymentStale } from './staleDeploy';
import { isDeploymentSkewError } from '@/domain/clientErrors';

type ErrorToast = (title: string, message?: string, errorId?: string) => void;

/**
 * Show a degradation-aware error toast for a failed request.
 *
 * If the failure coincides with a live upstream incident, we replace the bare
 * error with an honest "it's on our side, not you, your data is safe" message.
 * Otherwise we show the caller's normal fallback copy. The errorId is preserved
 * either way so support can still trace it — we never HIDE a real app bug
 * behind a false "it's a service disruption".
 *
 * Use this only for infra-smelling failures (5xx / network / thrown server
 * actions), not for validation errors.
 */
export async function notifyRequestError(
    toastError: ErrorToast,
    t: (key: string) => string,
    err: unknown,
    fallback: { title: string; message: string },
    source = 'notifyRequestError',
): Promise<void> {
    // A tab older than the running deployment (the middleware rejects its
    // requests). Nothing failed — the page just needs fetching again. This is
    // the search box's error path, and until 2.56.66 it did not know about skew:
    // stale tabs got "Búsqueda fallida" after every deploy.
    // Search is a read: there is nothing typed to lose, so it reloads by itself.
    // If a reload is not allowed right now, the "new version" banner takes over.
    if (isDeploymentSkewError(err)) {
        if (!attemptStaleReload()) markDeploymentStale();
        return;
    }

    // resolveErrorId, not bare extractErrorId: a client-side throw carries no id,
    // and without this it reached the toast with none and was never logged.
    const errorId = resolveErrorId(err, source);
    const status = await checkCloudflareStatus();
    if (status.degraded) {
        toastError(t('errors.service_degraded_title'), t('errors.service_degraded_body'), errorId);
        return;
    }
    toastError(fallback.title, fallback.message, errorId);
}
