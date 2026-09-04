'use client';

import { useEffect, useState, type ClipboardEvent } from 'react';
import { X, Plus } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import {
    categorizeContactText,
    mergeContactEntries,
    joinedAddressValue,
    isRawAddress,
    deriveStreet,
    deriveLocality,
    detectSocialPlatform,
    detectEntryType,
    type ContactEntry,
} from '@/lib/contactEntries';
import { SocialPlatformPicker } from '@/components/SocialPlatformPicker';
import { PhoneAppsToggle } from '@/components/PhoneAppsToggle';
import { ContactTypePicker } from '@/components/ContactTypePicker';

interface ContactEntriesInputProps {
    entries: ContactEntry[];
    onChange: (entries: ContactEntry[]) => void;
}

/**
 * Contact input: editable typed-chip rows, plus an on-demand paste box that
 * expands BELOW the rows (the rows stay visible). A paste/categorize APPENDS
 * typed entries (never replaces), then the paste box collapses.
 *
 * The paste affordance is gated by the `ENABLE_CONTACT_PASTE` public feature
 * flag (read once from /api/config). When the flag is off, only the manual
 * typed fields are shown.
 */
export default function ContactEntriesInput({ entries, onChange }: ContactEntriesInputProps) {
    const { t } = useLanguage();
    const [draft, setDraft] = useState('');
    const [pasteOpen, setPasteOpen] = useState(() => entries.length === 0);
    // Optimistic default ON — matches ENABLE_CONTACT_PASTE's default, so the
    // common case has no flash; the fetch only flips it for an admin opt-out.
    const [pasteEnabled, setPasteEnabled] = useState(true);

    useEffect(() => {
        let active = true;
        fetch('/api/config')
            .then(r => r.json())
            .then(d => {
                const config = (d as { config?: Record<string, string> }).config;
                if (active) setPasteEnabled(config?.ENABLE_CONTACT_PASTE !== 'false');
            })
            .catch(() => { /* keep the optimistic default on a transient failure */ });
        return () => { active = false; };
    }, []);

    const showPasteBox = pasteEnabled && pasteOpen;

    function commit(text: string) {
        const parsed = categorizeContactText(text);
        if (parsed.length === 0) return;
        onChange(mergeContactEntries(entries, parsed));
        setDraft('');
        setPasteOpen(false);
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

    /**
     * Rows whose type the user chose by hand. Detection never overrides these —
     * someone who deliberately files a phone number under "Documento" must not
     * have it silently reclassified on the next keystroke.
     *
     * Indices, so removing a row shifts everything above it down by one; the
     * remap below is not optional or the wrong rows end up pinned.
     */
    const [pinnedTypes, setPinnedTypes] = useState<Set<number>>(new Set());

    function pinType(index: number) {
        setPinnedTypes(prev => new Set(prev).add(index));
    }

    /**
     * Let the value classify its own row. Only fires for an unambiguous
     * phone/email/social/document (see `detectEntryType`) and only while the
     * user has not pinned the type, so typing a name never reclassifies a row.
     */
    function updateValue(index: number, value: string) {
        const entry = entries[index];
        const patch: Partial<ContactEntry> = { value };

        const social = detectSocialPlatform(value);
        if (social) patch.platform = social;

        if (!pinnedTypes.has(index)) {
            const detected = social ? 'social' : detectEntryType(value);
            if (detected && detected !== entry.type) patch.type = detected;
        }

        updateEntry(index, patch);
    }

    function removeEntry(index: number) {
        onChange(entries.filter((_, i) => i !== index));
        setPinnedTypes(prev => {
            const next = new Set<number>();
            prev.forEach(i => {
                if (i < index) next.add(i);
                else if (i > index) next.add(i - 1);
            });
            return next;
        });
    }

    // Address-specific updates — keep `value` in sync as the canonical
    // rendered string (joined for structured shape, raw for escape-hatch).
    // Lazy-migration source: a legacy address row has only `value`; the
    // shared helpers `deriveStreet` / `deriveLocality` (in lib/contactEntries)
    // split it by the first comma to seed the two fields visually, and the
    // first edit promotes those into stored `streetAndNumber` / `locality`.
    function updateAddressStreet(index: number, streetAndNumber: string) {
        const entry = entries[index];
        const locality = deriveLocality(entry);
        const value = joinedAddressValue(streetAndNumber, locality);
        // Promote structured shape: also drop any leftover `raw` since the
        // user is now using the structured fields.
        const next: ContactEntry = { ...entry, streetAndNumber, locality, value };
        delete next.raw;
        onChange(entries.map((e, i) => (i === index ? next : e)));
    }
    function updateAddressLocality(index: number, locality: string) {
        const entry = entries[index];
        const streetAndNumber = deriveStreet(entry);
        const value = joinedAddressValue(streetAndNumber, locality);
        const next: ContactEntry = { ...entry, streetAndNumber, locality, value };
        delete next.raw;
        onChange(entries.map((e, i) => (i === index ? next : e)));
    }
    function updateAddressRaw(index: number, raw: string) {
        const entry = entries[index];
        const next: ContactEntry = { ...entry, raw, value: raw };
        delete next.streetAndNumber;
        delete next.locality;
        onChange(entries.map((e, i) => (i === index ? next : e)));
    }
    function toggleAddressMode(index: number) {
        const entry = entries[index];
        if (isRawAddress(entry)) {
            // Switching out of raw: split by first comma into the two fields.
            const r = (entry.raw || '').trim();
            const firstComma = r.indexOf(',');
            const streetAndNumber = firstComma > 0 ? r.slice(0, firstComma).trim() : r;
            const locality = firstComma > 0 ? r.slice(firstComma + 1).trim() : '';
            const value = joinedAddressValue(streetAndNumber, locality);
            const next: ContactEntry = { ...entry, streetAndNumber, locality, value };
            delete next.raw;
            onChange(entries.map((e, i) => (i === index ? next : e)));
        } else {
            // Switching into raw: collapse current structured / legacy value into raw.
            const raw = entry.value || joinedAddressValue(entry.streetAndNumber, entry.locality);
            const next: ContactEntry = { ...entry, raw, value: raw };
            delete next.streetAndNumber;
            delete next.locality;
            onChange(entries.map((e, i) => (i === index ? next : e)));
        }
    }

    const linkClass = 'font-medium text-teal-700 hover:opacity-70 transition-opacity';

    return (
        <div className="space-y-3">
            {entries.length > 0 && (
                <div className="space-y-2">
                    {entries.map((entry, i) => {
                        // Masked rows are read-only — "can't edit what you can't see".
                        // The saveAdopter owner/admin gate is the real security
                        // control; this gives a clean UI rather than letting a user
                        // type into •••••• and hit a 403 on save.
                        const isMasked = !!entry.masked;
                        const isAddress = entry.type === 'address';
                        // Address and social render sub-fields inside the value column,
                        // so they are the two that suffer most from a narrow one. They
                        // wrap to their own full-width line below the header on mobile
                        // and sit inline from `sm:` up.
                        //
                        // Single DOM moved by CSS order, never a duplicated control:
                        // breakpoint-hidden copies of the same button break `.first()`
                        // selectors on whichever viewport hides the first copy.
                        const isMultiField = isAddress || entry.type === 'social';
                        return (
                            <div
                                key={i}
                                className={`flex items-start gap-2 ${isMultiField ? 'flex-wrap' : ''} ${isMasked ? 'opacity-60' : ''}`}
                            >
                                <ContactTypePicker
                                    value={entry.type}
                                    disabled={isMasked}
                                    onChange={type => { updateEntry(i, { type }); pinType(i); }}
                                />

                                {isMultiField && (
                                    <span className="flex-1 self-center text-xs font-semibold text-stone-600 sm:hidden">
                                        {t(`adopter.ce_type_${entry.type}`)}
                                    </span>
                                )}

                                {isAddress ? (
                                    <div className="w-full order-4 sm:order-3 sm:w-auto sm:flex-1 min-w-0 space-y-1.5">
                                        {isRawAddress(entry) ? (
                                            <textarea
                                                value={entry.raw ?? entry.value}
                                                onChange={e => updateAddressRaw(i, e.target.value)}
                                                placeholder={t('adopter.ce_input_ph_address')}
                                                disabled={isMasked}
                                                rows={2}
                                                aria-label={isMasked ? `${t('adopter.ce_type_address')}: ${t('adopter.ce_masked')}` : t('adopter.ce_type_address')}
                                                className="w-full rounded-lg border border-teal-200 bg-white text-teal-900 text-sm px-3 py-1.5 outline-none focus:border-teal-500 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed resize-y"
                                            />
                                        ) : (
                                            <>
                                                <input
                                                    type="text"
                                                    value={deriveStreet(entry)}
                                                    onChange={e => updateAddressStreet(i, e.target.value)}
                                                    placeholder={t('adopter.ce_address_street_ph')}
                                                    disabled={isMasked}
                                                    aria-label={t('adopter.ce_address_street_label')}
                                                    data-testid="contact-entry-value"
                                                    className="w-full rounded-lg border border-teal-200 bg-white text-teal-900 text-sm px-3 py-1.5 outline-none focus:border-teal-500 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
                                                />
                                                <input
                                                    type="text"
                                                    value={deriveLocality(entry)}
                                                    onChange={e => updateAddressLocality(i, e.target.value)}
                                                    placeholder={t('adopter.ce_address_locality_ph')}
                                                    disabled={isMasked}
                                                    aria-label={t('adopter.ce_address_locality_label')}
                                                    className="w-full rounded-lg border border-teal-200 bg-white text-stone-700 text-sm px-3 py-1.5 outline-none focus:border-teal-500 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
                                                />
                                            </>
                                        )}
                                        {!isMasked && (
                                            <button
                                                type="button"
                                                onClick={() => toggleAddressMode(i)}
                                                className="text-xs text-stone-500 hover:text-teal-700 transition-colors"
                                            >
                                                {isRawAddress(entry)
                                                    ? t('adopter.ce_address_back_to_fields')
                                                    : t('adopter.ce_address_paste_toggle')}
                                            </button>
                                        )}
                                    </div>
                                ) : entry.type === 'social' ? (
                                    <div className="w-full order-4 sm:order-3 sm:w-auto sm:flex-1 min-w-0 space-y-1.5">
                                        {(() => {
                                            // Network-first (mirrors the manual composer): pick the
                                            // network before/above the value so the placeholder can
                                            // adapt per network (Facebook nudges the profile link,
                                            // whose numeric id is FB's stable dedup identifier). A
                                            // pasted URL still auto-detects + locks the platform.
                                            const det = detectSocialPlatform(entry.value);
                                            const eff = det ?? entry.platform ?? null;
                                            return (
                                                <>
                                                    {!isMasked && (
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-[11px] font-semibold text-stone-600">
                                                                {t('adopter.ce_social_which')}{!det && <span className="text-red-600"> *</span>}
                                                            </span>
                                                            <SocialPlatformPicker
                                                                value={eff}
                                                                locked={!!det}
                                                                onChange={(pl) => updateEntry(i, { platform: pl })}
                                                                size={18}
                                                            />
                                                        </div>
                                                    )}
                                                    <input
                                                        type="text"
                                                        value={entry.value}
                                                        onChange={e => updateValue(i, e.target.value)}
                                                        placeholder={eff ? t(`adopter.ce_input_ph_social_${eff}`) : t('adopter.ce_input_ph_social')}
                                                        disabled={isMasked}
                                                        data-testid="contact-entry-value"
                                                        className="w-full rounded-lg border border-teal-200 bg-white text-teal-900 text-sm px-3 py-1.5 outline-none focus:border-teal-500 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
                                                    />
                                                </>
                                            );
                                        })()}
                                    </div>
                                ) : entry.type === 'phone' ? (
                                    <div className="flex-1 min-w-0 space-y-1.5">
                                        <input
                                            type="text"
                                            value={entry.value}
                                            onChange={e => updateValue(i, e.target.value)}
                                            placeholder={t('adopter.ce_input_ph_phone')}
                                            disabled={isMasked}
                                            data-testid="contact-entry-value"
                                            className="w-full rounded-lg border border-teal-200 bg-white text-teal-900 text-sm px-3 py-1.5 outline-none focus:border-teal-500 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
                                        />
                                        {!isMasked && entry.value.trim().length > 0 && (
                                            <PhoneAppsToggle value={entry.apps ?? []} onChange={(apps) => updateEntry(i, { apps })} size={16} />
                                        )}
                                    </div>
                                ) : (
                                    <input
                                        type="text"
                                        value={entry.value}
                                        onChange={e => updateValue(i, e.target.value)}
                                        placeholder={t(`adopter.ce_input_ph_${entry.type}`)}
                                        disabled={isMasked}
                                        aria-label={isMasked ? `${t(`adopter.ce_type_${entry.type}`)}: ${t('adopter.ce_masked')}` : undefined}
                                        data-testid="contact-entry-value"
                                        className="flex-1 min-w-0 rounded-lg border border-teal-200 bg-white text-teal-900 text-sm px-3 py-1.5 outline-none focus:border-teal-500 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
                                    />
                                )}

                                <button
                                    type="button"
                                    onClick={() => removeEntry(i)}
                                    disabled={isMasked}
                                    aria-label={t('adopter.ce_remove')}
                                    data-testid="ce-remove"
                                    className="shrink-0 order-3 sm:order-4 grid place-items-center w-11 h-11 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    <X className="w-4 h-4" aria-hidden="true" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {entries.length === 0 && !showPasteBox && (
                <p className="text-sm text-stone-500 italic">{t('adopter.ce_empty')}</p>
            )}

            <div className="flex items-center gap-3 text-sm">
                <button
                    type="button"
                    onClick={() => onChange([...entries, { type: 'phone', value: '' }])}
                    className={`inline-flex items-center gap-1 ${linkClass}`}
                >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    {t('adopter.ce_add')}
                </button>
                {pasteEnabled && (
                    <>
                        <span className="text-stone-300" aria-hidden="true">·</span>
                        <button type="button" onClick={() => setPasteOpen(o => !o)} className={linkClass}>
                            {pasteOpen ? t('adopter.ce_paste_hide') : t('adopter.ce_mode_paste')}
                        </button>
                    </>
                )}
            </div>

            {showPasteBox && (
                <div className="space-y-2">
                    <textarea
                        rows={3}
                        className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-y min-h-[80px]"
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onPaste={handlePaste}
                        placeholder={t('adopter.ce_paste_placeholder')}
                    />
                    {draft.trim() && (
                        <button
                            type="button"
                            onClick={() => commit(draft)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                        >
                            {t('adopter.ce_categorize')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
