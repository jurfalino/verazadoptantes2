'use client';

import { useEffect, useState } from 'react';

interface AxiomHealth {
    configured: boolean;
    reachable: boolean;
    dataset: string | null;
    datasetSet: boolean;
    tokenSet: boolean;
    statusCode?: number;
    error?: string;
}

interface HealthResponse {
    axiom?: AxiomHealth;
}

/**
 * Renders dismiss-resistant warning banners for environment-level issues
 * an admin needs to know about even before they navigate to /admin/health
 * — most importantly, an unconfigured Axiom (which would silently turn the
 * "every error gets a stable id in Axiom" guarantee into "every error gets
 * a phantom id"). Polls /api/admin/health on mount only; small enough to
 * embed in the admin layout above page content.
 */
export default function AdminEnvWarnings() {
    const [axiom, setAxiom] = useState<AxiomHealth | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/admin/health')
            .then(res => res.ok ? res.json() : null)
            .then((body) => {
                if (cancelled) return;
                const typed = body as HealthResponse | null;
                if (typed?.axiom) setAxiom(typed.axiom);
                setLoaded(true);
            })
            .catch(() => { if (!cancelled) setLoaded(true); });
        return () => { cancelled = true; };
    }, []);

    if (!loaded || !axiom) return null;

    const banners: { tone: 'error' | 'warning'; title: string; body: string }[] = [];

    if (!axiom.configured) {
        const missing: string[] = [];
        if (!axiom.datasetSet) missing.push('AXIOM_DATASET');
        if (!axiom.tokenSet) missing.push('AXIOM_TOKEN');
        banners.push({
            tone: 'error',
            title: 'Axiom logging is disabled in this environment',
            body: `Missing ${missing.join(' and ')}. Errors fall back to worker console; user-visible error IDs will not match any Axiom row. Configure these secrets in Cloudflare Pages → Settings → Environment Variables for this environment.`,
        });
    } else if (!axiom.reachable) {
        banners.push({
            tone: 'warning',
            title: 'Axiom is configured but unreachable',
            body: `GET /v1/datasets/${axiom.dataset || ''} returned ${axiom.statusCode ?? 'no response'}${axiom.error ? ` (${axiom.error})` : ''}. Verify token validity and Axiom service status; new errors will fall back to worker console until this resolves.`,
        });
    }

    if (banners.length === 0) return null;

    return (
        <div className="space-y-2 mb-4">
            {banners.map((b, i) => {
                const isError = b.tone === 'error';
                const bg = isError ? 'bg-rose-50' : 'bg-amber-50';
                const border = isError ? 'border-rose-300' : 'border-amber-300';
                const text = isError ? 'text-rose-900' : 'text-amber-900';
                const icon = isError ? '⛔' : '⚠️';
                return (
                    <div key={i} className={`rounded-xl border ${bg} ${border} ${text} px-4 py-3 flex items-start gap-3`}>
                        <span className="text-lg leading-none shrink-0" aria-hidden="true">{icon}</span>
                        <div className="flex-1 text-sm">
                            <p className="font-semibold">{b.title}</p>
                            <p className="opacity-90 mt-0.5">{b.body}</p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
