'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { transferAdopterOwnership } from '@/app/actions';

interface UserOption {
    email: string;
    name: string | null;
}

interface TransferOwnershipModalProps {
    adopterId: string;
    adopterName: string;
    currentOwnerEmail: string;
    open: boolean;
    onClose: () => void;
    onTransferred: () => void;
}

export default function TransferOwnershipModal({
    adopterId, adopterName, currentOwnerEmail, open, onClose, onTransferred,
}: TransferOwnershipModalProps) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState<UserOption[]>([]);
    const [selected, setSelected] = useState<UserOption | null>(null);
    const [searching, setSearching] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!open) {
            setQuery(''); setOptions([]); setSelected(null);
            return;
        }
        // Seed with recent users on open so the list isn't blank.
        runSearch('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    async function runSearch(q: string) {
        setSearching(true);
        try {
            const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { users?: UserOption[] };
            setOptions(data.users ?? []);
        } catch {
            setOptions([]);
        } finally {
            setSearching(false);
        }
    }

    function onQueryChange(v: string) {
        setQuery(v);
        setSelected(null);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(v.trim()), 200);
    }

    async function submit() {
        if (!selected) return;
        setSubmitting(true);
        try {
            const res = await transferAdopterOwnership(adopterId, selected.email);
            if (res.ok) {
                toast.success('✓', t('admin.transfer_success') || 'Ownership transferred');
                onTransferred();
                onClose();
            } else {
                toast.error(t('errors.generic'), res.error || t('admin.transfer_error') || 'Transfer failed');
            }
        } catch (e) {
            toast.error(t('errors.generic'), e instanceof Error ? e.message : 'Transfer failed');
        } finally {
            setSubmitting(false);
        }
    }

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--overlay-bg)' }}>
            <div className="rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4" style={{ background: 'var(--surface-card)' }}>
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                    {t('admin.transfer_title') || 'Transfer ownership'}
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {(t('admin.transfer_body') || 'Move "{name}" from {from} to a new owner.')
                        .replace('{name}', adopterName)
                        .replace('{from}', currentOwnerEmail || '—')}
                </p>
                <div className="space-y-1.5">
                    <label htmlFor="transfer-search" className="text-sm font-medium block" style={{ color: 'var(--text-primary)' }}>
                        {t('admin.transfer_search_label') || 'New owner'}
                    </label>
                    <input
                        id="transfer-search"
                        type="text"
                        value={query}
                        onChange={e => onQueryChange(e.target.value)}
                        placeholder={t('admin.transfer_search_ph') || 'email or name…'}
                        className="w-full rounded-xl border border-teal-200 bg-white text-teal-900 text-sm p-3 outline-none focus:border-teal-500"
                        autoComplete="off"
                    />
                </div>
                <div className="max-h-56 overflow-y-auto border border-stone-200 rounded-xl divide-y divide-stone-100">
                    {searching && options.length === 0 && (
                        <div className="p-3 text-xs text-stone-500 italic">{t('common.loading') || 'Loading…'}</div>
                    )}
                    {!searching && options.length === 0 && (
                        <div className="p-3 text-xs text-stone-500 italic">{t('admin.transfer_no_matches') || 'No matches.'}</div>
                    )}
                    {options.map(u => {
                        const isCurrent = u.email.toLowerCase().trim() === currentOwnerEmail.toLowerCase().trim();
                        const isSelected = selected?.email === u.email;
                        return (
                            <button
                                key={u.email}
                                type="button"
                                disabled={isCurrent}
                                onClick={() => setSelected(u)}
                                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                    isSelected
                                        ? 'bg-teal-100 text-teal-900'
                                        : isCurrent
                                            ? 'bg-stone-50 text-stone-400 cursor-not-allowed'
                                            : 'hover:bg-teal-50 text-stone-800'
                                }`}
                            >
                                <div className="font-medium truncate">{u.name || u.email}</div>
                                <div className="text-xs text-stone-500 truncate">{u.email}{isCurrent ? ` · ${t('admin.transfer_current_owner') || 'current owner'}` : ''}</div>
                            </button>
                        );
                    })}
                </div>
                <div className="flex gap-3 pt-1">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                        style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}
                    >
                        {t('common.cancel') || 'Cancel'}
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={submitting || !selected}
                        className="flex-1 px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50"
                    >
                        {submitting ? '...' : (t('admin.transfer_confirm') || 'Transfer')}
                    </button>
                </div>
            </div>
        </div>
    );
}
