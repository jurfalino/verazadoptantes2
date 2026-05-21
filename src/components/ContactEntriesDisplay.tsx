import { Phone, Mail, AtSign, IdCard, StickyNote, type LucideIcon } from 'lucide-react';
import type { ContactEntry, ContactEntryType } from '@/lib/contactEntries';

const TYPE_ICON: Record<ContactEntryType, LucideIcon> = {
    phone: Phone,
    email: Mail,
    social: AtSign,
    id: IdCard,
    other: StickyNote,
};

/** Read-only typed-chip rendering of categorized contact entries. */
export default function ContactEntriesDisplay({ entries }: { entries: ContactEntry[] }) {
    if (entries.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2">
            {entries.map((entry, i) => {
                const Icon = TYPE_ICON[entry.type];
                return (
                    <span
                        key={i}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium bg-stone-100 text-stone-700 border border-stone-200"
                    >
                        <Icon className="w-3.5 h-3.5 shrink-0 text-teal-600" aria-hidden="true" />
                        {entry.type === 'id' && entry.label && (
                            <span className="text-stone-500">{entry.label}:</span>
                        )}
                        <span style={{ overflowWrap: 'anywhere' }}>{entry.value}</span>
                    </span>
                );
            })}
        </div>
    );
}
