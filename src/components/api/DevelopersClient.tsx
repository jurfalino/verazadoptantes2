'use client';

/**
 * /developers: what the API is for, the docs, and — for a signed-in user — the
 * API terms (once), their keys (create, regenerate, revoke; the secret shown
 * once) and their calls. Everything goes through /api/my-api/* (own keys only).
 */
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import ApiTransactionList, { failure } from './ApiTransactionList';

interface MyKey {
    id: string; name: string; prefix: string; environment: string; selfService?: boolean;
    dailyCapExact: number; dailyCapFuzzy: number; usedToday: { exact: number; fuzzy: number };
    createdAt: string | null; lastUsedAt: string | null; revokedAt: string | null;
}
interface DevState {
    termsAccepted: boolean; environment: 'live' | 'test';
    caps: { exact: number; fuzzy: number }; maxActiveKeys: number; keys: MyKey[];
}

const card = 'rounded-2xl border p-6';
const cardStyle = { background: 'var(--surface-card)', borderColor: 'var(--border-default)' };
const primary = { background: 'var(--btn-primary-bg)', color: 'white' };

export default function DevelopersClient() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const { status } = useSession();
    const [state, setState] = useState<DevState | null>(null);
    const [agree, setAgree] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [secret, setSecret] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<{ id: string; action: 'revoke' | 'regenerate' } | null>(null);

    const fail = useCallback((e: unknown, where: string) => {
        toast.error(t('developers.error'), t('developers.error_body'), resolveErrorId(e, `DevelopersClient.${where}`));
    }, [t, toast]);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/my-api/keys');
            if (!res.ok) throw await failure(res, 'my-api/keys');
            setState(await res.json() as DevState);
        } catch (e) { fail(e, 'load'); }
    }, [fail]);

    useEffect(() => { if (status === 'authenticated') void load(); }, [status, load]);

    const fill = (s: string) => s.replace('{max}', String(state?.maxActiveKeys ?? 3))
        .replace('{exact}', String(state?.caps.exact ?? 100)).replace('{fuzzy}', String(state?.caps.fuzzy ?? 50));

    const acceptTerms = async () => {
        setBusy(true);
        try {
            const res = await fetch('/api/my-api/terms', { method: 'POST' });
            if (!res.ok) throw await failure(res, 'my-api/terms');
            await load();
        } catch (e) { fail(e, 'terms'); } finally { setBusy(false); }
    };

    const createKey = async () => {
        setBusy(true);
        try {
            const res = await fetch('/api/my-api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
            if (res.status === 409) { toast.error(t('developers.error'), fill(t('developers.too_many_keys'))); return; }
            if (!res.ok) throw await failure(res, 'my-api/keys create');
            setSecret((await res.json() as { secret: string }).secret);
            setName('');
            await load();
        } catch (e) { fail(e, 'create'); } finally { setBusy(false); }
    };

    const act = async (id: string, action: 'revoke' | 'regenerate') => {
        setBusy(true);
        setConfirm(null);
        try {
            const res = await fetch(`/api/my-api/keys/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
            if (!res.ok) throw await failure(res, `my-api/keys ${action}`);
            if (action === 'regenerate') setSecret((await res.json() as { secret: string }).secret);
            await load();
        } catch (e) { fail(e, action); } finally { setBusy(false); }
    };

    // The limit counts only keys they created here (an admin-issued key doesn't use it up).
    const activeKeys = state?.keys.filter(k => !k.revokedAt && k.selfService).length ?? 0;
    const date = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '');

    return (
        <main className="max-w-3xl mx-auto px-4 py-10 space-y-6" data-testid="developers-page">
            <header className="space-y-3">
                <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{t('developers.title')}</h1>
                <p className="text-base" style={{ color: 'var(--text-secondary)' }}>{t('developers.intro')}</p>
                <a href="/api/v1/docs" target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold rounded-xl px-6 py-3" style={primary}>
                    {t('developers.docs')} →
                </a>
            </header>

            {status === 'unauthenticated' && (
                <section className={card} style={cardStyle} data-testid="developers-sign-in">
                    <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t('developers.sign_in_title')}</h2>
                    <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>{t('developers.sign_in_body')}</p>
                    <a href={`/?callbackUrl=${encodeURIComponent('/developers')}&authRequired=true`} className="inline-block text-sm font-semibold rounded-xl px-6 py-3" style={primary}>
                        {t('developers.sign_in')}
                    </a>
                </section>
            )}

            {state && (
                <p className="text-sm rounded-xl px-4 py-3 border" style={{ background: 'var(--status-info-bg)', borderColor: 'var(--status-info-border)', color: 'var(--text-primary)' }} data-testid="developers-env">
                    {state.environment === 'test' ? t('developers.env_test') : t('developers.env_live')}
                </p>
            )}

            {state && !state.termsAccepted && (
                <section className={card} style={cardStyle} data-testid="developers-terms">
                    <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{t('developers.terms_title')}</h2>
                    <ul className="list-disc pl-5 space-y-1 text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                        {[1, 2, 3, 4, 5, 6].map(n => <li key={n}>{t(`developers.terms_${n}`)}</li>)}
                    </ul>
                    <label className="flex items-center gap-2 text-sm mb-4" style={{ color: 'var(--text-primary)' }}>
                        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} data-testid="developers-terms-check" />
                        {t('developers.terms_accept')}
                    </label>
                    <button type="button" disabled={!agree || busy} onClick={acceptTerms} className="text-sm font-semibold rounded-xl px-6 py-3 disabled:opacity-40" style={primary} data-testid="developers-terms-accept">
                        {t('developers.terms_button')}
                    </button>
                </section>
            )}

            {secret && (
                <section className={card} style={{ background: 'var(--status-success-bg)', borderColor: 'var(--status-success-border)' }} data-testid="developers-secret">
                    <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--status-success-text)' }}>{t('developers.secret_title')}</h2>
                    <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{t('developers.secret_body')}</p>
                    <code className="block break-all text-sm font-mono rounded-lg px-3 py-2 mb-3" style={{ background: 'var(--surface-card)', color: 'var(--text-primary)' }} data-testid="developers-secret-value">{secret}</code>
                    <div className="flex flex-wrap gap-3">
                        <button type="button" className="text-sm font-semibold rounded-xl px-4 py-2" style={primary}
                            onClick={() => { void navigator.clipboard?.writeText(secret); toast.success(t('developers.copied')); }}>{t('developers.copy')}</button>
                        <button type="button" className="text-sm underline underline-offset-2" style={{ color: 'var(--text-secondary)' }} onClick={() => setSecret(null)}>{t('developers.done')}</button>
                    </div>
                </section>
            )}

            {state?.termsAccepted && (
                <section className={card} style={cardStyle} data-testid="developers-keys">
                    <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t('developers.keys_title')}</h2>
                    <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>{fill(t('developers.limits'))}</p>
                    {state.keys.length === 0 && <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>{t('developers.none')}</p>}
                    <ul className="space-y-3 mb-5">
                        {state.keys.map(k => (
                            <li key={k.id} className="text-sm" data-testid="developers-key">
                                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{k.name}</span>{' '}
                                <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{k.prefix}…</span>
                                {k.revokedAt
                                    ? <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-semibold">{t('developers.revoked')}</span>
                                    : <>
                                        <span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>
                                            {t('developers.used_today')}: {k.usedToday.exact}/{k.dailyCapExact} exact · {k.usedToday.fuzzy}/{k.dailyCapFuzzy} fuzzy
                                            {' · '}{t('developers.created')} {date(k.createdAt)}
                                            {' · '}{k.lastUsedAt ? `${t('developers.last_used')} ${date(k.lastUsedAt)}` : t('developers.never_used')}
                                        </span>
                                        {confirm?.id === k.id ? (
                                            <span className="flex flex-wrap items-center gap-3 mt-1 text-xs">
                                                <span style={{ color: 'var(--text-primary)' }}>{confirm.action === 'revoke' ? t('developers.confirm_revoke') : t('developers.confirm_regenerate')}</span>
                                                <button type="button" disabled={busy} className="font-semibold underline underline-offset-2 py-1" onClick={() => act(k.id, confirm.action)} data-testid="developers-confirm">{t('developers.confirm')}</button>
                                                <button type="button" className="underline underline-offset-2 py-1" onClick={() => setConfirm(null)}>{t('developers.cancel')}</button>
                                            </span>
                                        ) : (
                                            <span className="flex gap-4 mt-1 text-xs">
                                                <button type="button" className="text-teal-700 underline underline-offset-2 py-1" onClick={() => setConfirm({ id: k.id, action: 'regenerate' })}>{t('developers.regenerate')}</button>
                                                <button type="button" className="text-red-700 underline underline-offset-2 py-1" onClick={() => setConfirm({ id: k.id, action: 'revoke' })} data-testid="developers-revoke">{t('developers.revoke')}</button>
                                            </span>
                                        )}
                                    </>}
                            </li>
                        ))}
                    </ul>
                    {activeKeys < state.maxActiveKeys ? (
                        <div className="flex flex-wrap items-end gap-3">
                            <label className="flex-1 min-w-[200px] text-sm" style={{ color: 'var(--text-primary)' }}>
                                {t('developers.name_label')}
                                <input value={name} onChange={e => setName(e.target.value)} placeholder={t('developers.name_placeholder')} maxLength={80}
                                    className="mt-1 w-full text-sm rounded-xl border px-3 py-2" style={{ background: 'var(--surface-card)', borderColor: 'var(--border-default)' }} data-testid="developers-key-name" />
                            </label>
                            <button type="button" disabled={busy || !name.trim()} onClick={createKey} className="text-sm font-semibold rounded-xl px-6 py-3 disabled:opacity-40" style={primary} data-testid="developers-create">
                                {busy ? t('developers.creating') : t('developers.create')}
                            </button>
                        </div>
                    ) : (
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{fill(t('developers.too_many_keys'))}</p>
                    )}
                </section>
            )}

            {state?.termsAccepted && state.keys.length > 0 && (
                <section className={card} style={cardStyle}>
                    <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{t('developers.calls_title')}</h2>
                    <ApiTransactionList
                        listUrl="/api/my-api"
                        detailUrl={id => `/api/my-api/requests/${id}`}
                        voidUrl={id => `/api/my-api/requests/${id}/void`}
                        showOwner={false}
                        keys={state.keys.map(k => ({ id: k.id, name: k.name }))}
                    />
                </section>
            )}
        </main>
    );
}
