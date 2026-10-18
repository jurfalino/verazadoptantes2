'use client';
export const runtime = 'edge';

/**
 * Admin → API (.agents/plans/2026-10-09-third-party-api.md, decision 2):
 * issue / revoke keys, set their daily caps, and review every transaction
 * (with undo for records the API saved). Admin-only via the (admin-only) layout.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import ApiTransactionList, { failure } from '@/components/api/ApiTransactionList';
import RescuerEmailPicker from '@/components/api/RescuerEmailPicker';
import ApiDemoPeople from '@/components/api/ApiDemoPeople';

interface KeyView {
    id: string; name: string; ownerEmail: string; prefix: string; environment: string; scopes: string[];
    dailyCapExact: number; dailyCapFuzzy: number; usedToday: { exact: number; fuzzy: number };
    last30?: { activities: number; voided: number };
    createdAt: string | null; lastUsedAt: string | null; revokedAt: string | null;
    selfService?: boolean;
}

const card = 'bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 p-6';
const input = 'text-sm rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2';
const primaryBtn = { background: 'var(--btn-primary-bg)', color: 'white' };

/** Search-then-void: a key that voids a lot of what it saves is looking people up without leaving a trace. */
function isManyVoids(s: { activities: number; voided: number }): boolean {
    return s.voided >= 3 && s.voided / Math.max(1, s.activities) >= 0.2;
}

export default function AdminApiPage() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [keys, setKeys] = useState<KeyView[]>([]);
    const [ownerEmail, setOwnerEmail] = useState('');
    const [name, setName] = useState('');
    const [issuing, setIssuing] = useState(false);
    const [secret, setSecret] = useState<{ value: string; name: string; regenerated?: boolean } | null>(null);
    // One pending inline confirmation at a time: revoke or regenerate a key.
    const [confirm, setConfirm] = useState<{ id: string; action: 'revoke' | 'regenerate' } | null>(null);

    const loadKeys = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/api-keys');
            if (!res.ok) throw await failure(res, 'keys');
            setKeys((await res.json() as { keys: KeyView[] }).keys);
        } catch (e) {
            toast.error(t('apiReview.error_title'), t('apiReview.error_load'), resolveErrorId(e, 'AdminApiPage.loadKeys'));
        }
    }, [t, toast]);
    useEffect(() => { void loadKeys(); }, [loadKeys]);

    const issue = async (e: React.FormEvent) => {
        e.preventDefault();
        setIssuing(true);
        try {
            const res = await fetch('/api/admin/api-keys', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ownerEmail, name }),
            });
            if (res.status === 404) { toast.warning(t('apiAdmin.unknown_owner_title'), t('apiAdmin.unknown_owner_body')); return; }
            if (!res.ok) throw await failure(res, 'issue');
            const issued = await res.json() as { secret: string };
            setSecret({ value: issued.secret, name });
            setOwnerEmail(''); setName('');
            await loadKeys();
        } catch (err) {
            toast.error(t('apiReview.error_title'), t('apiAdmin.error_issue'), resolveErrorId(err, 'AdminApiPage.issue'));
        } finally {
            setIssuing(false);
        }
    };

    const regenerate = async (k: KeyView) => {
        try {
            const res = await fetch(`/api/admin/api-keys/${k.id}/regenerate`, { method: 'POST' });
            if (!res.ok) throw await failure(res, 'regenerate');
            const done = await res.json() as { secret: string };
            setSecret({ value: done.secret, name: k.name, regenerated: true });
            window.scrollTo({ top: 0, behavior: 'smooth' });
            await loadKeys();
        } catch (err) {
            toast.error(t('apiReview.error_title'), t('apiAdmin.error_regenerate'), resolveErrorId(err, 'AdminApiPage.regenerate'));
        }
    };

    const patchKey = async (id: string, patch: Record<string, unknown>) => {
        try {
            const res = await fetch(`/api/admin/api-keys/${id}`, {
                method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
            });
            if (!res.ok) throw await failure(res, 'update');
            await loadKeys();
        } catch (err) {
            toast.error(t('apiReview.error_title'), t('apiAdmin.error_update'), resolveErrorId(err, 'AdminApiPage.patchKey'));
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
            <header>
                <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">{t('apiAdmin.title')}</h1>
                <p className="text-sm text-stone-500 mt-1">
                    {t('apiAdmin.subtitle')}{' '}
                    <a className="text-teal-700 underline underline-offset-2" href="/api/v1/docs" target="_blank" rel="noreferrer">{t('apiReview.docs_link')}</a>
                </p>
            </header>

            {secret && (
                <div className="rounded-xl p-4 border" style={{ background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)' }} data-testid="api-new-secret">
                    <p className="text-sm font-semibold" style={{ color: 'var(--status-warning-text)' }}>{secret.regenerated ? t('apiAdmin.regenerated_once') : t('apiAdmin.secret_once')} ({secret.name})</p>
                    <code className="block mt-2 text-sm break-all select-all">{secret.value}</code>
                    <div className="mt-2 flex gap-3">
                        <button type="button" className="text-sm underline underline-offset-2 py-1" onClick={() => { void navigator.clipboard?.writeText(secret.value); toast.success(t('apiAdmin.copied')); }}>{t('apiAdmin.copy')}</button>
                        <button type="button" className="text-sm underline underline-offset-2 py-1" onClick={() => setSecret(null)}>{t('apiAdmin.done')}</button>
                    </div>
                </div>
            )}

            <section className={card}>
                <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-3">{t('apiAdmin.issue_title')}</h2>
                <form onSubmit={issue} className="flex flex-wrap gap-2 items-start">
                    <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600">
                        {t('apiAdmin.owner_email')}
                        <RescuerEmailPicker value={ownerEmail} onChange={setOwnerEmail} inputClassName={input} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600 max-w-xs">
                        {t('apiAdmin.key_name')}
                        <input className={input} required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder={t('apiAdmin.key_name_placeholder')} aria-describedby="api-key-name-hint" />
                        <span id="api-key-name-hint" className="font-normal text-stone-500">{t('apiAdmin.key_name_hint')}</span>
                    </label>
                    <button type="submit" disabled={issuing} className="text-sm font-bold rounded-xl px-4 py-2 disabled:opacity-40 self-start mt-5" style={primaryBtn}>
                        {t('apiAdmin.issue')}
                    </button>
                </form>
            </section>

            <section className={card}>
                <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-3">{t('apiAdmin.keys_title')}</h2>
                {keys.length === 0 && <p className="text-sm text-stone-500">{t('apiAdmin.no_keys')}</p>}
                <ul className="divide-y divide-stone-100 dark:divide-stone-700" data-testid="api-keys">
                    {keys.map(k => (
                        <li key={k.id} className="py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-2">
                            <div className="min-w-0">
                                <p className="font-semibold text-stone-800 dark:text-stone-200">{k.name} <span className="font-mono text-xs text-stone-500">{k.prefix}…</span></p>
                                <p className="text-xs text-stone-500 break-all">{k.ownerEmail} · {k.environment} · {k.scopes.join(', ')}{k.selfService ? ` · ${t('apiAdmin.self_service')}` : ''}</p>
                                <p className="text-xs text-stone-500">
                                    {t('apiReview.used_today')}: {k.usedToday.exact}/{k.dailyCapExact} exact · {k.usedToday.fuzzy}/{k.dailyCapFuzzy} fuzzy
                                    {k.lastUsedAt ? ` · ${t('apiReview.last_used')} ${new Date(k.lastUsedAt).toLocaleString()}` : ''}
                                </p>
                                {k.last30 && (
                                    <p className="text-xs text-stone-500" data-testid="api-key-stats">
                                        {t('apiAdmin.stats_30d').replace('{activities}', String(k.last30.activities)).replace('{voided}', String(k.last30.voided))}
                                        {isManyVoids(k.last30) && (
                                            <span className="ml-2 px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' }}>
                                                {t('apiAdmin.many_voids')}
                                            </span>
                                        )}
                                    </p>
                                )}
                            </div>
                            {k.revokedAt ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-semibold">{t('apiAdmin.revoked')}</span>
                            ) : (
                                <div className="flex flex-wrap items-center gap-2 ml-auto">
                                    <label className="text-xs text-stone-600 flex items-center gap-1">exact
                                        <input className={`${input} w-24`} type="number" min={0} defaultValue={k.dailyCapExact}
                                            onBlur={e => Number(e.target.value) !== k.dailyCapExact && patchKey(k.id, { dailyCapExact: Number(e.target.value) })} />
                                    </label>
                                    <label className="text-xs text-stone-600 flex items-center gap-1">fuzzy
                                        <input className={`${input} w-24`} type="number" min={0} defaultValue={k.dailyCapFuzzy}
                                            onBlur={e => Number(e.target.value) !== k.dailyCapFuzzy && patchKey(k.id, { dailyCapFuzzy: Number(e.target.value) })} />
                                    </label>
                                    {confirm?.id === k.id ? (
                                        <span className="inline-flex flex-wrap items-center gap-2">
                                            <span className="text-xs text-stone-600">{confirm.action === 'revoke' ? t('apiAdmin.revoke_confirm') : t('apiAdmin.regenerate_confirm')}</span>
                                            <button type="button" className="text-xs font-bold rounded-xl px-3 py-1 border"
                                                style={{ background: 'var(--status-error-bg)', color: 'var(--status-error-text)', borderColor: 'var(--status-error-border)' }}
                                                onClick={() => { const c = confirm; setConfirm(null); if (c.action === 'revoke') void patchKey(k.id, { revoke: true }); else void regenerate(k); }}>
                                                {confirm.action === 'revoke' ? t('apiAdmin.revoke_yes') : t('apiAdmin.regenerate_yes')}
                                            </button>
                                            <button type="button" className="text-xs underline py-1" onClick={() => setConfirm(null)}>{t('apiReview.void_no')}</button>
                                        </span>
                                    ) : (
                                        <>
                                            <button type="button" className="text-xs text-teal-700 underline underline-offset-2 py-1" onClick={() => setConfirm({ id: k.id, action: 'regenerate' })}>{t('apiAdmin.regenerate')}</button>
                                            <button type="button" className="text-xs text-red-700 underline underline-offset-2 py-1" onClick={() => setConfirm({ id: k.id, action: 'revoke' })}>{t('apiAdmin.revoke')}</button>
                                        </>
                                    )}
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </section>

            <ApiDemoPeople className={card} />

            <section className={card}>
                <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-3">{t('apiReview.transactions_title')}</h2>
                <ApiTransactionList
                    listUrl="/api/admin/api-requests"
                    detailUrl={id => `/api/admin/api-requests/${id}`}
                    voidUrl={id => `/api/admin/api-requests/${id}/void`}
                    showOwner
                    keys={keys.map(k => ({ id: k.id, name: `${k.name} (${k.ownerEmail})` }))}
                />
            </section>
        </div>
    );
}
