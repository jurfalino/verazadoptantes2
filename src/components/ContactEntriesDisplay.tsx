'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, Mail, AtSign, IdCard, MapPin, StickyNote, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { renderTextWithLinks } from '@/lib/textUtils';
import { verifyKnownInfo } from '@/app/actions/piiAccess';
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

interface ContactEntriesDisplayProps {
    entries: ContactEntry[];
    /**
     * When provided, masked rows get an "I know this" affordance that runs
     * verifyKnownInfo against this adopter — typing matching info unlocks the
     * row in-place. Omit to render a purely read-only display.
     */
    adopterId?: string;
}

/**
 * Read-only contact display: a labeled list (icon + type label + value), one
 * row per entry, ordered by type. Values are actionable — phone (tel:), email
 * (mailto:), address (Google Maps), social handle (profile link). `other`
 * notes are grouped, muted and separated below; any link inside a note's text
 * stays clickable via renderTextWithLinks.
 *
 * For PII-masked rows, when `adopterId` is given, each row offers a per-entry
 * "I know this" verify — typing matching info writes a search-match grant and
 * the row reveals on refresh. A no-match response stays inline ("doesn't
 * match") without leaking which entries exist.
 */
export default function ContactEntriesDisplay({ entries, adopterId }: ContactEntriesDisplayProps) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [verifyingKey, setVerifyingKey] = useState<string | null>(null);
    const [verifyInput, setVerifyInput] = useState('');
    const [verifyError, setVerifyError] = useState<string | null>(null);
    const [verifyBusy, setVerifyBusy] = useState(false);

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
        // PII-masked entry: render the mask token as inert muted text — no
        // tel:/mailto: link, with an aria-label so it's not read as bullets.
        if (entry.masked) {
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

    async function submitVerify() {
        if (!adopterId || !verifyInput.trim()) return;
        setVerifyBusy(true);
        setVerifyError(null);
        try {
            const res = await verifyKnownInfo(adopterId, verifyInput.trim());
            if (res.ok && res.revealed > 0) {
                toast.success('✓', t('adopter.pii_verify_unlocked'));
                setVerifyingKey(null);
                setVerifyInput('');
                router.refresh();
            } else if (res.ok) {
                setVerifyError(t('adopter.pii_verify_no_match'));
            } else {
                setVerifyError(res.error || t('adopter.pii_request_error'));
            }
        } catch {
            setVerifyError(t('adopter.pii_request_error'));
        } finally {
            setVerifyBusy(false);
        }
    }

    function openVerify(key: string) {
        setVerifyingKey(key);
        setVerifyInput('');
        setVerifyError(null);
    }

    function closeVerify() {
        setVerifyingKey(null);
        setVerifyInput('');
        setVerifyError(null);
    }

    return (
        <div className="space-y-2">
            {methods.length > 0 && (
                <ul className="space-y-1.5">
                    {methods.map((entry, i) => {
                        const Icon = TYPE_ICON[entry.type];
                        const key = `${entry.type}:${i}`;
                        const canVerify = !!entry.masked && !!adopterId;
                        const isVerifying = verifyingKey === key;
                        return (
                            <li key={i} className="flex flex-col gap-1.5">
                                <div className="flex items-start gap-2 text-sm">
                                    <Icon className="w-4 h-4 mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />
                                    <span className="w-24 shrink-0 text-stone-500">{labelFor(entry)}</span>
                                    <span className="font-medium text-stone-800 flex-1 min-w-0" style={{ overflowWrap: 'anywhere' }}>
                                        {renderValue(entry)}
                                    </span>
                                    {canVerify && !isVerifying && (
                                        <button
                                            type="button"
                                            // stopPropagation: the parent contact section in
                                            // AdopterForm uses a click-to-edit handler. Without
                                            // this, the verify button click bubbles up and
                                            // flips the section into edit mode instead of
                                            // opening the inline input.
                                            onClick={e => { e.stopPropagation(); openVerify(key); }}
                                            className="shrink-0 text-xs font-semibold text-teal-700 hover:opacity-70 transition-opacity"
                                        >
                                            {t('adopter.pii_verify_cta')}
                                        </button>
                                    )}
                                </div>
                                {isVerifying && (
                                    // Boundary that catches every click inside the verify UI
                                    // so none of them reach the click-to-edit handler above.
                                    <div className="flex flex-col gap-1 pl-6 sm:pl-32" onClick={e => e.stopPropagation()}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <input
                                                autoFocus
                                                type="text"
                                                value={verifyInput}
                                                onChange={e => { setVerifyInput(e.target.value); setVerifyError(null); }}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') { e.preventDefault(); submitVerify(); }
                                                    if (e.key === 'Escape') closeVerify();
                                                }}
                                                placeholder={t(`adopter.pii_verify_ph_${entry.type}`)}
                                                disabled={verifyBusy}
                                                className="flex-1 min-w-0 rounded-lg border border-teal-300 bg-white text-teal-900 text-sm px-2.5 py-1 outline-none focus:border-teal-500 disabled:opacity-50"
                                            />
                                            <button
                                                type="button"
                                                onClick={submitVerify}
                                                disabled={verifyBusy || !verifyInput.trim()}
                                                className="px-3 py-1 rounded-lg text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                                            >
                                                {verifyBusy ? '…' : t('adopter.pii_verify_check')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={closeVerify}
                                                disabled={verifyBusy}
                                                className="text-xs text-stone-500 hover:text-stone-700 transition-colors px-1 disabled:opacity-50"
                                            >
                                                {t('adopter.pii_modal_cancel')}
                                            </button>
                                        </div>
                                        {verifyError && (
                                            <p className="text-xs text-rose-600">{verifyError}</p>
                                        )}
                                    </div>
                                )}
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
