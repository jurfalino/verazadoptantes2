'use client';
export const runtime = 'edge';

/**
 * Admin → API (.agents/plans/2026-10-09-third-party-api.md; tabs per the
 * 2026-10-17 review, .agents/audits/2026-10-17-admin-api-review.md):
 * Overview (health, pending requests), People (approve / block, who searched
 * whom), Keys (issue, limits, revoke) and Calls (every transaction, with undo).
 * The tab and the open person live in the URL (?tab=people&person=…), so an
 * admin notification can link straight to the pending requests.
 * Admin-only via the (admin-only) layout.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import ApiTransactionList from '@/components/api/ApiTransactionList';
import AdminApiOverview from '@/components/api/admin/AdminApiOverview';
import AdminApiPeople from '@/components/api/admin/AdminApiPeople';
import AdminApiKeys, { card, type KeyView } from '@/components/api/admin/AdminApiKeys';

const TABS = ['overview', 'people', 'keys', 'calls'] as const;
type Tab = typeof TABS[number];

function CallsTab() {
    const { t } = useLanguage();
    const [keys, setKeys] = useState<KeyView[]>([]);
    useEffect(() => {
        // The key filter's options only; a failure leaves the filter empty and the list still works.
        fetch('/api/admin/api-keys').then(r => (r.ok ? r.json() : { keys: [] }) as Promise<{ keys: KeyView[] }>).then(d => setKeys(d.keys))
            .catch((e) => console.warn('AdminApiPage: key filter options failed', e));
    }, []);
    return (
        <section className={card}>
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-3">{t('apiReview.transactions_title')}</h2>
            <ApiTransactionList
                listUrl="/api/admin/api-requests"
                detailUrl={id => `/api/admin/api-requests/${id}`}
                voidUrl={id => `/api/admin/api-requests/${id}/void`}
                showOwner
                advanced
                keys={keys.map(k => ({ id: k.id, name: `${k.name} (${k.ownerEmail})` }))}
            />
        </section>
    );
}

function AdminApiTabs() {
    const { t } = useLanguage();
    const router = useRouter();
    const params = useSearchParams();
    const raw = params.get('tab');
    const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? raw as Tab : 'overview';
    const person = params.get('person');
    const status = params.get('status') ?? '';

    const go = useCallback((next: Partial<{ tab: Tab; person: string | null; status: string | null }>) => {
        const p = new URLSearchParams();
        p.set('tab', next.tab ?? tab);
        const nextPerson = 'person' in next ? next.person : (next.tab && next.tab !== tab ? null : person);
        if (nextPerson) p.set('person', nextPerson);
        const nextStatus = 'status' in next ? next.status : (next.tab && next.tab !== tab ? null : status);
        if (nextStatus) p.set('status', nextStatus);
        router.push(`/admin/api?${p}`, { scroll: false });
    }, [router, tab, person, status]);

    return (
        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
            <header>
                <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">{t('apiAdmin.title')}</h1>
                <p className="text-sm text-stone-500 mt-1">
                    {t('apiAdmin.subtitle')}{' '}
                    <a className="text-teal-700 underline underline-offset-2" href="/api/v1/docs" target="_blank" rel="noreferrer">{t('apiReview.docs_link')}</a>
                </p>
            </header>

            <nav className="flex gap-1 border-b border-stone-200 dark:border-stone-700 overflow-x-auto" role="tablist" aria-label={t('apiAdmin.title')}>
                {TABS.map(k => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k}
                        className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px ${tab === k ? 'border-current' : 'border-transparent text-stone-500'}`}
                        style={tab === k ? { color: 'var(--accent)' } : undefined}
                        onClick={() => go({ tab: k })} data-testid={`api-tab-${k}`}>
                        {t(`apiAdmin.tab_${k}`)}
                    </button>
                ))}
            </nav>

            {tab === 'overview' && (
                <AdminApiOverview onOpenPerson={email => go({ tab: 'people', person: email })} onOpenPending={() => go({ tab: 'people', status: 'requested' })} />
            )}
            {tab === 'people' && (
                <AdminApiPeople person={person} initialStatus={status} onOpen={email => go({ person: email })} />
            )}
            {tab === 'keys' && <AdminApiKeys />}
            {tab === 'calls' && <CallsTab />}
        </div>
    );
}

export default function AdminApiPage() {
    return <Suspense fallback={null}><AdminApiTabs /></Suspense>;
}
