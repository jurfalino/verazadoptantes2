'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { reportClientError } from '@/lib/clientErrorReporter';
import { DEPLOYMENT_STALE_EVENT, markDeploymentStale, isDeploymentMarkedStale, type DeploymentStaleDetail } from '@/lib/staleDeploy';

/**
 * Recognises a tab that is older than the running deployment, from ANY server
 * call, and offers one reload.
 *
 * The middleware rejects such a tab's requests with 409 + `x-deployment-skew`.
 * Where that surfaces depends on each caller's catch block — some go through
 * resolveErrorId, some print the message, some show their own generic text —
 * and a per-catch fix already missed search once (audit 2026-09-19). Watching
 * the responses themselves makes recognition independent of every catch block.
 *
 * It never reloads by itself: most calls are saves, and a reload destroys what
 * was typed. It shows one persistent notice with a "Recargar" button.
 */
declare global { interface Window { __bnaFetchWatched?: boolean } }

export default function StaleDeployWatcher() {
    const { showToast, toasts } = useToast();
    const toastsRef = useRef(toasts);
    toastsRef.current = toasts;
    const reportedRef = useRef(false);
    const { t } = useLanguage();
    const shownRef = useRef(false);

    // Observe every response. Returns the response untouched.
    useEffect(() => {
        if (typeof window === 'undefined' || window.__bnaFetchWatched) return;
        window.__bnaFetchWatched = true;
        const original = window.fetch.bind(window);
        window.fetch = async (...args: Parameters<typeof fetch>) => {
            const res = await original(...args);
            if (res.status === 409 && res.headers.get('x-deployment-skew') === '1') {
                const init = args[1] as RequestInit | undefined;
                const method = (init?.method || (args[0] instanceof Request ? args[0].method : 'GET')).toUpperCase();
                markDeploymentStale({ serverBuildId: res.headers.get('x-deployment-id-server'), userInitiated: method !== 'GET' });
            }
            return res;
        };
    }, []);

    useEffect(() => {
        const onStale = (e: Event) => {
            const detail = (e as CustomEvent<DeploymentStaleDetail>).detail ?? {};
            const title = t('errors.stale_banner_title');
            const visible = toastsRef.current.some(x => x.title === title);
            // Show it the first time, and again whenever the person tries to do
            // something after dismissing it. Background polls don't bring it back.
            if (visible || (shownRef.current && !detail.userInitiated)) return;
            shownRef.current = true;
            showToast({
                type: 'warning',
                title: t('errors.stale_banner_title'),
                message: t('errors.stale_banner_body'),
                action: { label: t('errors.stale_banner_action'), onClick: () => window.location.reload() },
                duration: 0,
            });
            // Observability (audit P1-1): without this, skew was invisible — the
            // middleware 409 is silent and nothing downstream reported it.
            if (reportedRef.current) return;
            reportedRef.current = true;
            void reportClientError({
                level: 'warn',
                source: 'deployment-skew',
                message: 'deployment-skew: tab is older than the running deployment',
                extra: {
                    clientBuildId: process.env.APP_BUILD_ID || null,
                    serverBuildId: detail.serverBuildId ?? null,
                    path: window.location.pathname,
                },
            });
        };
        window.addEventListener(DEPLOYMENT_STALE_EVENT, onStale);
        // markDeploymentStale fires its event once. If something flagged the tab
        // before this effect ran (an error during load), nobody was listening
        // and later calls return early — catch up here so the notice still shows.
        if (isDeploymentMarkedStale()) onStale(new CustomEvent(DEPLOYMENT_STALE_EVENT, { detail: {} }));
        return () => window.removeEventListener(DEPLOYMENT_STALE_EVENT, onStale);
    }, [showToast, t]);

    return null;
}
