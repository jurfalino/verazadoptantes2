'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { addContactEntry } from '@/app/actions/addContactEntry';
import type { ContactEntryType } from '@/lib/contactEntries';

interface Props {
    open: boolean;
    onClose: () => void;
    adopterId: string;
}

const CONTRIBUTABLE_TYPES: ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address'];

/**
 * Open-to-all-authenticated-users contribution modal. Append-only — adds one
 * typed entry via `addContactEntry`, which writes adopter_history with
 * kind='contribution' (does NOT promote the contributor to editor) and
 * notifies owner + editors. Mobile bottom sheet + desktop centered card,
 * mirrors PiiVerifyPopover's responsive shape.
 */
export default function AddContactEntryModal({ open, onClose, adopterId }: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [type, setType] = useState<ContactEntryType>('phone');
    const [value, setValue] = useState('');
    const [streetAndNumber, setStreetAndNumber] = useState('');
    const [locality, setLocality] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset state on close so a re-open starts clean.
    const wasOpenRef = useRef(false);
    useEffect(() => {
        if (wasOpenRef.current && !open) {
            setType('phone');
            setValue('');
            setStreetAndNumber('');
            setLocality('');
            setError(null);
        }
        wasOpenRef.current = open;
    }, [open]);

    // Body scroll lock on mobile only.
    useEffect(() => {
        if (!open) return;
        if (typeof window === 'undefined') return;
        if (window.matchMedia('(min-width: 640px)').matches) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    // Esc to close.
    useEffect(() => {
        if (!open) return;
        function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    const hasContent = type === 'address'
        ? (streetAndNumber.trim().length > 0 || locality.trim().length > 0)
        : value.trim().length > 0;

    async function submit() {
        if (!hasContent) return;
        setBusy(true);
        setError(null);
        try {
            const payload: Parameters<typeof addContactEntry>[0] = type === 'address'
                ? {
                    adopterId,
                    type: 'address',
                    value: [streetAndNumber.trim(), locality.trim()].filter(Boolean).join(', '),
                    streetAndNumber: streetAndNumber.trim() || undefined,
                    locality: locality.trim() || undefined,
                }
                : { adopterId, type, value: value.trim() };
            const res = await addContactEntry(payload);
            if (res.ok) {
                toast.success('✓', t('adopter.contrib_added_toast'));
                onClose();
                router.refresh();
            } else {
                setError(res.error || t('adopter.contrib_error'));
            }
        } catch {
            setError(t('adopter.contrib_error'));
        } finally {
            setBusy(false);
        }
    }

    const typeLabels: Record<ContactEntryType, string> = {
        phone: t('adopter.ce_type_phone'),
        email: t('adopter.ce_type_email'),
        social: t('adopter.ce_type_social'),
        id: t('adopter.ce_type_id'),
        address: t('adopter.ce_type_address'),
        alias: t('adopter.ce_type_alias'),
        other: t('adopter.ce_type_other'),
    };

    return (
        <>
            <div
                className="fixed inset-0 z-40 bg-black/30"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                className="
                    fixed z-50 flex flex-col overflow-hidden shadow-2xl
                    inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl
                    sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                    sm:w-[min(28rem,calc(100vw-2rem))] sm:max-h-[80vh] sm:rounded-2xl
                "
                style={{
                    background: 'var(--surface-card)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                    paddingBottom: 'env(safe-area-inset-bottom)',
                }}
                role="dialog"
                aria-modal="true"
                aria-label={t('adopter.contrib_modal_title')}
                onClick={e => e.stopPropagation()}
            >
                <div className="sm:hidden flex justify-center pt-2 pb-1">
                    <div className="h-1.5 w-12 rounded-full" style={{ background: 'var(--border-default)' }} />
                </div>

                <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
                    <div className="space-y-1.5">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('adopter.contrib_modal_title')}</p>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('adopter.contrib_modal_body')}</p>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{t('adopter.contrib_modal_type_label')}</label>
                        <div className="flex flex-wrap gap-1.5">
                            {CONTRIBUTABLE_TYPES.map(t => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setType(t)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                        type === t
                                            ? 'bg-teal-600 text-white'
                                            : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                                    }`}
                                >
                                    {typeLabels[t]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {type === 'address' ? (
                        <div className="space-y-2">
                            <input
                                type="text"
                                value={streetAndNumber}
                                onChange={e => { setStreetAndNumber(e.target.value); setError(null); }}
                                placeholder={t('adopter.ce_address_street_ph')}
                                aria-label={t('adopter.ce_address_street_label')}
                                disabled={busy}
                                className="w-full rounded-lg border border-stone-300 bg-white text-stone-900 placeholder-stone-500 text-sm px-3 py-2 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all disabled:opacity-50"
                            />
                            <input
                                type="text"
                                value={locality}
                                onChange={e => { setLocality(e.target.value); setError(null); }}
                                placeholder={t('adopter.ce_address_locality_ph')}
                                aria-label={t('adopter.ce_address_locality_label')}
                                disabled={busy}
                                className="w-full rounded-lg border border-stone-300 bg-white text-stone-900 placeholder-stone-500 text-sm px-3 py-2 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all disabled:opacity-50"
                            />
                        </div>
                    ) : (
                        <input
                            type={type === 'phone' ? 'tel' : type === 'email' ? 'email' : 'text'}
                            value={value}
                            onChange={e => { setValue(e.target.value); setError(null); }}
                            onKeyDown={e => { if (e.key === 'Enter' && hasContent) { e.preventDefault(); submit(); } }}
                            placeholder={t('adopter.contrib_modal_value_ph')}
                            aria-label={t('adopter.contrib_modal_value_label')}
                            disabled={busy}
                            autoFocus
                            className="w-full rounded-lg border border-stone-300 bg-white text-stone-900 placeholder-stone-500 text-sm px-3 py-2 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all disabled:opacity-50"
                        />
                    )}

                    {error && <p className="text-xs text-rose-600">{error}</p>}

                    <div className="flex gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors disabled:opacity-50"
                        >
                            {t('adopter.contrib_modal_cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={submit}
                            disabled={busy || !hasContent}
                            data-testid="contrib-modal-submit"
                            className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                        >
                            {busy ? '…' : t('adopter.contrib_modal_submit')}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
