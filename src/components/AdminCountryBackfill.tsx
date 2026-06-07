'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { backfillAdopterCountries } from '@/app/actions/admin';
import { useShowToast } from '@/components/ui/Toast';

/**
 * Admin one-shot backfill of `adopters.country` (v2.19.3).
 *
 * `saveAdopter` has stamped country on create from user_profiles → CF-IPCountry
 * since v40-ish, but a handful of records predate that or were created via
 * bypass paths (form-submission auto-create, contract-app create, etc.).
 *
 * Why this matters: the discovery search at findAdopters.ts applies a country
 * filter — null-country records get excluded from the picker AND the homepage
 * search unless the viewer happens to own them. After v2.19.1/.2 the owner
 * relaxation saves the owner-search case, but other org-mates / admins still
 * lose visibility. Stamping the missing country fixes both surfaces in one
 * shot.
 *
 * Resolution strategy: for each null-country adopter, fill from the creator's
 * user_profiles.country (same lookup `saveAdopter` runs at create). Anything
 * we can't resolve (creator also has no country, or addedBy is 'anonymous')
 * stays null and surfaces in the admin's residual count — clean up manually
 * via `/admin/adopters?country=_none`.
 *
 * Idempotent. Safe to re-run.
 */
export default function AdminCountryBackfill() {
    const router = useRouter();
    const toast = useShowToast();
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ migrated: number; residual: number; noCreatorCountry: number; errorCount: number } | null>(null);

    const handleRun = async () => {
        setLoading(true);
        try {
            const res = await backfillAdopterCountries();
            if (res.ok) {
                setResult({
                    migrated: res.migrated,
                    residual: res.residual,
                    noCreatorCountry: res.noCreatorCountry,
                    errorCount: res.errors.length,
                });
                if (res.migrated === 0 && res.residual === 0) {
                    toast.success('✓ Backfill listo', 'No quedan registros sin país.');
                } else if (res.errors.length === 0) {
                    toast.success('✓ Backfill completo', `${res.migrated} actualizado(s)${res.residual > 0 ? `, ${res.residual} sin resolver` : ''}.`);
                } else {
                    toast.warning('Backfill terminó con errores', `${res.migrated} actualizado(s), ${res.errors.length} con error.`);
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
        <div className="bg-stone-50 p-6 rounded-2xl border-2 border-stone-200">
            <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🌎</span>
                <h3 className="text-lg font-semibold text-stone-800">Completar país en registros</h3>
            </div>
            <p className="text-stone-700 text-sm mb-4">
                <strong>Stamping retroactivo de país.</strong> Para cada adoptante con
                <code className="px-1.5 py-0.5 mx-1 bg-stone-200 rounded text-stone-800">country</code>
                vacío, busca el país del creador en
                <code className="px-1.5 py-0.5 mx-1 bg-stone-200 rounded text-stone-800">user_profiles</code>.
                Los que no se pueden resolver (creador sin país tampoco) quedan
                para revisión manual desde el filtro
                <a href="/admin/adopters?country=_none" className="px-1.5 py-0.5 mx-1 bg-stone-200 rounded text-stone-800 hover:underline">país: ninguno</a>
                en la lista de adoptantes. Idempotente.
            </p>
            <button
                type="button"
                onClick={handleRun}
                disabled={loading}
                className="px-4 py-2 bg-stone-700 hover:bg-stone-800 text-white font-medium rounded-lg transition-colors disabled:opacity-60"
            >
                {loading ? 'Completando…' : 'Completar país en registros'}
            </button>
            {result && (
                <div className="mt-4 text-sm text-stone-800 space-y-0.5">
                    <div><strong>Actualizados:</strong> {result.migrated}</div>
                    {result.noCreatorCountry > 0 && (
                        <div><strong>Sin país del creador:</strong> {result.noCreatorCountry}{' '}
                            <a href="/admin/adopters?country=_none" className="text-teal-700 hover:underline">(revisar manualmente →)</a>
                        </div>
                    )}
                    {result.errorCount > 0 && (
                        <div className="text-rose-700"><strong>Errores:</strong> {result.errorCount} (ver logs del servidor)</div>
                    )}
                </div>
            )}
        </div>
    );
}
