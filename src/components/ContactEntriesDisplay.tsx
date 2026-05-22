'use client';

import { Phone, Mail, AtSign, IdCard, MapPin, StickyNote, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { ContactEntry, ContactEntryType } from '@/lib/contactEntries';

const TYPE_ICON: Record<ContactEntryType, LucideIcon> = {
    phone: Phone,
    email: Mail,
    social: AtSign,
    id: IdCard,
    address: MapPin,
    other: StickyNote,
};

/** Read order — actionable contact methods first, notes last. */
const DISPLAY_ORDER: ContactEntryType[] = ['phone', 'email', 'social', 'address', 'id', 'other'];

/**
 * Read-only contact display: a labeled list (icon + type label + value), one
 * row per entry, ordered by type. Phone and email values are actionable
 * (tel:/mailto:). `other` notes are grouped, muted and separated below the
 * contact methods — they aren't a way to reach the person.
 */
export default function ContactEntriesDisplay({ entries }: { entries: ContactEntry[] }) {
    const { t } = useLanguage();
    if (entries.length === 0) return null;

    const sorted = [...entries].sort(
        (a, b) => DISPLAY_ORDER.indexOf(a.type) - DISPLAY_ORDER.indexOf(b.type),
    );
    const methods = sorted.filter(e => e.type !== 'other');
    const notes = sorted.filter(e => e.type === 'other');

    const labelFor = (entry: ContactEntry): string =>
        entry.type === 'id' && entry.label?.trim()
            ? entry.label.trim()
            : t(`adopter.ce_type_${entry.type}`);

    const renderValue = (entry: ContactEntry) => {
        if (entry.type === 'phone') {
            return (
                <a href={`tel:${entry.value.replace(/[^\d+]/g, '')}`} className="text-teal-700 hover:underline">
                    {entry.value}
                </a>
            );
        }
        if (entry.type === 'email') {
            return (
                <a href={`mailto:${entry.value}`} className="text-teal-700 hover:underline">
                    {entry.value}
                </a>
            );
        }
        return <span className="text-stone-800">{entry.value}</span>;
    };

    return (
        <div className="space-y-2">
            {methods.length > 0 && (
                <ul className="space-y-1.5">
                    {methods.map((entry, i) => {
                        const Icon = TYPE_ICON[entry.type];
                        return (
                            <li key={i} className="flex items-start gap-2 text-sm">
                                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />
                                <span className="w-24 shrink-0 text-stone-500">{labelFor(entry)}</span>
                                <span className="font-medium text-stone-800" style={{ overflowWrap: 'anywhere' }}>
                                    {renderValue(entry)}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
            {notes.length > 0 && (
                <ul className="space-y-1 border-t border-stone-200 pt-2">
                    {notes.map((entry, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-stone-500">
                            <StickyNote className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                            <span style={{ overflowWrap: 'anywhere' }}>{entry.value}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
