'use client';

import { useState, type ClipboardEvent } from 'react';
import { Phone, Mail, AtSign, IdCard, MapPin, StickyNote, X, Plus, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import {
    categorizeContactText,
    mergeContactEntries,
    type ContactEntry,
    type ContactEntryType,
} from '@/lib/contactEntries';

interface ContactEntriesInputProps {
    entries: ContactEntry[];
    onChange: (entries: ContactEntry[]) => void;
}

const TYPE_ORDER: ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address', 'other'];

const TYPE_ICON: Record<ContactEntryType, LucideIcon> = {
    phone: Phone,
    email: Mail,
    social: AtSign,
    id: IdCard,
    address: MapPin,
    other: StickyNote,
};

/**
 * Paste-and-categorize contact input. A paste (or the Categorize button) runs
 * the regex tokenizer and APPENDS typed entries — it never replaces the list,
 * so a manual reclassification survives a later paste. Emits ContactEntry[].
 */
export default function ContactEntriesInput({ entries, onChange }: ContactEntriesInputProps) {
    const { t } = useLanguage();
    const [draft, setDraft] = useState('');

    function commit(text: string) {
        const parsed = categorizeContactText(text);
        if (parsed.length === 0) return;
        onChange(mergeContactEntries(entries, parsed));
        setDraft('');
    }

    function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
        const pasted = e.clipboardData.getData('text');
        if (!pasted.trim()) return;
        e.preventDefault();
        commit(draft ? `${draft}\n${pasted}` : pasted);
    }

    function updateEntry(index: number, patch: Partial<ContactEntry>) {
        onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
    }

    function removeEntry(index: number) {
        onChange(entries.filter((_, i) => i !== index));
    }

    return (
        <div className="space-y-3">
            <div>
                <textarea
                    rows={2}
                    className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-y min-h-[64px]"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onPaste={handlePaste}
                    placeholder={t('adopter.ce_paste_placeholder')}
                />
                {draft.trim() && (
                    <button
                        type="button"
                        onClick={() => commit(draft)}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                    >
                        {t('adopter.ce_categorize')}
                    </button>
                )}
            </div>

            {entries.length === 0 ? (
                <p className="text-sm text-stone-500 italic">{t('adopter.ce_empty')}</p>
            ) : (
                <div className="space-y-2">
                    {entries.map((entry, i) => {
                        const Icon = TYPE_ICON[entry.type];
                        return (
                            <div key={i} className="flex items-center gap-2">
                                <Icon className="w-4 h-4 shrink-0 text-teal-600" aria-hidden="true" />
                                <select
                                    value={entry.type}
                                    onChange={e => updateEntry(i, { type: e.target.value as ContactEntryType })}
                                    className="shrink-0 rounded-lg border border-teal-200 bg-white text-teal-900 text-sm px-2 py-1.5 outline-none focus:border-teal-500"
                                >
                                    {TYPE_ORDER.map(type => (
                                        <option key={type} value={type}>{t(`adopter.ce_type_${type}`)}</option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    value={entry.value}
                                    onChange={e => updateEntry(i, { value: e.target.value })}
                                    placeholder={t('adopter.ce_value_placeholder')}
                                    className="flex-1 min-w-0 rounded-lg border border-teal-200 bg-white text-teal-900 text-sm px-3 py-1.5 outline-none focus:border-teal-500"
                                />
                                <button
                                    type="button"
                                    onClick={() => removeEntry(i)}
                                    aria-label={t('adopter.ce_remove')}
                                    className="shrink-0 p-1 text-stone-400 hover:opacity-70 transition-opacity"
                                >
                                    <X className="w-4 h-4" aria-hidden="true" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <button
                type="button"
                onClick={() => onChange([...entries, { type: 'phone', value: '' }])}
                className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:opacity-70 transition-opacity"
            >
                <Plus className="w-4 h-4" aria-hidden="true" />
                {t('adopter.ce_add')}
            </button>
        </div>
    );
}
