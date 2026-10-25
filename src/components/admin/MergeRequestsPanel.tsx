'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveMergeRequest } from '@/app/actions/mergeRequests';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { userFacingMessage } from '@/lib/errorMessage';
import type { MergeRequestAdminRow } from '@/lib/mergeRequests';

const DAY_MS = 86_400_000;

/** "hace 3 días" — computed after mount only (reads the clock; see useRelativeTime). */
function waited(createdAt: number | null, now: number | null): string {
    if (createdAt == null || now == null) return '';
    const days = Math.max(0, Math.floor((now - createdAt) / DAY_MS));
    if (days === 0) return 'hoy';
    return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

/**
 * Admin queue for merge requests: both profiles, who asked, who owns the
 * target, how long it has waited. Approving merges (older profile survives);
 * a declined request can still be approved ("Aprobar igual"). A resolved row
 * leaves the list with a toast.
 */
export default function MergeRequestsPanel({ requests }: { requests: MergeRequestAdminRow[] }) {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    const toast = useShowToast();
    const [items, setItems] = useState<MergeRequestAdminRow[]>(requests);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => { setNow(Date.now()); }, []);

    async function resolve(id: string, decision: 'accept' | 'decline') {
        setBusyId(id);
        try {
            const res = await resolveMergeRequest(id, decision);
            if (res.success) {
                setItems(prev => prev.filter(r => r.id !== id));
                toast.success('✓', decision === 'accept' ? 'Perfiles combinados' : 'Pedido rechazado');
            } else {
                toast.error(t('errors.generic'), 'No se pudo resolver el pedido. Volvé a intentar.', res.errorId);
            }
        } catch (e) {
            toast.error(t('errors.generic'), userFacingMessage(e, 'No se pudo resolver el pedido. Volvé a intentar.'), resolveErrorId(e, 'MergeRequestsPanel'));
        } finally {
            setBusyId(null);
        }
    }

    if (items.length === 0) {
        return (
            <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500">
                No hay pedidos de combinación pendientes.
            </div>
        );
    }

    return (
        <ul className="space-y-3">
            {items.map(r => {
                const declined = r.status === 'declined';
                const busy = busyId === r.id;
                return (
                    <li key={r.id} data-testid="merge-request-row" className="rounded-xl border border-stone-200 bg-white p-4 text-sm space-y-2">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                            <a href={`/adopter/${r.primary.id}`} className="text-teal-700 hover:underline break-words min-w-0">{r.primary.name}</a>
                            <span aria-hidden className="text-stone-400">+</span>
                            <a href={`/adopter/${r.secondary.id}`} className="text-teal-700 hover:underline break-words min-w-0">{r.secondary.name}</a>
                            <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-semibold border ${declined ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
                                {declined ? 'Rechazado por el dueño' : 'Pendiente'}
                            </span>
                        </div>
                        <div className="text-stone-600 break-all">
                            <span className="font-medium">Pidió: </span>{r.requesterEmail}
                        </div>
                        <div className="text-stone-600 break-all">
                            <span className="font-medium">Dueño: </span>
                            {r.ownerEmail ?? <span className="italic text-stone-500">sin dueño</span>}
                        </div>
                        {r.createdAt != null && (
                            <div className="text-xs text-stone-500">
                                Pedido el {formatShortDate(r.createdAt)}
                                {now != null && <> · {waited(r.createdAt, now)}</>}
                            </div>
                        )}
                        <div className="flex gap-2 pt-1">
                            <button
                                type="button"
                                data-testid="merge-request-approve"
                                onClick={() => resolve(r.id, 'accept')}
                                disabled={busy}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                            >
                                {declined ? 'Aprobar igual' : 'Aprobar'}
                            </button>
                            {!declined && (
                                <button
                                    type="button"
                                    data-testid="merge-request-decline"
                                    onClick={() => resolve(r.id, 'decline')}
                                    disabled={busy}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-stone-300 text-stone-700 hover:opacity-70 transition-opacity disabled:opacity-50"
                                >
                                    Rechazar
                                </button>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
