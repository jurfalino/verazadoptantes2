'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface NotificationPreview {
    id: string;
    title: string;
    body: string;
    icon: string | null;
    metadata: string | null; // JSON string
    createdAt: string;
    read: number;
}

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
    'import_result': { label: 'Scraper Imports', description: 'Status updates from background social media import jobs.' }
};

export default function AdminNotificationsPage() {
    const [types, setTypes] = useState<NotificationTypeStat[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedType, setExpandedType] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/notifications');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { types: NotificationTypeStat[] };
            setTypes(data.types || []);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

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
            if (!res.ok) throw new Error('Failed to update config');
        } catch {
            // Revert
            setTypes(prev => prev.map(t => t.type === type ? { ...t, isEnabled: currentEnabled } : t));
            alert('Failed to update global toggle.');
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
                                                    <span>🔍</span> Inspección de Carga (Últimas 5)
                                                </h4>
                                                {stat.lastSentAt && (
                                                    <span className="text-[10px] text-stone-400 font-mono">Última: {new Date(stat.lastSentAt).toLocaleString('es-AR')}</span>
                                                )}
                                            </div>
                                            
                                            {stat.previews.length === 0 ? (
                                                <div className="text-xs text-stone-500 italic p-3 bg-white rounded-lg border border-stone-200">
                                                    No hay registros recientes.
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {stat.previews.map(notif => (
                                                        <div key={notif.id} className="p-3 bg-white rounded-lg border border-stone-200 text-sm flex gap-3 opacity-90">
                                                            <div className="text-xl shrink-0 pt-0.5 opacity-80">{notif.icon || '🔔'}</div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex justify-between items-start gap-4">
                                                                    <div className="font-medium text-stone-900 truncate">{notif.title}</div>
                                                                    <div className="text-[10px] text-stone-400 font-mono whitespace-nowrap pt-1">
                                                                        {new Date(notif.createdAt).toLocaleDateString()}
                                                                    </div>
                                                                </div>
                                                                <div className="text-stone-500 text-xs mt-0.5 line-clamp-2 leading-relaxed">
                                                                    {notif.body}
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
