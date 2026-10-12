'use client';

/**
 * The API transaction log (decisions 2 and 12), shared by Admin → API (every
 * key) and Settings → API (the rescuer's own keys). The server scopes what
 * each sees; this component only renders and acts.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';

export interface TransactionRow {
    id: string; keyId: string; keyName: string | null; ownerEmail: string; endpoint: string;
    mode: string | null; context: string | null; outcome: string | null; httpStatus: number;
    errorId: string | null; profileIds: string[]; recordId: string | null; profileCreated: boolean;
    externalId: string | null; voidedAt: string | null; voidedBy: string | null; createdAt: string;
}

const OUTCOMES = ['found', 'not_found', 'ambiguous', 'results', 'voided', 'replayed', 'error'] as const;

const OUTCOME_CLASS: Record<string, string> = {
    found: 'bg-teal-50 text-teal-700',
    not_found: 'bg-stone-100 text-stone-600',
    ambiguous: 'bg-amber-50 text-amber-800',
    error: 'bg-red-50 text-red-700',
};

/** A failed fetch as an Error whose message carries the server's errorId as
 *  "(ID: …)", which is how resolveErrorId finds it (no second id is minted). */
export async function failure(res: Response, what: string): Promise<Error> {
    const body = await res.json().catch(() => null) as { error?: string; errorId?: string } | null;
    return new Error(`${body?.error || `${what} failed`} (HTTP ${res.status})${body?.errorId ? ` (ID: ${body.errorId})` : ''}`);
}

export default function ApiTransactionList({ listUrl, detailUrl, voidUrl, showOwner, keys }: {
    listUrl: string;
    detailUrl: (id: string) => string;
    voidUrl: (id: string) => string;
    showOwner: boolean;
    keys: Array<{ id: string; name: string }>;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [rows, setRows] = useState<TransactionRow[]>([]);
    const [nextBefore, setNextBefore] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [outcome, setOutcome] = useState('');
    const [keyId, setKeyId] = useState('');
    const [open, setOpen] = useState<Record<string, { requestBody: unknown; responseBody: unknown } | 'loading'>>({});
    const [confirmVoid, setConfirmVoid] = useState<string | null>(null);

    const load = useCallback(async (before: string | null) => {
        setLoading(true);
        try {
            const q = new URLSearchParams();
            if (outcome) q.set('outcome', outcome);
            if (keyId) q.set('keyId', keyId);
            if (before) q.set('before', before);
            const res = await fetch(`${listUrl}?${q}`);
            if (!res.ok) throw await failure(res, 'list');
            const data = await res.json() as { rows: TransactionRow[]; nextBefore: string | null };
            setRows(prev => before ? [...prev, ...data.rows] : data.rows);
            setNextBefore(data.nextBefore);
        } catch (e) {
            toast.error(t('apiReview.error_title'), t('apiReview.error_load'), resolveErrorId(e, 'ApiTransactionList.load'));
        } finally {
            setLoading(false);
        }
    }, [listUrl, outcome, keyId, t, toast]);

    useEffect(() => { void load(null); }, [load]);

    const toggle = async (id: string) => {
        if (open[id]) { setOpen(({ [id]: _drop, ...rest }) => rest); return; }
        setOpen(o => ({ ...o, [id]: 'loading' }));
        try {
            const res = await fetch(detailUrl(id));
            if (!res.ok) throw await failure(res, 'detail');
            const { transaction } = await res.json() as { transaction: { requestBody: unknown; responseBody: unknown } };
            setOpen(o => ({ ...o, [id]: { requestBody: transaction.requestBody, responseBody: transaction.responseBody } }));
        } catch (e) {
            setOpen(({ [id]: _drop, ...rest }) => rest);
            toast.error(t('apiReview.error_title'), t('apiReview.error_load'), resolveErrorId(e, 'ApiTransactionList.detail'));
        }
    };

    const doVoid = async (id: string) => {
        setConfirmVoid(null);
        try {
            const res = await fetch(voidUrl(id), { method: 'POST' });
            if (!res.ok) throw await failure(res, 'void');
            const done = await res.json() as { profileVoided: boolean };
            setRows(rs => rs.map(r => r.id === id ? { ...r, voidedAt: new Date().toISOString() } : r));
            toast.success(t('apiReview.voided_title'), done.profileVoided ? t('apiReview.voided_with_profile') : t('apiReview.voided_body'));
        } catch (e) {
            toast.error(t('apiReview.error_title'), t('apiReview.error_void'), resolveErrorId(e, 'ApiTransactionList.void'));
        }
    };

    const select = 'text-sm rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2';

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
                <select className={select} value={outcome} onChange={e => setOutcome(e.target.value)} aria-label={t('apiReview.filter_outcome')}>
                    <option value="">{t('apiReview.filter_all_outcomes')}</option>
                    {OUTCOMES.map(o => <option key={o} value={o}>{t(`apiReview.outcome_${o}`)}</option>)}
                </select>
                {keys.length > 1 && (
                    <select className={select} value={keyId} onChange={e => setKeyId(e.target.value)} aria-label={t('apiReview.filter_key')}>
                        <option value="">{t('apiReview.filter_all_keys')}</option>
                        {keys.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                    </select>
                )}
            </div>

            {!loading && rows.length === 0 && <p className="text-sm text-stone-500">{t('apiReview.empty')}</p>}

            <ul className="divide-y divide-stone-100 dark:divide-stone-700" data-testid="api-transactions">
                {rows.map(r => {
                    const detail = open[r.id];
                    const profileId = r.profileIds[0];
                    const canVoid = r.endpoint === 'search' && !!r.recordId && !r.voidedAt && r.httpStatus === 200;
                    return (
                        <li key={r.id} className="py-3 text-sm" data-testid="api-transaction">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="text-stone-500 tabular-nums">{new Date(r.createdAt).toLocaleString()}</span>
                                <span className="font-semibold text-stone-800 dark:text-stone-200">{r.keyName ?? r.keyId.slice(0, 8)}</span>
                                {showOwner && <span className="text-stone-500 break-all">{r.ownerEmail}</span>}
                                <span className="text-stone-600 dark:text-stone-300">
                                    {r.endpoint}{r.mode ? ` · ${r.mode}` : ''}{r.context ? ` · ${t(`apiReview.context_${r.context}`)}` : ''}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${OUTCOME_CLASS[r.outcome ?? ''] ?? 'bg-stone-100 text-stone-600'}`}>
                                    {r.outcome ? t(`apiReview.outcome_${r.outcome}`) : r.httpStatus}
                                </span>
                                {r.httpStatus >= 400 && <span className="text-xs text-red-700">HTTP {r.httpStatus}{r.errorId ? ` · ${r.errorId}` : ''}</span>}
                                {r.voidedAt && <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-semibold">{t('apiReview.voided_badge')}</span>}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                                {profileId && (
                                    <Link className="text-teal-700 underline underline-offset-2" href={r.recordId && !r.voidedAt ? `/adopter/${profileId}?record=${encodeURIComponent(r.recordId)}` : `/adopter/${profileId}`}>
                                        {r.recordId && !r.voidedAt ? t('apiReview.open_record') : t('apiReview.open_profile')}
                                    </Link>
                                )}
                                {r.profileCreated && <span className="text-xs text-stone-500">{t('apiReview.profile_created')}</span>}
                                {r.externalId && <span className="text-xs text-stone-500">externalId: {r.externalId}</span>}
                                <button type="button" className="text-stone-600 underline underline-offset-2 py-1" onClick={() => toggle(r.id)} aria-expanded={!!detail}>
                                    {detail ? t('apiReview.hide_detail') : t('apiReview.show_detail')}
                                </button>
                                {canVoid && confirmVoid !== r.id && (
                                    <button type="button" className="text-red-700 underline underline-offset-2 py-1" onClick={() => setConfirmVoid(r.id)}>
                                        {t('apiReview.void')}
                                    </button>
                                )}
                                {canVoid && confirmVoid === r.id && (
                                    <span className="inline-flex items-center gap-2">
                                        <span className="text-stone-700 dark:text-stone-300">{t('apiReview.void_confirm')}</span>
                                        <button type="button" className="text-xs font-bold rounded-xl px-3 py-1 border" style={{ background: 'var(--status-error-bg)', color: 'var(--status-error-text)', borderColor: 'var(--status-error-border)' }} onClick={() => doVoid(r.id)}>
                                            {t('apiReview.void_yes')}
                                        </button>
                                        <button type="button" className="text-xs text-stone-600 underline py-1" onClick={() => setConfirmVoid(null)}>{t('apiReview.void_no')}</button>
                                    </span>
                                )}
                            </div>
                            {detail === 'loading' && <p className="mt-2 text-xs text-stone-500">…</p>}
                            {detail && detail !== 'loading' && (
                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    {(['requestBody', 'responseBody'] as const).map(k => (
                                        <div key={k} className="min-w-0">
                                            <p className="text-xs font-semibold text-stone-500 mb-1">{t(k === 'requestBody' ? 'apiReview.request' : 'apiReview.response')}</p>
                                            <pre className="text-xs bg-stone-50 dark:bg-stone-900 rounded-xl p-3 overflow-x-auto max-h-80">
                                                {detail[k] === null ? t('apiReview.body_purged') : JSON.stringify(detail[k], null, 2)}
                                            </pre>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            {nextBefore && (
                <button type="button" disabled={loading} onClick={() => load(nextBefore)}
                    className="text-sm font-bold rounded-xl px-4 py-2 border" style={{ background: 'var(--accent-subtle-bg)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }}>
                    {t('apiReview.load_more')}
                </button>
            )}
        </div>
    );
}
