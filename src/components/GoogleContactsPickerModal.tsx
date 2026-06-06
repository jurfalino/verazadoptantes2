'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import type { GoogleContact } from '@/lib/googleContacts';

interface Props {
    contacts: GoogleContact[];
    onPick: (c: GoogleContact) => void;
    onClose: () => void;
}

/**
 * Picker UI for a list of Google Contacts (v2.18.0). Used inside
 * `GoogleContactsPickerLauncher` after the OAuth + People-API fetch
 * succeeds. Renders a full-screen sheet on mobile and a centered modal on
 * desktop, with a search input that filters by name / phone / email.
 *
 * The filter runs client-side over the list (capped at 200 by the server
 * route), which keeps the UI fluid for the typical case. If contacts hit
 * the 200 cap frequently, swap the filter for a server-side search via
 * `people.searchContacts`.
 */
export default function GoogleContactsPickerModal({ contacts, onPick, onClose }: Props) {
    const { t } = useLanguage();
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus the search input on mount + close on Esc — basic modal hygiene.
    useEffect(() => {
        inputRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return contacts;
        return contacts.filter(c => {
            if (c.name.toLowerCase().includes(q)) return true;
            for (const p of c.phones) if (p.toLowerCase().includes(q)) return true;
            for (const e of c.emails) if (e.toLowerCase().includes(q)) return true;
            return false;
        });
    }, [contacts, query]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="google-contacts-picker-title"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-900/40 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-2xl shadow-xl border border-stone-200 max-h-[85vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
                    <h2 id="google-contacts-picker-title" className="text-base font-semibold text-stone-900">
                        {t('import.google_contacts_picker_title')}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close') || 'Cerrar'}
                        className="p-1 -mr-1 rounded-md text-stone-500 hover:text-stone-700 hover:bg-stone-100"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Search */}
                <div className="px-5 pt-3 pb-2">
                    <input
                        ref={inputRef}
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('import.google_contacts_search_placeholder')}
                        className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none transition-all"
                    />
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto px-2 pb-2">
                    {filtered.length === 0 ? (
                        <p className="px-3 py-6 text-sm text-stone-500 text-center">
                            {query.trim()
                                ? t('import.google_contacts_no_match')
                                : t('import.google_contacts_empty')}
                        </p>
                    ) : (
                        <ul className="divide-y divide-stone-100">
                            {filtered.map(c => {
                                const phone = c.phones[0];
                                const email = c.emails[0];
                                return (
                                    <li key={c.id}>
                                        <button
                                            type="button"
                                            onClick={() => onPick(c)}
                                            className="w-full text-left px-3 py-3 rounded-lg hover:bg-stone-50 focus:bg-stone-50 focus:outline-none transition-colors"
                                        >
                                            <p className="text-sm font-medium text-stone-900 truncate">
                                                {c.name || t('import.google_contacts_unnamed')}
                                            </p>
                                            {(phone || email) && (
                                                <p className="text-xs text-stone-500 mt-0.5 truncate">
                                                    {[phone, email].filter(Boolean).join(' · ')}
                                                </p>
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
