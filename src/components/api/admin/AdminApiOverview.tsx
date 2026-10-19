'use client';

/**
 * Admin → API → Overview: is the API on, who is waiting for access, how the
 * last 24 hours / 7 days went, and who uses fuzzy search the most.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { failure } from '../ApiTransactionList';
import ApiDemoPeople from '../ApiDemoPeople';
import { card } from './AdminApiKeys';

interface Window { calls: number; clientErrors: number; serverErrors: number; unavailable: number; capHits: number; ceilingHits: number }
interface Overview { enabled: boolean; pendingRequests: number; last24h: Window; last7d: Window; topFuzzy7d: Array<{ email: string; fuzzy: number }> }

export default function AdminApiOverview({ onOpenPerson, onOpenPending }: { onOpenPerson: (email: string) => void; onOpenPending: () => void }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [o, setO] = useState<Overview | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/admin/api-overview');
                if (!res.ok) throw await failure(res, 'overview');
                setO(await res.json() as Overview);
            } catch (e) {
                toast.error(t('apiReview.error_title'), t('apiReview.error_load'), resolveErrorId(e, 'AdminApiOverview.load'));
            }
        })();
    }, [t, toast]);

    if (!o) return <p className="text-sm text-stone-500">{t('apiAdmin.loading')}</p>;
    const rows: Array<[string, keyof Window]> = [
        ['apiAdmin.ov_calls', 'calls'], ['apiAdmin.ov_client_errors', 'clientErrors'], ['apiAdmin.ov_server_errors', 'serverErrors'],
        ['apiAdmin.ov_unavailable', 'unavailable'], ['apiAdmin.ov_cap_hits', 'capHits'], ['apiAdmin.ov_ceiling_hits', 'ceilingHits'],
    ];
    return (
        <div className="space-y-4" data-testid="api-overview">
            <section className={`${card} flex flex-wrap items-center gap-4`}>
                <span className="text-sm font-semibold px-3 py-1 rounded-full"
                    style={o.enabled ? { background: 'var(--status-success-bg)', color: 'var(--status-success-text)' } : { background: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' }}
                    data-testid="api-overview-enabled">
                    {o.enabled ? t('apiAdmin.ov_on') : t('apiAdmin.ov_off')}
                </span>
                <a href="/admin/config" className="text-sm text-teal-700 underline underline-offset-2">{t('apiAdmin.ov_change_in_config')}</a>
                <button type="button" onClick={onOpenPending} className="ml-auto text-sm font-semibold underline underline-offset-2 py-1" data-testid="api-overview-pending">
                    {t('apiAdmin.ov_pending').replace('{n}', String(o.pendingRequests))}
                </button>
            </section>

            <section className={card}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-stone-500 text-xs">
                                <th className="py-1 pr-4 font-semibold"></th>
                                <th className="py-1 pr-4 font-semibold text-right">{t('apiAdmin.ov_24h')}</th>
                                <th className="py-1 font-semibold text-right">{t('apiAdmin.ov_7d')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(([label, k]) => (
                                <tr key={k} className="border-t border-stone-100 dark:border-stone-700">
                                    <td className="py-2 pr-4 text-stone-700 dark:text-stone-300">{t(label)}</td>
                                    <td className="py-2 pr-4 text-right tabular-nums">{o.last24h[k]}</td>
                                    <td className="py-2 text-right tabular-nums">{o.last7d[k]}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className={card}>
                <h2 className="text-base font-semibold text-stone-800 dark:text-stone-200 mb-2">{t('apiAdmin.ov_top_fuzzy')}</h2>
                {o.topFuzzy7d.length === 0 && <p className="text-sm text-stone-500">{t('apiAdmin.ov_no_fuzzy')}</p>}
                <ol className="space-y-1">
                    {o.topFuzzy7d.map(p => (
                        <li key={p.email} className="text-sm flex justify-between gap-3">
                            <button type="button" className="text-teal-700 underline underline-offset-2 break-all text-left" onClick={() => onOpenPerson(p.email)}>{p.email}</button>
                            <span className="tabular-nums text-stone-600">{p.fuzzy}</span>
                        </li>
                    ))}
                </ol>
            </section>

            <ApiDemoPeople className={card} />
        </div>
    );
}
