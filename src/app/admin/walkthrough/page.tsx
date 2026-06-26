'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import {
    getWalkthroughDemoAdmin,
    saveWalkthroughDemoRecord,
    seedWalkthroughDemo,
} from '@/app/actions/walkthroughDemo';
import type { DemoRecordEdit } from '@/lib/walkthroughDemo';

/**
 * /admin/walkthrough — edit the 3 mocked records the guided walkthrough shows.
 * PII (name/contact) persists to the soft-deleted `isDemo` rows; the display
 * values (rating/flags/stats) persist to the WALKTHROUGH_DEMO_OVERLAY config.
 * The walkthrough renders these via getWalkthroughDemoMatches (real masking).
 */
export default function WalkthroughAdminPage() {
    const { locale } = useLanguage();
    const isEs = locale !== 'en';
    const toast = useShowToast();
    const [records, setRecords] = useState<DemoRecordEdit[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await getWalkthroughDemoAdmin();
        if (res.ok && res.records) setRecords(res.records);
        else toast.error('Error', res.error || 'Failed to load');
        setLoading(false);
    }, [toast]);

    useEffect(() => { load(); }, [load]);

    const update = (id: string, partial: Partial<DemoRecordEdit>) =>
        setRecords(rs => rs.map(r => (r.id === id ? { ...r, ...partial } : r)));

    const save = async (rec: DemoRecordEdit) => {
        setBusy(rec.id);
        const res = await saveWalkthroughDemoRecord(rec);
        if (res.ok) toast.success('✓', isEs ? 'Guardado' : 'Saved');
        else toast.error('Error', res.error || 'Failed to save');
        setBusy(null);
    };

    const reset = async () => {
        if (!confirm(isEs ? '¿Restablecer los 3 registros a los valores por defecto?' : 'Reset the 3 records to defaults?')) return;
        setBusy('seed');
        const res = await seedWalkthroughDemo();
        if (res.ok) { toast.success('✓', isEs ? 'Restablecido' : 'Reset'); await load(); }
        else toast.error('Error', res.error || 'Failed to reset');
        setBusy(null);
    };

    const input = 'w-full px-2.5 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-900 text-sm outline-none focus:border-teal-400';
    const label = 'block text-xs font-medium text-stone-500 mb-1';

    return (
        <div className="max-w-4xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-2xl font-semibold text-stone-900">🎯 {isEs ? 'Demo del recorrido guiado' : 'Guided walkthrough demo'}</h2>
                    <p className="text-stone-500 text-sm mt-1 max-w-2xl">
                        {isEs
                            ? 'Los 3 registros «Juan» que muestra el recorrido. No aparecen en ninguna búsqueda real. Editá su contenido acá; el enmascarado de datos se aplica de verdad.'
                            : 'The 3 "Juan" records the walkthrough shows. They never appear in any real search. Edit them here; the PII masking is applied for real.'}
                    </p>
                </div>
                <button onClick={reset} disabled={busy === 'seed'}
                    className="px-3 py-1.5 rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 text-sm font-medium disabled:opacity-50">
                    {busy === 'seed' ? '…' : (isEs ? 'Restablecer a valores por defecto' : 'Reset to defaults')}
                </button>
            </div>

            {loading ? (
                <div className="text-stone-400 text-sm py-10 text-center">…</div>
            ) : records.map(rec => (
                <div key={rec.id} className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-stone-800">{rec.name || rec.id}</h3>
                        <code className="text-xs text-stone-400">{rec.id}</code>
                    </div>

                    {/* PII */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="md:col-span-2">
                            <label className={label}>{isEs ? 'Nombre' : 'Name'}</label>
                            <input className={input} value={rec.name} onChange={e => update(rec.id, { name: e.target.value })} />
                        </div>
                        <div>
                            <label className={label}>{isEs ? 'Teléfono' : 'Phone'}</label>
                            <input className={input} value={rec.phone} onChange={e => update(rec.id, { phone: e.target.value })} />
                        </div>
                        <div>
                            <label className={label}>Email</label>
                            <input className={input} value={rec.email} onChange={e => update(rec.id, { email: e.target.value })} />
                        </div>
                        <div>
                            <label className={label}>{isEs ? 'Red social' : 'Social'}</label>
                            <input className={input} value={rec.social} onChange={e => update(rec.id, { social: e.target.value })} />
                        </div>
                        <div>
                            <label className={label}>{isEs ? 'Dirección' : 'Address'}</label>
                            <input className={input} value={rec.address} onChange={e => update(rec.id, { address: e.target.value })} />
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-stone-700">
                        <input type="checkbox" checked={rec.isPublic} onChange={e => update(rec.id, { isPublic: e.target.checked })} />
                        {isEs ? 'Registro público (datos a la vista, sin enmascarar)' : 'Public record (contact shown unmasked)'}
                    </label>

                    {/* Display values */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-stone-100">
                        <div>
                            <label className={label}>{isEs ? 'Calificación (1–5)' : 'Rating (1–5)'}</label>
                            <input className={input} type="number" min={1} max={5} step={0.1}
                                value={rec.rating ?? ''}
                                onChange={e => update(rec.id, { rating: e.target.value === '' ? null : Number(e.target.value) })} />
                        </div>
                        <div>
                            <label className={label}>{isEs ? 'Vistas' : 'Views'}</label>
                            <input className={input} type="number" min={0} value={rec.profileViews}
                                onChange={e => update(rec.id, { profileViews: Number(e.target.value) })} />
                        </div>
                        <div>
                            <label className={label}>{isEs ? 'Solicitudes' : 'Requests'}</label>
                            <input className={input} type="number" min={0} value={rec.requests}
                                onChange={e => update(rec.id, { requests: Number(e.target.value) })} />
                        </div>
                        <div>
                            <label className={label}>{isEs ? 'Adopciones' : 'Adoptions'}</label>
                            <input className={input} type="number" min={0} value={rec.adoptions}
                                onChange={e => update(rec.id, { adoptions: Number(e.target.value) })} />
                        </div>
                    </div>

                    {/* Flags */}
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-700">
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked={rec.verifiedAddress} onChange={e => update(rec.id, { verifiedAddress: e.target.checked })} />
                            {isEs ? 'Dirección verificada' : 'Verified address'}
                        </label>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked={rec.verifiedIdentity} onChange={e => update(rec.id, { verifiedIdentity: e.target.checked })} />
                            {isEs ? 'Identidad verificada' : 'Verified ID'}
                        </label>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked={rec.inaccurate} onChange={e => update(rec.id, { inaccurate: e.target.checked })} />
                            {isEs ? 'Datos inexactos' : 'Inaccurate'}
                        </label>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked={rec.duplicate} onChange={e => update(rec.id, { duplicate: e.target.checked })} />
                            {isEs ? 'Duplicado' : 'Duplicate'}
                        </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3 max-w-sm">
                        <div>
                            <label className={label}>{isEs ? 'Alerta: adopciones (0 = sin alerta)' : 'Alert: adoptions (0 = none)'}</label>
                            <input className={input} type="number" min={0} value={rec.tooManyAdoptionsCount}
                                onChange={e => update(rec.id, { tooManyAdoptionsCount: Number(e.target.value) })} />
                        </div>
                        <div>
                            <label className={label}>{isEs ? 'en N días' : 'in N days'}</label>
                            <input className={input} type="number" min={1} value={rec.tooManyAdoptionsDays}
                                onChange={e => update(rec.id, { tooManyAdoptionsDays: Number(e.target.value) })} />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button onClick={() => save(rec)} disabled={busy === rec.id}
                            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                            {busy === rec.id ? '…' : (isEs ? 'Guardar' : 'Save')}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
