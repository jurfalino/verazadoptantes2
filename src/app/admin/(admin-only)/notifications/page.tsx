'use client';

import { useState, useEffect, useCallback } from 'react';
import { reportClientError, resolveErrorId } from '@/lib/clientErrorReporter';
import { useShowToast } from '@/components/ui/Toast';
import { userFacingMessage } from '@/lib/errorMessage';
import type { NotificationSeenState } from '@/domain/notificationState';
import { useDateFormat } from '@/context/TimezoneContext';

interface NotificationPreview {
    id: string;
    title: string;
    body: string;
    icon: string | null;
    metadata: string | null; // JSON string
    createdAt: string;
    read: number;
    dismissed: number;
    userId: string;
    recipientName: string | null;
    url: string | null;
    seenState: NotificationSeenState;
}

const SEEN_LABEL: Record<NotificationSeenState, { text: string; className: string }> = {
    seen: { text: 'Vista', className: 'bg-teal-50 text-teal-700 border-teal-200' },
    dismissed: { text: 'Descartada sin abrir', className: 'bg-stone-100 text-stone-600 border-stone-200' },
    unseen: { text: 'Sin ver', className: 'bg-white text-stone-500 border-stone-200' },
};

interface NotificationTypeStat {
    type: string;
    totalSent: number;
    totalRead: number;
    lastSentAt: string | null;
    isEnabled: boolean;
    previews: NotificationPreview[];
}

// Known types dictionary for friendly names
const KNOWN_TYPES: Record<string, { label: string; description: string }> = {
    'contract_result': { label: 'Contract Results', description: 'Triggered when a PetShield adoption contract completes.' },
    'form_result': { label: 'Form Submissions', description: 'Triggered when a potential adopter fills out an adoption request.' },
    'duplicate_candidate': { label: 'Duplicate Candidates', description: 'Created when the AI engine flags a potential duplicate record.' },
    'import_result': { label: 'Scraper Imports', description: 'Status updates from background social media import jobs.' },
    // v2.55.17: the followup-cron Worker checks NOTIF_ENABLED_follow_up_due
    // before inserting — this row is its kill switch.
    'contact_entry_added': { label: 'Dato de contacto agregado', description: 'Al dueño (y editores) cuando otra persona agrega un dato de contacto a su registro.' },
    'pii_access_request': { label: 'Solicitud de acceso', description: 'Al dueño cuando alguien pide ver los datos de contacto de su registro. Se aprueba o rechaza desde el perfil.' },
    'pii_access_revoked': { label: 'Acceso revocado', description: 'A quien tenía acceso, cuando el dueño o un admin se lo quita.' },
    'ownership_transferred': { label: 'Cambio de propietario', description: 'A ambas partes cuando un admin transfiere un registro.' },
    'adopter_flagged': { label: 'Adoptante reportado', description: 'A los admins cuando alguien reporta un adoptante.' },
    'deletion_request': { label: 'Solicitud de eliminación', description: 'A los admins cuando alguien pide eliminar un registro.' },
    'member_joined': { label: 'Nuevo miembro', description: 'A los miembros de una organización cuando se suma alguien.' },
    'form_submission': { label: 'Respuesta al formulario', description: 'Cuando un posible adoptante completa el formulario compartido.' },
    'contract_attached': { label: 'Contrato vinculado', description: 'Cuando un contrato firmado se vincula a un perfil.' },
    'follow_up_due': { label: 'Follow-up Reminders', description: 'Daily cron reminder when an adoption/transit follow-up slot is due.' }
};

export default function AdminNotificationsPage() {
    // Stored in epoch SECONDS; `new Date(n)` read them as milliseconds and every
    // date on this page showed as 21/1/1970. The shared formatter handles both.
    const { formatDateTime } = useDateFormat();
    const [types, setTypes] = useState<NotificationTypeStat[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedType, setExpandedType] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const toast = useShowToast();

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/notifications');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { types: NotificationTypeStat[] };
            setTypes(data.types || []);
            setError(null);
        } catch (e) {
            setError(userFacingMessage(e, 'Failed to fetch data'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const deleteNotification = async (notif: NotificationPreview) => {
        const who = notif.recipientName && notif.recipientName !== notif.userId ? `${notif.recipientName} (${notif.userId})` : notif.userId;
        if (!confirm(`¿Eliminar esta notificación de ${who}?\n\n"${notif.title}"\n\nDesaparece de su campana y no se puede deshacer.`)) return;
        setDeletingId(notif.id);
        try {
            const res = await fetch(`/api/admin/notifications?id=${encodeURIComponent(notif.id)}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { errorId?: string };
                throw new Error(`No se pudo eliminar (HTTP ${res.status})${data.errorId ? ` (ID: ${data.errorId})` : ''}`);
            }
            // Drop the row and keep the per-type totals honest without a refetch.
            setTypes(prev => prev.map(t => t.previews.some(p => p.id === notif.id)
                ? {
                    ...t,
                    totalSent: Math.max(0, t.totalSent - 1),
                    totalRead: Math.max(0, t.totalRead - (notif.read ? 1 : 0)),
                    previews: t.previews.filter(p => p.id !== notif.id),
                }
                : t));
            toast.success('Notificación eliminada');
        } catch (e) {
            toast.error('No se pudo eliminar', userFacingMessage(e, 'Probá de nuevo.'), resolveErrorId(e, 'AdminNotifications.delete'));
        } finally {
            setDeletingId(null);
        }
    };

    const handleToggle = async (type: string, currentEnabled: boolean) => {
        const newValue = !currentEnabled;
        
        // Optimistic update
        setTypes(prev => prev.map(t => t.type === type ? { ...t, isEnabled: newValue } : t));

        try {
            const res = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [`NOTIF_ENABLED_${type}`]: newValue ? 'true' : 'false' })
            });
            if (!res.ok) throw new Error(`Failed to update config (HTTP ${res.status})`);
        } catch (e) {
            // Revert
            setTypes(prev => prev.map(t => t.type === type ? { ...t, isEnabled: currentEnabled } : t));
            const message = e instanceof Error ? e.message : 'Failed to update global toggle';
            const errorId = await reportClientError({
                message,
                stack: e instanceof Error ? e.stack : undefined,
                source: 'admin-notifications-toggle',
                extra: { type, newValue },
            });
            alert(`Failed to update global toggle.${errorId ? ` Error ID: ${errorId}` : ''}`);
        }
    };

    if (loading && types.length === 0) {
        return (
            <div className="flex items-center justify-center py-20 text-stone-500">
                <div className="w-6 h-6 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin mr-3" />
                Cargando métricas de notificaciones...
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-semibold text-stone-900">📡 Communication Hub</h2>
                    <p className="text-stone-500 mt-1">Supervisión y control global de notificaciones.</p>
                </div>
                <button
                    onClick={fetchData}
                    className="px-3 py-1.5 text-xs font-medium bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200 transition-colors"
                >
                    Refrescar Datos
                </button>
            </header>

            {error && (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
                    ❌ {error}
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                <div className="divide-y divide-stone-200">
                    {types.length === 0 ? (
                        <div className="p-8 text-center text-stone-500">
                            No se encontraron notificaciones en la base de datos.
                        </div>
                    ) : (
                        types.map(stat => {
                            const isExpanded = expandedType === stat.type;
                            const known = KNOWN_TYPES[stat.type] || { label: stat.type, description: 'Tipo dinámico no registrado.' };
                            const readRate = stat.totalSent > 0 ? Math.round((stat.totalRead / stat.totalSent) * 100) : 0;

                            return (
                                <div key={stat.type} className="group">
                                    {/* Master Row */}
                                    <div className="p-4 hover:bg-stone-50 flex items-center justify-between gap-4 transition-colors">
                                        <div className="flex-1 cursor-pointer" onClick={() => setExpandedType(isExpanded ? null : stat.type)}>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold text-stone-900">{known.label}</h3>
                                                <span className="font-mono text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
                                                    {stat.type}
                                                </span>
                                            </div>
                                            <p className="text-xs text-stone-500 mt-0.5 line-clamp-1">{known.description}</p>
                                        </div>

                                        <div className="flex items-center gap-6">
                                            <div className="text-right cursor-pointer" onClick={() => setExpandedType(isExpanded ? null : stat.type)}>
                                                <div className="text-xs text-stone-400 uppercase tracking-wider font-semibold">Volumen</div>
                                                <div className="text-sm font-medium text-stone-900">{stat.totalSent.toLocaleString()}</div>
                                            </div>
                                            
                                            <div className="text-right w-16 cursor-pointer" onClick={() => setExpandedType(isExpanded ? null : stat.type)}>
                                                <div className="text-xs text-stone-400 uppercase tracking-wider font-semibold">Tasa Op.</div>
                                                <div className="text-sm font-medium text-stone-900">{readRate}%</div>
                                            </div>

                                            <div className="border-l pl-6 flex items-center min-w-[120px] justify-between">
                                                <span className={`text-xs font-semibold ${stat.isEnabled ? 'text-emerald-600' : 'text-stone-400'}`}>
                                                    {stat.isEnabled ? 'ACTIVO' : 'PAUSADO'}
                                                </span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleToggle(stat.type, stat.isEnabled);
                                                    }}
                                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 ${stat.isEnabled ? 'bg-teal-600' : 'bg-stone-200'}`}
                                                    role="switch"
                                                    aria-checked={stat.isEnabled}
                                                >
                                                    <span className="sr-only">Habilitar notificaciones {stat.type}</span>
                                                    <span
                                                        aria-hidden="true"
                                                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${stat.isEnabled ? 'translate-x-2' : '-translate-x-2'}`}
                                                    />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Inspection Drawer */}
                                    {isExpanded && (
                                        <div className="px-4 pb-4 pt-2 bg-stone-50 border-t border-stone-100">
                                            <div className="mb-3 flex items-center justify-between">
                                                <h4 className="text-xs font-semibold text-stone-500 uppercase flex items-center gap-2">
                                                    <span>🔍</span> Inspección de Carga (Últimas 10)
                                                </h4>
                                                {stat.lastSentAt && (
                                                    <span className="text-[10px] text-stone-400 font-mono">Última: {formatDateTime(Number(stat.lastSentAt))}</span>
                                                )}
                                            </div>
                                            
                                            {stat.previews.length === 0 ? (
                                                <div className="text-xs text-stone-500 italic p-3 bg-white rounded-lg border border-stone-200">
                                                    No hay registros recientes.
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {stat.previews.map(notif => (
                                                        <div key={notif.id} data-notification-id={notif.id} className="p-3 bg-white rounded-lg border border-stone-200 text-sm flex gap-3 opacity-90">
                                                            <div className="text-xl shrink-0 pt-0.5 opacity-80">{notif.icon || '🔔'}</div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex justify-between items-start gap-4">
                                                                    <div className="font-medium text-stone-900 truncate">{notif.title}</div>
                                                                    <div className="text-[10px] text-stone-400 font-mono whitespace-nowrap pt-1">
                                                                        {formatDateTime(Number(notif.createdAt))}
                                                                    </div>
                                                                </div>
                                                                <div className="text-stone-500 text-xs mt-0.5 line-clamp-2 leading-relaxed">
                                                                    {notif.body}
                                                                </div>
                                                                {/* Who got it, and whether they saw it. Identity stays
                                                                    visible, never behind a hover (audit-visibility rule). */}
                                                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                                                    <span className="text-stone-700 min-w-0 break-all">
                                                                        <span className="text-stone-500">Para: </span>
                                                                        {notif.recipientName && notif.recipientName !== notif.userId
                                                                            ? <>{notif.recipientName} <span className="text-stone-500">({notif.userId})</span></>
                                                                            : notif.userId}
                                                                    </span>
                                                                    <span data-testid="notif-seen-state" className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${SEEN_LABEL[notif.seenState].className}`}>
                                                                        {SEEN_LABEL[notif.seenState].text}
                                                                    </span>
                                                                    {notif.url && (
                                                                        <a href={notif.url} className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800">
                                                                            Abrir →
                                                                        </a>
                                                                    )}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => deleteNotification(notif)}
                                                                        disabled={deletingId === notif.id}
                                                                        className="ml-auto inline-flex items-center gap-1 font-medium text-rose-700 hover:text-rose-800 disabled:opacity-50"
                                                                    >
                                                                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5h6v2m-7 0l.7 12h6.6L16 7M10 11v5m4-5v5" />
                                                                        </svg>
                                                                        {deletingId === notif.id ? 'Eliminando…' : 'Eliminar'}
                                                                    </button>
                                                                </div>
                                                                {notif.metadata && (
                                                                    <div className="mt-2 text-[10px] font-mono text-stone-400 bg-stone-50 p-1.5 rounded line-clamp-1 border border-stone-100">
                                                                        {notif.metadata}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
            
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex gap-3 items-start">
                <span className="text-lg">⚠️</span>
                <div>
                    <strong>Pausar notificaciones</strong>
                    <p className="opacity-90 mt-1">
                        Utilizá el interruptor (Kill Switch) con precaución. Si pausás un tipo, el sistema descartará en silencio todas las notificaciones entrantes de ese tipo a nivel global, sin generar reintentos futuros una vez reactivadas.
                    </p>
                </div>
            </div>
        </div>
    );
}
