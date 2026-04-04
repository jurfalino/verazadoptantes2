'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type ServiceStatus = 'ok' | 'starting' | 'degraded' | 'down';

interface ServiceDetail {
    status: ServiceStatus;
    latencyMs: number;
    url?: string;
    statusCode?: number;
    error?: string;
    dbOk?: boolean;
    r2Ok?: boolean;
}

interface TableInfo {
    name: string;
    status: 'ok' | 'drift' | 'missing';
    expectedColumns: string[];
    actualColumns: string[];
    missingColumns: string[];
    extraColumns: string[];
    fixSql: string | null;
    rowCount: number;
}

interface HealthData {
    services: {
        platform: ServiceDetail;
        petshield: ServiceDetail;
        scraper: ServiceDetail;
    };
    schema: { tables: TableInfo[] };
    storage: { ok: boolean; latencyMs: number; error?: string };
    migrations: { applied: string[]; count: number; error?: string };
    environment: {
        version: string;
        runtime: string;
        vars: Record<string, boolean>;
    };
    meta: { checkedAt: string; auditDurationMs?: number; };
}

const STATUS_LABELS: Record<ServiceStatus, { label: string; color: string }> = {
    ok: { label: 'Operativo', color: 'text-emerald-600' },
    starting: { label: 'Iniciando', color: 'text-amber-600' },
    degraded: { label: 'Degradado', color: 'text-amber-600' },
    down: { label: 'No disponible', color: 'text-rose-600' },
};

const STATUS_DOTS: Record<ServiceStatus, string> = {
    ok: 'bg-emerald-500',
    starting: 'bg-amber-500 animate-pulse',
    degraded: 'bg-amber-500',
    down: 'bg-rose-500',
};

const SERVICE_META: Record<string, { icon: string; name: string; description: string }> = {
    platform: { icon: '🌐', name: 'Plataforma', description: 'D1 Database + R2 Storage' },
    petshield: { icon: '📋', name: 'PetShield (Contratos)', description: 'Formularios y contratos de adopción' },
    scraper: { icon: '🤖', name: 'AI Import', description: 'Extracción de datos desde redes sociales' },
};

const REFRESH_INTERVAL = 60;

function CopyButton({ text, label }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-300 bg-white hover:bg-stone-50 transition-colors"
        >
            {copied ? '✓ Copiado' : (label || '📋 Copiar SQL')}
        </button>
    );
}

export default function AdminHealthPage() {
    const [data, setData] = useState<HealthData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
    const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
    const [showAllMigrations, setShowAllMigrations] = useState(false);

    const fetchHealth = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/health');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json() as HealthData;
            setData(body);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error de conexión');
        } finally {
            setLoading(false);
            setCountdown(REFRESH_INTERVAL);
        }
    }, []);

    useEffect(() => { fetchHealth(); }, [fetchHealth]);

    useEffect(() => {
        const interval = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) { fetchHealth(); return REFRESH_INTERVAL; }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [fetchHealth]);

    const toggleTable = (name: string) => {
        setExpandedTables(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const driftCount = data?.schema.tables.filter(t => t.status !== 'ok').length ?? 0;
    const totalRows = data?.schema.tables.reduce((sum, t) => sum + t.rowCount, 0) ?? 0;

    // Overall status
    const statuses = data ? [data.services.platform.status, data.services.petshield.status, data.services.scraper.status] : [];
    const overall: ServiceStatus = statuses.some(s => s === 'down') ? 'down' : statuses.some(s => s === 'degraded' || s === 'starting') ? 'degraded' : 'ok';

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center py-20 text-stone-500">
                <div className="w-6 h-6 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin mr-3" />
                Verificando estado del sistema...
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-semibold text-stone-900">🩺 System Health</h2>
                    <p className="text-stone-500 mt-1">Diagnóstico detallado del sistema</p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href="/health"
                        target="_blank"
                        className="text-xs text-stone-500 hover:text-stone-700 underline underline-offset-2"
                    >
                        Página pública ↗
                    </Link>
                    <div className="text-xs text-stone-400 tabular-nums">
                        ↻ {countdown}s
                    </div>
                    <button
                        onClick={fetchHealth}
                        className="px-3 py-1.5 text-xs font-medium bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors"
                    >
                        Refresh Now
                    </button>
                </div>
            </header>

            {error && !data && (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
                    ❌ {error}
                    <button onClick={fetchHealth} className="ml-3 underline">Reintentar</button>
                </div>
            )}

            {data && (
                <>
                    {/* ───── Overall Banner ───── */}
                    <div className={`p-4 rounded-xl border flex items-center gap-3 ${
                        overall === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                        overall === 'degraded' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                        'bg-rose-50 border-rose-200 text-rose-800'
                    }`}>
                        <span className="text-xl">{overall === 'ok' ? '✅' : overall === 'degraded' ? '⚠️' : '❌'}</span>
                        <div className="flex-1">
                            <strong className="text-sm">
                                {overall === 'ok' ? 'Todos los sistemas operativos' :
                                 overall === 'degraded' ? 'Algunos servicios degradados' :
                                 'Problemas detectados'}
                            </strong>
                            {data.meta.checkedAt && (
                                <span className="block text-xs opacity-70">
                                    Último chequeo: {new Date(data.meta.checkedAt).toLocaleTimeString('es-AR')}
                                </span>
                            )}
                        </div>
                        {driftCount > 0 && (
                            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">
                                {driftCount} tabla{driftCount > 1 ? 's' : ''} con drift
                            </span>
                        )}
                    </div>

                    {/* ───── Services Grid ───── */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                        <h3 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                            <span className="text-xl">📡</span> Servicios
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {(Object.entries(data.services) as [string, ServiceDetail][]).map(([key, svc]) => {
                                const meta = SERVICE_META[key];
                                const statusInfo = STATUS_LABELS[svc.status];
                                return (
                                    <div key={key} className="p-4 rounded-xl bg-stone-50 border border-stone-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOTS[svc.status]}`} />
                                            <span className="font-semibold text-sm text-stone-800">
                                                {meta.icon} {meta.name}
                                            </span>
                                        </div>
                                        <div className="space-y-1 text-xs">
                                            <div className="flex justify-between">
                                                <span className="text-stone-500">Estado</span>
                                                <span className={`font-semibold ${statusInfo.color}`}>{statusInfo.label}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-stone-500">Latencia</span>
                                                <span className={`font-mono ${
                                                    svc.latencyMs < 500 ? 'text-emerald-600' :
                                                    svc.latencyMs < 2000 ? 'text-amber-600' : 'text-rose-600'
                                                }`}>
                                                    {svc.latencyMs > 0 ? `${svc.latencyMs}ms` : '—'}
                                                </span>
                                            </div>
                                            {svc.statusCode !== undefined && (
                                                <div className="flex justify-between">
                                                    <span className="text-stone-500">HTTP</span>
                                                    <span className="font-mono text-stone-700">{svc.statusCode}</span>
                                                </div>
                                            )}
                                            {svc.url && (
                                                <div className="pt-1 truncate text-stone-400" title={svc.url}>
                                                    {svc.url}
                                                </div>
                                            )}
                                            {key === 'platform' && (
                                                <div className="flex gap-3 pt-1 border-t border-stone-200 mt-1">
                                                    <span className={svc.dbOk ? 'text-emerald-600' : 'text-rose-600'}>
                                                        {svc.dbOk ? '✓' : '✗'} D1
                                                    </span>
                                                    <span className={svc.r2Ok ? 'text-emerald-600' : 'text-rose-600'}>
                                                        {svc.r2Ok ? '✓' : '✗'} R2
                                                    </span>
                                                </div>
                                            )}
                                            {svc.error && (
                                                <div className="pt-1 text-rose-500 break-all">⚠ {svc.error}</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ───── Schema Drift Panel ───── */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                        <h3 className="text-lg font-semibold text-stone-900 mb-1 flex items-center gap-2">
                            <span className="text-xl">🗄️</span> Schema Drift
                            {driftCount > 0 && (
                                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">
                                    {driftCount} issue{driftCount > 1 ? 's' : ''}
                                </span>
                            )}
                        </h3>
                        <p className="text-xs text-stone-500 mb-4">
                            Comparación entre el esquema Drizzle y las tablas D1.
                            {driftCount > 0 && (
                                <> Copiá el SQL y ejecutalo en <Link href="/admin/query" className="text-teal-700 underline underline-offset-2">SQL Runner</Link>.</>
                            )}
                        </p>

                        <div className="space-y-1">
                            {/* Drifted tables first, then OK */}
                            {[...data.schema.tables]
                                .sort((a, b) => (a.status === 'ok' ? 1 : -1) - (b.status === 'ok' ? 1 : -1))
                                .map(table => {
                                const isExpanded = expandedTables.has(table.name);
                                const isDrift = table.status !== 'ok';

                                return (
                                    <div key={table.name} className={`rounded-xl border ${isDrift ? 'border-amber-200 bg-amber-50' : 'border-stone-100'}`}>
                                        <button
                                            onClick={() => toggleTable(table.name)}
                                            className="w-full flex items-center justify-between p-3 text-left hover:bg-stone-50/50 rounded-xl transition-colors"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <span className={`w-2 h-2 rounded-full ${
                                                    table.status === 'ok' ? 'bg-emerald-500' :
                                                    table.status === 'drift' ? 'bg-amber-500' : 'bg-rose-500'
                                                }`} />
                                                <span className="font-mono text-sm text-stone-800">{table.name}</span>
                                                <span className="text-xs text-stone-400">
                                                    {table.rowCount.toLocaleString()} rows · {table.actualColumns.length} cols
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {isDrift && (
                                                    <span className="text-xs text-amber-700 font-medium">
                                                        {table.status === 'missing' ? 'Tabla no existe' :
                                                         `${table.missingColumns.length} missing, ${table.extraColumns.length} extra`}
                                                    </span>
                                                )}
                                                <span className="text-stone-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <div className="px-4 pb-4 pt-1 border-t border-stone-200/50">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {/* Expected columns */}
                                                    <div>
                                                        <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                                                            Drizzle Schema ({table.expectedColumns.length})
                                                        </h4>
                                                        <div className="space-y-0.5">
                                                            {table.expectedColumns.map(col => {
                                                                const isMissing = table.missingColumns.includes(col);
                                                                return (
                                                                    <div key={col} className={`font-mono text-xs px-2 py-1 rounded ${
                                                                        isMissing ? 'bg-rose-100 text-rose-700 font-semibold' : 'text-stone-600'
                                                                    }`}>
                                                                        {isMissing && <span className="mr-1">✗</span>}
                                                                        {col}
                                                                        {isMissing && <span className="ml-1 text-rose-400 text-[10px]">NOT IN DB</span>}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {/* Actual columns */}
                                                    <div>
                                                        <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                                                            D1 Database ({table.actualColumns.length})
                                                        </h4>
                                                        {table.actualColumns.length === 0 ? (
                                                            <p className="text-xs text-rose-500 italic">Tabla no encontrada en la base de datos</p>
                                                        ) : (
                                                            <div className="space-y-0.5">
                                                                {table.actualColumns.map(col => {
                                                                    const isExtra = table.extraColumns.includes(col);
                                                                    return (
                                                                        <div key={col} className={`font-mono text-xs px-2 py-1 rounded ${
                                                                            isExtra ? 'bg-amber-100 text-amber-700 font-semibold' : 'text-stone-600'
                                                                        }`}>
                                                                            {isExtra && <span className="mr-1">+</span>}
                                                                            {col}
                                                                            {isExtra && <span className="ml-1 text-amber-400 text-[10px]">NOT IN SCHEMA</span>}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Fix SQL */}
                                                {table.fixSql && (
                                                    <div className="mt-4 p-3 bg-stone-900 rounded-lg">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-xs font-semibold text-stone-400">Fix SQL</span>
                                                            <div className="flex gap-2">
                                                                <CopyButton text={table.fixSql} />
                                                                <Link
                                                                    href="/admin/query"
                                                                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-600 text-stone-300 hover:bg-stone-800 transition-colors"
                                                                >
                                                                    ⚡ Abrir SQL Runner
                                                                </Link>
                                                            </div>
                                                        </div>
                                                        <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap">{table.fixSql}</pre>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ───── Database Overview ───── */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                        <h3 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                            <span className="text-xl">💾</span> Database Overview
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                            <div className="p-3 rounded-xl bg-stone-50">
                                <span className="text-xs text-stone-500">Tablas</span>
                                <div className="flex items-baseline gap-2">
                                    <p className="text-2xl font-semibold text-stone-900">{data.schema.tables.length}</p>
                                    {data.meta.auditDurationMs !== undefined && (
                                        <span className="text-xs text-stone-400 font-mono">audit: {data.meta.auditDurationMs}ms</span>
                                    )}
                                </div>
                            </div>
                            <div className="p-3 rounded-xl bg-stone-50">
                                <span className="text-xs text-stone-500">Total Filas</span>
                                <p className="text-2xl font-semibold text-stone-900">{totalRows.toLocaleString()}</p>
                            </div>
                            <div className="p-3 rounded-xl bg-stone-50">
                                <span className="text-xs text-stone-500">Migraciones</span>
                                <p className="text-2xl font-semibold text-stone-900">{data.migrations.count}</p>
                            </div>
                            <div className="p-3 rounded-xl bg-stone-50">
                                <span className="text-xs text-stone-500">R2 Storage</span>
                                <p className={`text-2xl font-semibold ${data.storage.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {data.storage.ok ? '✓' : '✗'}
                                </p>
                            </div>
                        </div>

                        {/* Row counts table */}
                        <div className="overflow-hidden rounded-lg border border-stone-200">
                            <table className="w-full text-sm">
                                <thead className="bg-stone-50">
                                    <tr>
                                        <th className="text-left py-2 px-3 text-xs font-semibold text-stone-500 uppercase">Tabla</th>
                                        <th className="text-right py-2 px-3 text-xs font-semibold text-stone-500 uppercase">Filas</th>
                                        <th className="text-right py-2 px-3 text-xs font-semibold text-stone-500 uppercase">Columnas</th>
                                        <th className="text-center py-2 px-3 text-xs font-semibold text-stone-500 uppercase">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {[...data.schema.tables]
                                        .sort((a, b) => b.rowCount - a.rowCount)
                                        .map(table => (
                                        <tr key={table.name} className="hover:bg-stone-50/50">
                                            <td className="py-2 px-3 font-mono text-xs text-stone-700">{table.name}</td>
                                            <td className="py-2 px-3 text-right font-mono text-xs text-stone-600 tabular-nums">{table.rowCount.toLocaleString()}</td>
                                            <td className="py-2 px-3 text-right font-mono text-xs text-stone-400">{table.actualColumns.length}</td>
                                            <td className="py-2 px-3 text-center">
                                                <span className={`inline-block w-2 h-2 rounded-full ${
                                                    table.status === 'ok' ? 'bg-emerald-500' :
                                                    table.status === 'drift' ? 'bg-amber-500' : 'bg-rose-500'
                                                }`} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ───── Migrations & Environment ───── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Migrations */}
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                            <h3 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                                <span className="text-xl">📁</span> Migraciones D1
                            </h3>
                            {data.migrations.error ? (
                                <p className="text-xs text-amber-600">⚠ {data.migrations.error}</p>
                            ) : data.migrations.applied.length === 0 ? (
                                <p className="text-xs text-stone-400 italic">No se encontraron migraciones</p>
                            ) : (
                                <div className="space-y-1">
                                    {(showAllMigrations ? data.migrations.applied : data.migrations.applied.slice(0, 8)).map((name, i) => (
                                        <div key={name} className={`font-mono text-xs px-2 py-1 rounded ${i === 0 ? 'bg-teal-50 text-teal-700 font-semibold' : 'text-stone-500'}`}>
                                            {name}
                                        </div>
                                    ))}
                                    {data.migrations.applied.length > 8 && (
                                        <button
                                            onClick={() => setShowAllMigrations(!showAllMigrations)}
                                            className="text-xs text-stone-400 hover:text-stone-600 underline"
                                        >
                                            {showAllMigrations ? 'Mostrar menos' : `+ ${data.migrations.applied.length - 8} más`}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Environment */}
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                            <h3 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
                                <span className="text-xl">🔑</span> Environment
                            </h3>
                            <div className="space-y-1 mb-4">
                                <div className="flex justify-between text-xs">
                                    <span className="text-stone-500">Version</span>
                                    <span className="font-mono text-stone-700">{data.environment.version}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-stone-500">Runtime</span>
                                    <span className="font-mono text-stone-700">{data.environment.runtime}</span>
                                </div>
                            </div>
                            <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Variables</h4>
                            <div className="space-y-1">
                                {Object.entries(data.environment.vars).map(([key, present]) => (
                                    <div key={key} className="flex items-center justify-between text-xs">
                                        <span className="font-mono text-stone-600">{key}</span>
                                        <span className={present ? 'text-emerald-600' : 'text-rose-500'}>
                                            {present ? '✓ Set' : '✗ Missing'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
