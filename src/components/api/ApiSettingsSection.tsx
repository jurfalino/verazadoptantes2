'use client';

/**
 * «API» in /settings (decision 12): the rescuer's own keys, today's usage and
 * their own transaction log, with «Anular» for records their keys saved.
 * Renders nothing while ENABLE_PUBLIC_API is off (/api/my-api answers 404) or
 * when the rescuer has no key and no history.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import ApiTransactionList, { failure } from './ApiTransactionList';

interface MyKey {
    id: string; name: string; prefix: string; environment: string;
    dailyCapExact: number; dailyCapFuzzy: number; usedToday: { exact: number; fuzzy: number };
    lastUsedAt: string | null; revokedAt: string | null;
}

export default function ApiSettingsSection() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [state, setState] = useState<{ keys: MyKey[]; hasRows: boolean } | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/my-api');
                if (res.status === 404) return; // API not enabled: no section
                if (!res.ok) throw await failure(res, 'my-api');
                const data = await res.json() as { keys: MyKey[]; rows: unknown[] };
                if (!cancelled) setState({ keys: data.keys, hasRows: data.rows.length > 0 });
            } catch (e) {
                toast.error(t('apiReview.error_title'), t('apiReview.error_load'), resolveErrorId(e, 'ApiSettingsSection'));
            }
        })();
        return () => { cancelled = true; };
    }, [t, toast]);

    if (!state || (state.keys.length === 0 && !state.hasRows)) return null;

    return (
        <section className="bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 p-6" data-testid="settings-api">
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-1">{t('apiReview.settings_title')}</h2>
            <p className="text-sm text-stone-500 mb-4">
                {t('apiReview.settings_desc')}{' '}
                <a className="text-teal-700 underline underline-offset-2" href="/api/v1/docs" target="_blank" rel="noreferrer">{t('apiReview.docs_link')}</a>
            </p>
            <ul className="mb-4 space-y-2">
                {state.keys.map(k => (
                    <li key={k.id} className="text-sm">
                        <span className="font-semibold text-stone-800 dark:text-stone-200">{k.name}</span>{' '}
                        <span className="font-mono text-xs text-stone-500">{k.prefix}…</span>
                        {k.revokedAt
                            ? <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-semibold">{t('apiAdmin.revoked')}</span>
                            : <span className="block text-xs text-stone-500">
                                {t('apiReview.used_today')}: {k.usedToday.exact}/{k.dailyCapExact} · fuzzy {k.usedToday.fuzzy}/{k.dailyCapFuzzy}
                                {k.lastUsedAt ? ` · ${t('apiReview.last_used')} ${new Date(k.lastUsedAt).toLocaleString()}` : ''}
                            </span>}
                    </li>
                ))}
            </ul>
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-2">{t('apiReview.transactions_title')}</h3>
            <ApiTransactionList
                listUrl="/api/my-api"
                detailUrl={id => `/api/my-api/requests/${id}`}
                voidUrl={id => `/api/my-api/requests/${id}/void`}
                showOwner={false}
                keys={state.keys.map(k => ({ id: k.id, name: k.name }))}
            />
        </section>
    );
}
