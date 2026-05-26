'use client';

import { Phone, Mail, AtSign, IdCard, MapPin, StickyNote, Lock, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { renderTextWithLinks } from '@/lib/textUtils';
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

const LINK_CLASS = 'text-teal-700 hover:underline';

/**
 * Resolve a social value to a profile URL. A full URL or domain links to its
 * own platform generically — Facebook, Instagram, TikTok, X, LinkedIn, etc.
 * A bare "@handle" is NOT linked: the platform is unknowable from the handle
 * alone (`@juanp` could be Instagram, TikTok or X), and guessing one is wrong.
 */
function socialHref(value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+\//.test(v)) return `https://${v}`;
    return null;
}

/**
 * Read-only contact display: one row per entry, ordered by type. Values are
 * actionable — phone (`tel:`), email (`mailto:`), address (Google Maps),
 * social URL (profile link). `other` notes are grouped, muted and separated
 * below; any link inside a note's text stays clickable via renderTextWithLinks.
 *
 * Masked rows (`entry.masked === true`) render the partial-revealed value as a
 * button — click opens the verify/request popover (via `onMaskedClick`). The
 * type is passed back so the popover can type-tune its placeholder. Without
 * `onMaskedClick` the masked value renders inert (read-only contexts).
 */
interface Props {
    entries: ContactEntry[];
    onMaskedClick?: (entryType: ContactEntryType) => void;
}

export default function ContactEntriesDisplay({ entries, onMaskedClick }: Props) {
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
        if (entry.masked) {
            // Clickable affordance opens the verify/request popover when a
            // handler is supplied (gated profile view). Without one, the
            // masked value renders as inert text (used in any read-only
            // context like printable views).
            if (onMaskedClick) {
                return (
                    <button
                        type="button"
                        onClick={() => onMaskedClick(entry.type)}
                        aria-label={t('adopter.pii_masked_chip_aria')}
                        className="inline-flex items-center gap-1.5 text-stone-500 hover:text-teal-700 hover:bg-teal-50 -mx-1.5 -my-0.5 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer group"
                    >
                        <Lock className="w-3 h-3 opacity-60 group-hover:opacity-100" aria-hidden="true" />
                        <span className="select-none">{entry.value}</span>
                    </button>
                );
            }
            return (
                <span
                    className="text-stone-400 select-none"
                    aria-label={`${labelFor(entry)}: ${t('adopter.ce_masked')}`}
                >
                    {entry.value}
                </span>
            );
        }
        if (entry.type === 'phone') {
            return (
                <a href={`tel:${entry.value.replace(/[^\d+]/g, '')}`} className={LINK_CLASS}>
                    {entry.value}
                </a>
            );
        }
        if (entry.type === 'email') {
            return <a href={`mailto:${entry.value}`} className={LINK_CLASS}>{entry.value}</a>;
        }
        if (entry.type === 'address') {
            const query = encodeURIComponent(entry.value.replace(/\n/g, ', '));
            return (
                <a
                    href={`https://www.google.com/maps/search/?api=1&query=${query}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={LINK_CLASS}
                >
                    {entry.value}
                </a>
            );
        }
        if (entry.type === 'social') {
            const href = socialHref(entry.value);
            return href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                    {entry.value}
                </a>
            ) : (
                <span className="text-stone-800">{entry.value}</span>
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
                                <span className="font-medium text-stone-800 flex-1 min-w-0" style={{ overflowWrap: 'anywhere' }}>
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
                            <div style={{ overflowWrap: 'anywhere' }}>{renderTextWithLinks(entry.value)}</div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
