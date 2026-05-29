'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { backfillLegacyContactEntries } from '@/app/actions/admin';
import { useShowToast } from '@/components/ui/Toast';

/**
 * Admin one-shot backfill of structured `contactEntries` from the legacy
 * `contactInfo` blob. Pairs with the v2.16.0-8 lazy migration in
 * addContactEntry — together they ensure every existing adopter row gets
 * the structured shape on day one of the deploy, not just rows someone
 * happens to interact with via the composer.
 *
 * Idempotent: only touches rows where `contactEntries IS NULL` and
 * `contactInfo` is non-empty. Safe to re-run; result toast shows the count.
 */
export default function AdminContactEntriesBackfill() {
    const router = useRouter();
    const toast = useShowToast();
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ migrated: number; skipped: number; errorCount: number } | null>(null);

    const handleRun = async () => {
        setLoading(true);
        try {
            const res = await backfillLegacyContactEntries();
            if (res.ok) {
                setResult({ migrated: res.migrated, skipped: res.skipped, errorCount: res.errors.length });
                if (res.errors.length === 0) {
                    toast.success('✓ Backfill complete', `${res.migrated} migrado(s), ${res.skipped} ya estaban al día.`);
                } else {
                    toast.warning('Backfill terminó con errores', `${res.migrated} migrado(s), ${res.errors.length} con error.`);
                }
                router.refresh();
            } else {
                toast.error('Error', res.error);
            }
        } catch (e) {
            toast.error('Error', e instanceof Error ? e.message : 'Falló el backfill');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-amber-50 p-6 rounded-2xl border-2 border-amber-200">
            <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🛠️</span>
                <h3 className="text-lg font-semibold text-amber-800">Tareas de mantenimiento</h3>
            </div>
            <p className="text-amber-800 text-sm mb-4">
                <strong>Migrar datos de contacto antiguos.</strong> Convierte el bloque
                <code className="px-1.5 py-0.5 mx-1 bg-amber-100 rounded">contact_info</code>
                de los perfiles que aún no usan el formato estructurado
                <code className="px-1.5 py-0.5 mx-1 bg-amber-100 rounded">contact_entries</code>,
                categorizando teléfonos / emails / redes / direcciones automáticamente.
                Idempotente; ejecutar dos veces no hace daño.
            </p>
            <button
                type="button"
                onClick={handleRun}
                disabled={loading}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors disabled:opacity-60"
            >
                {loading ? 'Migrando…' : 'Migrar datos de contacto antiguos'}
            </button>
            {result && (
                <div className="mt-4 text-sm text-amber-800 space-y-0.5">
                    <div><strong>Migrados:</strong> {result.migrated}</div>
                    <div><strong>Sin cambios:</strong> {result.skipped}</div>
                    {result.errorCount > 0 && (
                        <div className="text-red-700"><strong>Errores:</strong> {result.errorCount} (ver logs del servidor)</div>
                    )}
                </div>
            )}
        </div>
    );
}
