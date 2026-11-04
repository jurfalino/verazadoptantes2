'use client';

/**
 * Admin → API → People: everyone who asked for API access or holds a key —
 * filter by access status / badge, search by name or email, sort, 50 a page.
 * Opening a person shows their access request with approve / deny / block,
 * 30 days of use, the people they searched (audited), their keys and calls.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import ApiTransactionList, { failure } from '../ApiTransactionList';
import AdminApiKeys, { card, input, primaryBtn } from './AdminApiKeys';

type Status = 'none' | 'requested' | 'approved' | 'denied' | 'blocked';
interface PersonRow {
    email: string; name: string | null; access: Status; tool: string | null; requestedAt: string | null; activeKeys: number;
    last30: { exact: number; fuzzy: number; saved: number; voided: number; errors: number }; fuzzy7d: number;
    badges: Array<'heavy_fuzzy' | 'many_voids'>;
}
interface Searched { fullName: string | null; email: string | null; phone: string | null; documentId: string | null }
interface Detail {
    email: string; name: string | null;
    access: { status: Status; tool: string | null; purpose: string | null; requestedAt: string | null; decidedAt: string | null; decidedBy: string | null; note: string | null };
    daily: Array<{ day: string; exact: number; fuzzy: number; errors: number }>;
    searches: Array<{ requestId: string; createdAt: string | null; mode: string | null; outcome: string | null; httpStatus: number; dryRun: boolean; searched: Searched | null }>;
    nextBefore: string | null;
}

const STATUS_STYLE: Record<Status, React.CSSProperties> = {
    none: { background: 'var(--surface-muted, #f5f5f4)', color: 'var(--text-secondary, #57534e)' },
    requested: { background: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' },
    approved: { background: 'var(--status-success-bg)', color: 'var(--status-success-text)' },
    denied: { background: 'var(--surface-muted, #f5f5f4)', color: 'var(--text-secondary, #57534e)' },
    blocked: { background: 'var(--status-error-bg)', color: 'var(--status-error-text)' },
};

export function StatusPill({ status }: { status: Status }) {
    const { t } = useLanguage();
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={STATUS_STYLE[status]} data-testid="api-access-status">{t(`apiAdmin.access_${status}`)}</span>;
}

function Badges({ badges }: { badges: PersonRow['badges'] }) {
    const { t } = useLanguage();
    return <>{badges.map(b => (
        <span key={b} className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' }}>{t(`apiAdmin.badge_${b}`)}</span>
    ))}</>;
}

const searchedLine = (s: Searched | null) => s ? [s.fullName, s.email, s.phone, s.documentId].filter(Boolean).join(' · ') : '';

/** 30 bars, one per day (exact + fuzzy stacked), so a sudden burst of lookups stands out. */
function DailyChart({ daily }: { daily: Detail['daily'] }) {
    const { t } = useLanguage();
    const byDay = new Map(daily.map(d => [d.day, d]));
    const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10));
    const max = Math.max(1, ...daily.map(d => d.exact + d.fuzzy));
    return (
        <div>
            <div className="flex items-end gap-[2px] h-24" role="img" aria-label={t('apiAdmin.daily_title')} data-testid="api-person-chart">
                {days.map(day => {
                    const d = byDay.get(day);
                    const ex = d?.exact ?? 0, fz = d?.fuzzy ?? 0;
                    return (
                        <div key={day} className="flex-1 flex flex-col justify-end h-full" title={`${day}: ${ex} exact · ${fz} fuzzy${d?.errors ? ` · ${d.errors} ${t('apiAdmin.errors')}` : ''}`}>
                            <div style={{ height: `${(fz / max) * 100}%`, background: 'var(--status-warning-text)' }} />
                            <div style={{ height: `${(ex / max) * 100}%`, background: 'var(--btn-primary-bg)' }} />
                        </div>
                    );
                })}
            </div>
            <p className="text-xs text-stone-500 mt-1 flex gap-3">
                <span><span className="inline-block w-2 h-2 mr-1" style={{ background: 'var(--btn-primary-bg)' }} />exact</span>
                <span><span className="inline-block w-2 h-2 mr-1" style={{ background: 'var(--status-warning-text)' }} />fuzzy</span>
            </p>
        </div>
    );
}

function PersonDetail({ email, onBack, onChanged }: { email: string; onBack: () => void; onChanged: () => void }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [d, setD] = useState<Detail | null>(null);
    const [more, setMore] = useState(false);
    const [note, setNote] = useState('');
    const [confirmBlock, setConfirmBlock] = useState(false);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/api-people/${encodeURIComponent(email)}`);
            if (!res.ok) throw await failure(res, 'person');
            setD(await res.json() as Detail);
        } catch (e) {
            toast.error(t('apiReview.error_title'), t('apiReview.error_load'), resolveErrorId(e, 'AdminApiPeople.detail'));
        }
    }, [email, t, toast]);
    useEffect(() => { void load(); }, [load]);

    const loadMore = async () => {
        if (!d?.nextBefore) return;
        setMore(true);
        try {
            const res = await fetch(`/api/admin/api-people/${encodeURIComponent(email)}?before=${encodeURIComponent(d.nextBefore)}`);
            if (!res.ok) throw await failure(res, 'person');
            const next = await res.json() as Detail;
            setD(cur => cur ? { ...cur, searches: [...cur.searches, ...next.searches], nextBefore: next.nextBefore } : next);
        } catch (e) {
            toast.error(t('apiReview.error_title'), t('apiReview.error_load'), resolveErrorId(e, 'AdminApiPeople.loadMore'));
        } finally { setMore(false); }
    };

    const decide = async (decision: 'approve' | 'deny' | 'block' | 'unblock') => {
        setBusy(true); setConfirmBlock(false);
        try {
            const res = await fetch(`/api/admin/api-people/${encodeURIComponent(email)}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, note: note || null }),
            });
            if (!res.ok) throw await failure(res, 'decision');
            const done = await res.json() as { keysRevoked: number };
            toast.success(t(`apiAdmin.decided_${decision}`), decision === 'block' ? t('apiAdmin.keys_revoked_n').replace('{n}', String(done.keysRevoked)) : undefined);
            setNote('');
            await load(); onChanged();
        } catch (e) {
            toast.error(t('apiReview.error_title'), t('apiAdmin.error_decision'), resolveErrorId(e, 'AdminApiPeople.decide'));
        } finally { setBusy(false); }
    };

    if (!d) return <p className="text-sm text-stone-500">{t('apiAdmin.loading')}</p>;
    const a = d.access;
    const btn = 'text-sm font-semibold rounded-xl px-4 py-2 border disabled:opacity-40';
    return (
        <div className="space-y-4" data-testid="api-person">
            <button type="button" onClick={onBack} className="text-sm text-teal-700 underline underline-offset-2 py-1">← {t('apiAdmin.back_to_people')}</button>

            <section className={card}>
                <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 break-all">{d.name ? `${d.name} · ` : ''}{d.email}</h2>
                    <StatusPill status={a.status} />
                </div>
                {(a.tool || a.purpose) && (
                    <dl className="mt-3 text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        {a.tool && <><dt className="text-stone-500">{t('developers.tool_label')}</dt><dd className="break-words">{a.tool}</dd></>}
                        {a.purpose && <><dt className="text-stone-500">{t('developers.purpose_label')}</dt><dd className="break-words whitespace-pre-line">{a.purpose}</dd></>}
                        {a.requestedAt && <><dt className="text-stone-500">{t('apiAdmin.requested_on')}</dt><dd>{new Date(a.requestedAt).toLocaleString()}</dd></>}
                    </dl>
                )}
                {a.decidedBy && (
                    <p className="text-xs text-stone-500 mt-2">
                        {t('apiAdmin.decided_by').replace('{who}', a.decidedBy).replace('{when}', a.decidedAt ? new Date(a.decidedAt).toLocaleString() : '')}
                        {a.note ? ` — «${a.note}»` : ''}
                    </p>
                )}
                {a.status !== 'approved' && a.status !== 'blocked' && (
                    <p className="text-xs mt-3" style={{ color: 'var(--text-secondary)' }} data-testid="api-person-limits-hint">{t('apiAdmin.approve_raises_limits')}</p>
                )}
                <div className="mt-4 flex flex-col gap-2">
                    <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1 max-w-lg">
                        {t('apiAdmin.decision_note')}
                        <input className={input} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder={t('apiAdmin.decision_note_placeholder')} data-testid="api-decision-note" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {a.status !== 'approved' && a.status !== 'blocked' && (
                            <button type="button" disabled={busy} className={btn} style={primaryBtn} onClick={() => decide('approve')} data-testid="api-access-approve">{t('apiAdmin.approve')}</button>
                        )}
                        {a.status === 'requested' && (
                            <button type="button" disabled={busy} className={btn} onClick={() => decide('deny')} data-testid="api-access-deny">{t('apiAdmin.deny')}</button>
                        )}
                        {a.status === 'blocked' ? (
                            <button type="button" disabled={busy} className={btn} onClick={() => decide('unblock')} data-testid="api-access-unblock">{t('apiAdmin.unblock')}</button>
                        ) : confirmBlock ? (
                            <span className="inline-flex flex-wrap items-center gap-2">
                                <span className="text-sm text-stone-600">{t('apiAdmin.block_confirm')}</span>
                                <button type="button" disabled={busy} className={btn}
                                    style={{ background: 'var(--status-error-bg)', color: 'var(--status-error-text)', borderColor: 'var(--status-error-border)' }}
                                    onClick={() => decide('block')} data-testid="api-access-block-yes">{t('apiAdmin.block_yes')}</button>
                                <button type="button" className="text-sm underline py-1" onClick={() => setConfirmBlock(false)}>{t('apiReview.void_no')}</button>
                            </span>
                        ) : (
                            <button type="button" disabled={busy} className={`${btn} text-red-700`} onClick={() => setConfirmBlock(true)} data-testid="api-access-block">{t('apiAdmin.block')}</button>
                        )}
                    </div>
                </div>
            </section>

            <section className={card}>
                <h3 className="text-base font-semibold text-stone-800 dark:text-stone-200 mb-2">{t('apiAdmin.daily_title')}</h3>
                <DailyChart daily={d.daily} />
            </section>

            <section className={card}>
                <h3 className="text-base font-semibold text-stone-800 dark:text-stone-200 mb-1">{t('apiAdmin.searched_title')}</h3>
                <p className="text-xs text-stone-500 mb-2">{t('apiAdmin.searched_hint')}</p>
                {d.searches.length === 0 && <p className="text-sm text-stone-500">{t('apiAdmin.searched_none')}</p>}
                <ul className="divide-y divide-stone-100 dark:divide-stone-700" data-testid="api-person-searches">
                    {d.searches.map(s => (
                        <li key={s.requestId} className="py-2 text-sm flex flex-wrap gap-x-3 gap-y-1">
                            <span className="text-stone-500 tabular-nums">{s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}</span>
                            <span className="font-mono text-xs text-stone-500">{s.mode}</span>
                            <span className="break-words min-w-0 text-stone-800 dark:text-stone-200" data-testid="api-person-searched">{searchedLine(s.searched)}</span>
                            <span className="text-xs text-stone-500">{s.httpStatus >= 400 ? `HTTP ${s.httpStatus}` : s.outcome ? t(`apiReview.outcome_${s.outcome}`) : ''}{s.dryRun ? ` · ${t('apiReview.dry_run_badge')}` : ''}</span>
                        </li>
                    ))}
                </ul>
                {d.nextBefore && (
                    <button type="button" disabled={more} className="mt-2 text-sm underline underline-offset-2 disabled:opacity-40" onClick={loadMore}>{t('apiReview.load_more')}</button>
                )}
            </section>

            <section className={card}>
                <AdminApiKeys owner={d.email} onChange={load} />
            </section>

            <section className={card}>
                <h3 className="text-base font-semibold text-stone-800 dark:text-stone-200 mb-3">{t('apiReview.transactions_title')}</h3>
                <ApiTransactionList
                    listUrl="/api/admin/api-requests"
                    detailUrl={id => `/api/admin/api-requests/${id}`}
                    voidUrl={id => `/api/admin/api-requests/${id}/void`}
                    showOwner={false}
                    keys={[]}
                    advanced
                    owner={d.email}
                />
            </section>
        </div>
    );
}

export default function AdminApiPeople({ person, onOpen, initialStatus = '' }: { person: string | null; onOpen: (email: string | null) => void; initialStatus?: string }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [status, setStatus] = useState(initialStatus);
    const [badge, setBadge] = useState('');
    const [sort, setSort] = useState('fuzzy');
    const [query, setQuery] = useState('');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState<{ rows: PersonRow[]; total: number; page: number; pages: number } | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => { setStatus(initialStatus); setPage(1); }, [initialStatus]);

    useEffect(() => {
        if (person) return;
        (async () => {
            try {
                const p = new URLSearchParams({ sort, page: String(page) });
                if (status) p.set('status', status);
                if (badge) p.set('badge', badge);
                if (q.trim()) p.set('q', q.trim());
                const res = await fetch(`/api/admin/api-people?${p}`);
                if (!res.ok) throw await failure(res, 'people');
                setData(await res.json());
            } catch (e) {
                toast.error(t('apiReview.error_title'), t('apiReview.error_load'), resolveErrorId(e, 'AdminApiPeople.list'));
            }
        })();
    }, [person, status, badge, sort, q, page, tick, t, toast]);

    if (person) return <PersonDetail email={person} onBack={() => onOpen(null)} onChanged={() => setTick(n => n + 1)} />;

    return (
        <section className={card} data-testid="api-people">
            <form className="flex flex-wrap gap-2 mb-3" onSubmit={e => { e.preventDefault(); setQ(query); setPage(1); }}>
                <input className={`${input} flex-1 min-w-[200px]`} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('apiAdmin.people_search')} aria-label={t('apiAdmin.people_search')} data-testid="api-people-search" />
                <select className={input} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} aria-label={t('apiAdmin.filter_status')} data-testid="api-people-status">
                    <option value="">{t('apiAdmin.filter_all_statuses')}</option>
                    {(['requested', 'approved', 'denied', 'blocked', 'none'] as Status[]).map(s => <option key={s} value={s}>{t(`apiAdmin.access_${s}`)}</option>)}
                </select>
                <select className={input} value={badge} onChange={e => { setBadge(e.target.value); setPage(1); }} aria-label={t('apiAdmin.filter_badge')}>
                    <option value="">{t('apiAdmin.filter_all_badges')}</option>
                    <option value="heavy_fuzzy">{t('apiAdmin.badge_heavy_fuzzy')}</option>
                    <option value="many_voids">{t('apiAdmin.badge_many_voids')}</option>
                </select>
                <select className={input} value={sort} onChange={e => setSort(e.target.value)} aria-label={t('apiAdmin.sort')}>
                    <option value="fuzzy">{t('apiAdmin.sort_fuzzy')}</option>
                    <option value="requested">{t('apiAdmin.sort_requested')}</option>
                    <option value="email">{t('apiAdmin.sort_email')}</option>
                </select>
                <button type="submit" className="text-sm font-semibold rounded-xl px-4 py-2 border" style={{ background: 'var(--accent-subtle-bg)', color: 'var(--accent)', borderColor: 'var(--border-accent)' }}>{t('apiReview.search')}</button>
            </form>
            {!data && <p className="text-sm text-stone-500">{t('apiAdmin.loading')}</p>}
            {data && data.rows.length === 0 && <p className="text-sm text-stone-500">{t('apiAdmin.people_none')}</p>}
            <ul className="divide-y divide-stone-100 dark:divide-stone-700">
                {data?.rows.map(r => (
                    <li key={r.email} className="py-3">
                        <button type="button" className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" onClick={() => onOpen(r.email)} data-testid="api-person-row">
                            <span className="font-semibold text-stone-800 dark:text-stone-200 break-all">{r.name ? `${r.name} · ` : ''}{r.email}</span>
                            <StatusPill status={r.access} />
                            <Badges badges={r.badges} />
                            <span className="text-xs text-stone-500 w-full">
                                {r.tool ? `${r.tool} · ` : ''}
                                {t('apiAdmin.people_line').replace('{keys}', String(r.activeKeys)).replace('{fuzzy7}', String(r.fuzzy7d))
                                    .replace('{exact}', String(r.last30.exact)).replace('{fuzzy}', String(r.last30.fuzzy)).replace('{voided}', String(r.last30.voided))}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
            {data && data.pages > 1 && (
                <div className="flex items-center gap-3 mt-3 text-sm">
                    <button type="button" disabled={page <= 1} className="underline disabled:opacity-40" onClick={() => setPage(page - 1)}>{t('apiAdmin.prev')}</button>
                    <span className="text-stone-500">{t('apiAdmin.page_x_of_y').replace('{x}', String(data.page)).replace('{y}', String(data.pages))}</span>
                    <button type="button" disabled={page >= data.pages} className="underline disabled:opacity-40" onClick={() => setPage(page + 1)}>{t('apiAdmin.next')}</button>
                </div>
            )}
        </section>
    );
}
