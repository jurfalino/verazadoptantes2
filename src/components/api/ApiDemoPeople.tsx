'use client';

/**
 * Admin → API → «Personas de ejemplo» (staging only): load or reset the people
 * of the API docs' exact-search scenarios, so each documented call returns its
 * documented answer. Renders nothing in production (the route says so).
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { failure } from './ApiTransactionList';

export default function ApiDemoPeople({ className }: { className: string }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [state, setState] = useState<{ loaded: number } | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/admin/api-demo');
                if (!res.ok) throw await failure(res, 'api-demo');
                const data = await res.json() as { available: boolean; loaded?: number };
                if (!cancelled && data.available) setState({ loaded: data.loaded ?? 0 });
            } catch (e) {
                toast.error(t('apiAdmin.demo_error'), t('apiAdmin.demo_error_body'), resolveErrorId(e, 'ApiDemoPeople.load'));
            }
        })();
        return () => { cancelled = true; };
    }, [t, toast]);

    if (!state) return null;

    const run = async () => {
        setBusy(true);
        try {
            const res = await fetch('/api/admin/api-demo', { method: 'POST' });
            if (!res.ok) throw await failure(res, 'api-demo');
            const data = await res.json() as { profiles: number };
            setState({ loaded: data.profiles });
            toast.success(t('apiAdmin.demo_done'));
        } catch (e) {
            toast.error(t('apiAdmin.demo_error'), t('apiAdmin.demo_error_body'), resolveErrorId(e, 'ApiDemoPeople.seed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={className} data-testid="api-demo-people">
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-1">{t('apiAdmin.demo_title')}</h2>
            <p className="text-sm text-stone-600 dark:text-stone-400 mb-3">{t('apiAdmin.demo_body')}</p>
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-stone-500" data-testid="api-demo-status">
                    {state.loaded > 0 ? t('apiAdmin.demo_loaded').replace('{n}', String(state.loaded)) : t('apiAdmin.demo_not_loaded')}
                </span>
                <button type="button" disabled={busy} onClick={run} data-testid="api-demo-run"
                    className="text-sm font-semibold rounded-xl px-4 py-2 disabled:opacity-50"
                    style={{ background: 'var(--btn-primary-bg)', color: 'white' }}>
                    {busy ? t('apiAdmin.demo_running') : state.loaded > 0 ? t('apiAdmin.demo_reset') : t('apiAdmin.demo_load')}
                </button>
            </div>
        </section>
    );
}
