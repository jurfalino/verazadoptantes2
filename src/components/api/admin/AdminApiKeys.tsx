'use client';

/**
 * Admin → API → Keys (and a person's keys in People): issue a key, filter the
 * list, change a key's daily limits (explicit Save — an emptied box never
 * becomes 0), revoke, regenerate (only keys an admin issued: a self-created
 * key's secret is its owner's, regenerated at /developers).
 */
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { failure } from '../ApiTransactionList';
import RescuerEmailPicker from '../RescuerEmailPicker';

export interface KeyView {
    id: string; name: string; ownerEmail: string; prefix: string; environment: string; scopes: string[];
    dailyCapExact: number; dailyCapFuzzy: number; usedToday: { exact: number; fuzzy: number };
    last30?: { activities: number; voided: number };
    createdAt: string | null; lastUsedAt: string | null; revokedAt: string | null; revokedBy?: string | null;
    selfService?: boolean;
    canRegenerate?: boolean;
    importModeUntil?: string | null;
}

export const card = 'bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 p-6';
export const input = 'text-sm rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2';
export const primaryBtn = { background: 'var(--btn-primary-bg)', color: 'white' };

/** Search-then-void: a key that voids a lot of what it saves is looking people up without leaving a trace. */
export function isManyVoids(s: { activities: number; voided: number }): boolean {
    return s.voided >= 3 && s.voided / Math.max(1, s.activities) >= 0.2;
}

type KeyFilter = 'all' | 'active' | 'revoked' | 'self' | 'admin';
const PAGE = 50;

function KeyRow({ k, onPatch, onRegenerate }: { k: KeyView; onPatch: (id: string, patch: Record<string, unknown>) => Promise<boolean>; onRegenerate: (k: KeyView) => void }) {
    const { t } = useLanguage();
    const [exact, setExact] = useState(String(k.dailyCapExact));
    const [fuzzy, setFuzzy] = useState(String(k.dailyCapFuzzy));
    const [confirm, setConfirm] = useState<'revoke' | 'regenerate' | null>(null);
    useEffect(() => { setExact(String(k.dailyCapExact)); setFuzzy(String(k.dailyCapFuzzy)); }, [k.dailyCapExact, k.dailyCapFuzzy]);
    const valid = (v: string) => v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 0;
    const changed = exact !== String(k.dailyCapExact) || fuzzy !== String(k.dailyCapFuzzy);
    const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString() : '');
    return (
        <li className="py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0">
                <p className="font-semibold text-stone-800 dark:text-stone-200">{k.name} <span className="font-mono text-xs text-stone-500">{k.prefix}…</span></p>
                <p className="text-xs text-stone-500 break-all">
                    {k.ownerEmail} · {k.environment} · {k.scopes.join(', ')}{k.selfService ? ` · ${t('apiAdmin.self_service')}` : ''} · {t('apiAdmin.created')} {date(k.createdAt)}
                </p>
                <p className="text-xs text-stone-500">
                    {t('apiReview.used_today')}: {k.usedToday.exact}/{k.dailyCapExact} exact · {k.usedToday.fuzzy}/{k.dailyCapFuzzy} fuzzy
                    {k.lastUsedAt ? ` · ${t('apiReview.last_used')} ${new Date(k.lastUsedAt).toLocaleString()}` : ''}
                </p>
                {k.importModeUntil && !k.revokedAt && (
                    <p className="text-xs font-semibold" style={{ color: 'var(--status-warning-text)' }} data-testid="api-key-import-mode">
                        {t('apiAdmin.import_mode_until').replace('{when}', new Date(k.importModeUntil).toLocaleString())}
                    </p>
                )}
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
                <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-semibold">
                    {t('apiAdmin.revoked')} {date(k.revokedAt)}{k.revokedBy ? ` · ${k.revokedBy === k.ownerEmail ? t('apiAdmin.revoked_by_owner') : k.revokedBy}` : ''}
                </span>
            ) : (
                <div className="flex flex-wrap items-center gap-2 ml-auto">
                    <label className="text-xs text-stone-600 flex items-center gap-1">{t('apiAdmin.caps_exact')}
                        <input className={`${input} w-24`} type="number" min={0} value={exact} onChange={e => setExact(e.target.value)} />
                    </label>
                    <label className="text-xs text-stone-600 flex items-center gap-1">{t('apiAdmin.caps_fuzzy')}
                        <input className={`${input} w-24`} type="number" min={0} value={fuzzy} onChange={e => setFuzzy(e.target.value)} />
                    </label>
                    {changed && (
                        <button type="button" disabled={!valid(exact) || !valid(fuzzy)} className="text-xs font-bold rounded-xl px-3 py-1 disabled:opacity-40" style={primaryBtn}
                            onClick={async () => { if (await onPatch(k.id, { dailyCapExact: Number(exact), dailyCapFuzzy: Number(fuzzy) })) setConfirm(null); }} data-testid="api-key-caps-save">
                            {t('apiAdmin.caps_save')}
                        </button>
                    )}
                    {confirm ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                            <span className="text-xs text-stone-600">{confirm === 'revoke' ? t('apiAdmin.revoke_confirm') : t('apiAdmin.regenerate_confirm')}</span>
                            <button type="button" className="text-xs font-bold rounded-xl px-3 py-1 border"
                                style={{ background: 'var(--status-error-bg)', color: 'var(--status-error-text)', borderColor: 'var(--status-error-border)' }}
                                onClick={() => { const c = confirm; setConfirm(null); if (c === 'revoke') void onPatch(k.id, { revoke: true }); else onRegenerate(k); }}>
                                {confirm === 'revoke' ? t('apiAdmin.revoke_yes') : t('apiAdmin.regenerate_yes')}
                            </button>
                            <button type="button" className="text-xs underline py-1" onClick={() => setConfirm(null)}>{t('apiReview.void_no')}</button>
                        </span>
                    ) : (
                        <>
                            {k.canRegenerate === false
                                ? <span className="text-xs text-stone-500" title={t('apiAdmin.regenerate_self_hint')}>{t('apiAdmin.regenerate_self_short')}</span>
                                : <button type="button" className="text-xs text-teal-700 underline underline-offset-2 py-1" onClick={() => setConfirm('regenerate')}>{t('apiAdmin.regenerate')}</button>}
                            <button type="button" className="text-xs text-red-700 underline underline-offset-2 py-1" onClick={() => setConfirm('revoke')}>{t('apiAdmin.revoke')}</button>
                        </>
                    )}
                </div>
            )}
        </li>
    );
}

export default function AdminApiKeys({ owner = null, onChange }: { owner?: string | null; onChange?: () => void }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [keys, setKeys] = useState<KeyView[] | null>(null);
    const [filter, setFilter] = useState<KeyFilter>('all');
    const [page, setPage] = useState(1);
    const [ownerEmail, setOwnerEmail] = useState(owner ?? '');
    const [name, setName] = useState('');
    const [issuing, setIssuing] = useState(false);
    const [secret, setSecret] = useState<{ value: string; name: string; regenerated?: boolean } | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/api-keys');
            if (!res.ok) throw await failure(res, 'keys');
            const all = (await res.json() as { keys: KeyView[] }).keys;
            setKeys(owner ? all.filter(k => k.ownerEmail === owner) : all);
        } catch (e) {
            toast.error(t('apiReview.error_title'), t('apiReview.error_load'), resolveErrorId(e, 'AdminApiKeys.load'));
        }
    }, [owner, t, toast]);
    useEffect(() => { void load(); }, [load]);

    const issue = async (e: React.FormEvent) => {
        e.preventDefault();
        setIssuing(true);
        try {
            const res = await fetch('/api/admin/api-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerEmail, name }) });
            if (res.status === 404) { toast.warning(t('apiAdmin.unknown_owner_title'), t('apiAdmin.unknown_owner_body')); return; }
            if (res.status === 409) { toast.warning(t('apiAdmin.blocked_owner_title'), t('apiAdmin.blocked_owner_body')); return; }
            if (!res.ok) throw await failure(res, 'issue');
            const issued = await res.json() as { secret: string };
            setSecret({ value: issued.secret, name });
            if (!owner) setOwnerEmail('');
            setName('');
            await load(); onChange?.();
        } catch (err) {
            toast.error(t('apiReview.error_title'), t('apiAdmin.error_issue'), resolveErrorId(err, 'AdminApiKeys.issue'));
        } finally { setIssuing(false); }
    };

    const regenerate = async (k: KeyView) => {
        try {
            const res = await fetch(`/api/admin/api-keys/${k.id}/regenerate`, { method: 'POST' });
            if (!res.ok) throw await failure(res, 'regenerate');
            const done = await res.json() as { secret: string };
            setSecret({ value: done.secret, name: k.name, regenerated: true });
            await load();
        } catch (err) {
            toast.error(t('apiReview.error_title'), t('apiAdmin.error_regenerate'), resolveErrorId(err, 'AdminApiKeys.regenerate'));
        }
    };

    const patchKey = async (id: string, patch: Record<string, unknown>): Promise<boolean> => {
        try {
            const res = await fetch(`/api/admin/api-keys/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
            if (!res.ok) throw await failure(res, 'update');
            if (!('revoke' in patch)) toast.success(t('apiAdmin.caps_saved'));
            await load(); onChange?.();
            return true;
        } catch (err) {
            toast.error(t('apiReview.error_title'), t('apiAdmin.error_update'), resolveErrorId(err, 'AdminApiKeys.patchKey'));
            return false;
        }
    };

    const shown = (keys ?? []).filter(k => filter === 'all' ? true : filter === 'active' ? !k.revokedAt : filter === 'revoked' ? !!k.revokedAt : filter === 'self' ? k.selfService : !k.selfService);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    const current = Math.min(page, pages);

    return (
        <div className="space-y-4">
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

            <section className={owner ? '' : card}>
                <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-3">{t('apiAdmin.keys_title')}</h2>
                {!owner && (
                    <div className="flex flex-wrap gap-2 mb-3">
                        <select className={input} value={filter} onChange={e => { setFilter(e.target.value as KeyFilter); setPage(1); }} aria-label={t('apiAdmin.keys_title')} data-testid="api-keys-filter">
                            {(['all', 'active', 'revoked', 'self', 'admin'] as KeyFilter[]).map(f => <option key={f} value={f}>{t(`apiAdmin.filter_keys_${f}`)}</option>)}
                        </select>
                    </div>
                )}
                {keys === null && <p className="text-sm text-stone-500">{t('apiAdmin.loading')}</p>}
                {keys !== null && shown.length === 0 && <p className="text-sm text-stone-500">{t('apiAdmin.no_keys')}</p>}
                <ul className="divide-y divide-stone-100 dark:divide-stone-700" data-testid="api-keys">
                    {shown.slice((current - 1) * PAGE, current * PAGE).map(k => <KeyRow key={k.id} k={k} onPatch={patchKey} onRegenerate={regenerate} />)}
                </ul>
                {pages > 1 && (
                    <div className="flex items-center gap-3 mt-3 text-sm">
                        <button type="button" disabled={current <= 1} className="underline disabled:opacity-40" onClick={() => setPage(current - 1)}>{t('apiAdmin.prev')}</button>
                        <span className="text-stone-500">{t('apiAdmin.page_x_of_y').replace('{x}', String(current)).replace('{y}', String(pages))}</span>
                        <button type="button" disabled={current >= pages} className="underline disabled:opacity-40" onClick={() => setPage(current + 1)}>{t('apiAdmin.next')}</button>
                    </div>
                )}
            </section>

            <section className={owner ? '' : card}>
                <h2 className="text-base font-semibold text-stone-800 dark:text-stone-200 mb-3">{t('apiAdmin.issue_title')}</h2>
                <form onSubmit={issue} className="flex flex-wrap gap-2 items-start">
                    {!owner && (
                        <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600">
                            {t('apiAdmin.owner_email')}
                            <RescuerEmailPicker value={ownerEmail} onChange={setOwnerEmail} inputClassName={input} />
                        </label>
                    )}
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
        </div>
    );
}
