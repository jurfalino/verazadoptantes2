'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type ServiceStatus = 'ok' | 'starting' | 'degraded' | 'down';

interface ServiceData {
    status: ServiceStatus;
    latencyMs: number;
}

interface HealthData {
    status: 'ok' | 'degraded' | 'down';
    services: {
        platform: ServiceData;
        petshield: ServiceData;
        scraper: ServiceData;
    };
    schemaDrift?: Array<{ table: string; driftDetected: boolean }>;
    version: string;
    checkedAt: string;
}

interface ServiceConfig {
    key: keyof HealthData['services'];
    icon: string;
    name: { es: string; en: string };
    description: { es: string; en: string };
}

const SERVICES: ServiceConfig[] = [
    {
        key: 'platform',
        icon: '🌐',
        name: { es: 'Plataforma', en: 'Platform' },
        description: { es: 'Búsqueda, dashboard y administración', en: 'Search, dashboard, and admin' },
    },
    {
        key: 'petshield',
        icon: '📋',
        name: { es: 'PetShield (Contratos)', en: 'PetShield (Contracts)' },
        description: { es: 'Formularios y contratos de adopción', en: 'Adoption forms and contracts' },
    },
    {
        key: 'scraper',
        icon: '🤖',
        name: { es: 'AI Import', en: 'AI Import' },
        description: { es: 'Extracción de datos desde redes sociales', en: 'Social media data extraction' },
    },
];

const STATUS_CONFIG: Record<ServiceStatus, { dot: string; label: { es: string; en: string }; className: string }> = {
    ok: {
        dot: '●',
        label: { es: 'Operativo', en: 'Operational' },
        className: 'health-status-ok',
    },
    starting: {
        dot: '●',
        label: { es: 'Iniciando', en: 'Starting' },
        className: 'health-status-starting',
    },
    degraded: {
        dot: '●',
        label: { es: 'Degradado', en: 'Degraded' },
        className: 'health-status-degraded',
    },
    down: {
        dot: '●',
        label: { es: 'No disponible', en: 'Unavailable' },
        className: 'health-status-down',
    },
};

const OVERALL_CONFIG: Record<string, { icon: string; label: { es: string; en: string }; className: string }> = {
    ok: {
        icon: '✅',
        label: { es: 'Todos los sistemas operativos', en: 'All systems operational' },
        className: 'health-banner-ok',
    },
    degraded: {
        icon: '⚠️',
        label: { es: 'Algunos servicios degradados', en: 'Some services degraded' },
        className: 'health-banner-degraded',
    },
    down: {
        icon: '❌',
        label: { es: 'Problemas detectados', en: 'Issues detected' },
        className: 'health-banner-down',
    },
};

const REFRESH_INTERVAL = 30;

function timeAgo(dateStr: string, lang: 'es' | 'en'): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 5) return lang === 'es' ? 'ahora' : 'just now';
    if (seconds < 60) return lang === 'es' ? `hace ${seconds}s` : `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return lang === 'es' ? `hace ${minutes}m` : `${minutes}m ago`;
}

export default function HealthPage() {
    const [data, setData] = useState<HealthData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
    const [lang] = useState<'es' | 'en'>('es');

    const fetchHealth = useCallback(async () => {
        try {
            const res = await fetch('/api/health');
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setData(body as HealthData);
            } else {
                const body = await res.json() as HealthData;
                setData(body);
            }
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error de conexión');
        } finally {
            setLoading(false);
            setCountdown(REFRESH_INTERVAL);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchHealth();
    }, [fetchHealth]);

    // Auto-refresh countdown
    useEffect(() => {
        const interval = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    fetchHealth();
                    return REFRESH_INTERVAL;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [fetchHealth]);

    const overall = data ? OVERALL_CONFIG[data.status] || OVERALL_CONFIG.down : OVERALL_CONFIG.down;

    return (
        <div className="health-container">
            <div className="health-page">
                {/* Header */}
                <header className="health-header">
                    <Link href="/" className="health-logo" aria-label="Volver al inicio">
                        🐾 BuenAdoptante
                    </Link>
                    <h1>{lang === 'es' ? 'Estado del Sistema' : 'System Status'}</h1>
                </header>

                {/* Overall status banner */}
                <div className={`health-banner ${overall.className}`}>
                    <span className="health-banner-icon">{overall.icon}</span>
                    <div className="health-banner-text">
                        <strong>{overall.label[lang]}</strong>
                        {data?.checkedAt && (
                            <span className="health-banner-time">
                                {lang === 'es' ? 'Última verificación' : 'Last checked'}: {timeAgo(data.checkedAt, lang)}
                            </span>
                        )}
                    </div>
                    <div className="health-countdown" title={lang === 'es' ? 'Próxima verificación' : 'Next check'}>
                        <svg viewBox="0 0 36 36" className="health-countdown-ring">
                            <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.15" />
                            <circle
                                cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="2"
                                strokeDasharray={`${(countdown / REFRESH_INTERVAL) * 100.53} 100.53`}
                                strokeLinecap="round"
                                transform="rotate(-90 18 18)"
                                className="health-countdown-progress"
                            />
                        </svg>
                        <span className="health-countdown-number">{countdown}</span>
                    </div>
                </div>

                {/* Service cards */}
                <div className="health-services">
                    {loading && !data ? (
                        <div className="health-loading">
                            <div className="health-spinner" />
                            <span>{lang === 'es' ? 'Verificando servicios...' : 'Checking services...'}</span>
                        </div>
                    ) : error && !data ? (
                        <div className="health-error">
                            <span>❌ {error}</span>
                            <button onClick={fetchHealth} className="health-retry-btn">
                                {lang === 'es' ? 'Reintentar' : 'Retry'}
                            </button>
                        </div>
                    ) : (
                        SERVICES.map(service => {
                            const serviceData = data?.services[service.key] || { status: 'down' as ServiceStatus, latencyMs: 0 };
                            const statusConfig = STATUS_CONFIG[serviceData.status];

                            return (
                                <div key={service.key} className="health-card">
                                    <div className="health-card-left">
                                        <span className={`health-dot ${statusConfig.className}`}>
                                            {statusConfig.dot}
                                        </span>
                                        <div className="health-card-info">
                                            <div className="health-card-name">
                                                <span className="health-card-icon">{service.icon}</span>
                                                {service.name[lang]}
                                            </div>
                                            <div className="health-card-desc">{service.description[lang]}</div>
                                        </div>
                                    </div>
                                    <div className="health-card-right">
                                        <span className={`health-status-label ${statusConfig.className}`}>
                                            {statusConfig.label[lang]}
                                        </span>
                                        {serviceData.latencyMs > 0 && (
                                            <span className="health-latency">
                                                {serviceData.latencyMs}ms
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Schema drift warning */}
                {data?.schemaDrift && data.schemaDrift.length > 0 && (
                    <div className="health-drift-notice">
                        ⚠️ {lang === 'es'
                            ? `Desincronización detectada en ${data.schemaDrift.length} tabla(s)`
                            : `Schema drift detected in ${data.schemaDrift.length} table(s)`}
                    </div>
                )}

                {/* Footer */}
                <footer className="health-footer">
                    {data?.version && <span>v{data.version}</span>}
                    <span>•</span>
                    <Link href="/">{lang === 'es' ? 'Volver al inicio' : 'Back to home'}</Link>
                </footer>
            </div>

            <style>{`
                .health-container {
                    min-height: 100dvh;
                    display: flex;
                    align-items: flex-start;
                    justify-content: center;
                    padding: 2rem 1rem;
                    background: var(--bg-primary, #f8f9fa);
                    color: var(--text-primary, #1a1a2e);
                }

                .health-page {
                    width: 100%;
                    max-width: 640px;
                    display: flex;
                    flex-direction: column;
                    gap: 1.25rem;
                }

                .health-header {
                    text-align: center;
                }
                .health-logo {
                    display: inline-block;
                    font-size: 0.875rem;
                    font-weight: 600;
                    color: var(--text-secondary, #666);
                    text-decoration: none;
                    margin-bottom: 0.25rem;
                }
                .health-logo:hover { opacity: 0.8; }
                .health-header h1 {
                    font-size: 1.5rem;
                    font-weight: 700;
                    margin: 0;
                    color: var(--text-primary, #1a1a2e);
                }

                /* Banner */
                .health-banner {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 1rem 1.25rem;
                    border-radius: 12px;
                    border: 1px solid;
                }
                .health-banner-ok {
                    background: #ecfdf5; border-color: #a7f3d0;
                    color: #065f46;
                }
                .health-banner-degraded {
                    background: #fffbeb; border-color: #fde68a;
                    color: #92400e;
                }
                .health-banner-down {
                    background: #fef2f2; border-color: #fecaca;
                    color: #991b1b;
                }
                .health-banner-icon { font-size: 1.25rem; flex-shrink: 0; }
                .health-banner-text { flex: 1; display: flex; flex-direction: column; gap: 0.125rem; }
                .health-banner-text strong { font-size: 0.9375rem; }
                .health-banner-time {
                    font-size: 0.75rem;
                    opacity: 0.75;
                }

                /* Countdown ring */
                .health-countdown {
                    position: relative;
                    width: 36px; height: 36px;
                    flex-shrink: 0;
                }
                .health-countdown-ring { width: 100%; height: 100%; }
                .health-countdown-progress {
                    transition: stroke-dasharray 1s linear;
                }
                .health-countdown-number {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.6875rem;
                    font-weight: 600;
                    font-variant-numeric: tabular-nums;
                }

                /* Service cards */
                .health-services {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }
                .health-card {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 1rem 1.25rem;
                    border-radius: 12px;
                    background: var(--bg-secondary, #fff);
                    border: 1px solid var(--border-color, #e5e7eb);
                    transition: box-shadow 0.2s;
                }
                .health-card:hover {
                    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                }
                .health-card-left {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                }
                .health-dot {
                    font-size: 0.75rem;
                    line-height: 1;
                }
                .health-status-ok { color: #10b981; }
                .health-status-starting { color: #f59e0b; animation: health-pulse 2s ease-in-out infinite; }
                .health-status-degraded { color: #f59e0b; }
                .health-status-down { color: #ef4444; }

                @keyframes health-pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.4; }
                }

                .health-card-info { display: flex; flex-direction: column; gap: 0.125rem; }
                .health-card-name {
                    font-weight: 600;
                    font-size: 0.9375rem;
                    display: flex;
                    align-items: center;
                    gap: 0.375rem;
                }
                .health-card-icon { font-size: 1rem; }
                .health-card-desc {
                    font-size: 0.75rem;
                    color: var(--text-secondary, #666);
                }
                .health-card-right {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    gap: 0.125rem;
                }
                .health-status-label {
                    font-size: 0.8125rem;
                    font-weight: 600;
                }
                .health-latency {
                    font-size: 0.6875rem;
                    color: var(--text-secondary, #888);
                    font-variant-numeric: tabular-nums;
                }

                /* Loading / error states */
                .health-loading, .health-error {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 2rem;
                    color: var(--text-secondary, #666);
                    font-size: 0.875rem;
                }
                .health-spinner {
                    width: 24px; height: 24px;
                    border: 2.5px solid var(--border-color, #e5e7eb);
                    border-top-color: var(--text-primary, #333);
                    border-radius: 50%;
                    animation: health-spin 0.8s linear infinite;
                }
                @keyframes health-spin { to { transform: rotate(360deg); } }
                .health-retry-btn {
                    padding: 0.375rem 1rem;
                    border-radius: 8px;
                    border: 1px solid var(--border-color, #e5e7eb);
                    background: var(--bg-secondary, #fff);
                    color: var(--text-primary, #333);
                    font-size: 0.8125rem;
                    font-weight: 500;
                    cursor: pointer;
                }
                .health-retry-btn:hover { background: var(--bg-primary, #f8f9fa); }

                /* Schema drift */
                .health-drift-notice {
                    padding: 0.75rem 1rem;
                    border-radius: 10px;
                    background: #fffbeb;
                    border: 1px solid #fde68a;
                    color: #92400e;
                    font-size: 0.8125rem;
                    font-weight: 500;
                }

                /* Footer */
                .health-footer {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    font-size: 0.75rem;
                    color: var(--text-secondary, #888);
                    padding-top: 0.5rem;
                }
                .health-footer a {
                    color: var(--text-secondary, #888);
                    text-decoration: underline;
                    text-underline-offset: 2px;
                }
                .health-footer a:hover { color: var(--text-primary, #333); }

                /* Dark mode support */
                [data-theme="azul-noche"] .health-banner-ok,
                .dark .health-banner-ok {
                    background: #064e3b; border-color: #065f46; color: #a7f3d0;
                }
                [data-theme="azul-noche"] .health-banner-degraded,
                .dark .health-banner-degraded {
                    background: #78350f; border-color: #92400e; color: #fde68a;
                }
                [data-theme="azul-noche"] .health-banner-down,
                .dark .health-banner-down {
                    background: #7f1d1d; border-color: #991b1b; color: #fecaca;
                }
                [data-theme="azul-noche"] .health-drift-notice,
                .dark .health-drift-notice {
                    background: #78350f; border-color: #92400e; color: #fde68a;
                }
            `}</style>
        </div>
    );
}
