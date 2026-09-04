'use client';

import { useEffect, useState, type ClipboardEvent } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { categorizeContactText, mergeContactEntries, type ContactEntry } from '@/lib/contactEntries';
import ContactEntriesSection from '@/components/ContactEntriesSection';

interface ContactEntriesInputProps {
    entries: ContactEntry[];
    onChange: (entries: ContactEntry[]) => void;
    /**
     * The wizard's own public-visibility toggle, forwarded so the section's
     * visibility microcopy tracks it. Without this the section defaults to
     * "Datos protegidos…" while the toggle a few lines below can read "Este
     * perfil será visible para todos" — two statements about one setting,
     * disagreeing.
     */
    isPublic?: boolean;
}

/**
 * Contact details for the import wizard.
 *
 * This is now a thin wrapper around `ContactEntriesSection` in LOCAL mode — the
 * same component the adopter profile and the new-adopter form use. It used to be
 * a parallel implementation: always-editable rows, each carrying its own type
 * control, where you typed a value into a generic box and the row reclassified
 * itself around what you had written.
 *
 * That was the wrong shape. Choosing the type FIRST is what lets the input
 * arrive correct — an address opens with street and locality, a social asks
 * which network before the handle (so the placeholder can nudge toward a profile
 * link, whose numeric id is the stable dedup key), a phone offers
 * WhatsApp/Telegram. A value-first box can only offer any of that AFTER the
 * rescuer has typed into the wrong-shaped field.
 *
 * `ContactEntriesSection` has supported local mode since new-adopter creation
 * needed it; the wizard had simply never been migrated onto it. Sharing it also
 * hands the wizard the things it silently lacked — branded social logos,
 * messaging-app badges, structured addresses, the duplicate hint — and removes a
 * second place for the same concept to drift.
 *
 * What stays here is the one thing genuinely specific to importing: the paste
 * box, which turns a blob of scraped text into typed entries in one step. It
 * APPENDS through `mergeContactEntries` and never replaces, so a paste cannot
 * discard what the rescuer already corrected by hand.
 */
export default function ContactEntriesInput({ entries, onChange, isPublic = false }: ContactEntriesInputProps) {
    const { t } = useLanguage();
    const [draft, setDraft] = useState('');
    const [pasteOpen, setPasteOpen] = useState(false);
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

    return (
        <div className="space-y-3">
            <ContactEntriesSection
                entries={entries}
                onChange={onChange}
                canEditAll
                adopterIsPublic={isPublic}
                // Reviewing what the AI guessed is this surface's whole job, and it
                // guesses types wrong. Correcting one in place reuses the composer's
                // own pills — see the prop's docs on ContactEntriesSection.
                allowTypeChange
            />

            {pasteEnabled && (
                <div className="pt-1">
                    <button
                        type="button"
                        onClick={() => setPasteOpen(o => !o)}
                        className="text-sm font-medium text-teal-700 hover:opacity-70 transition-opacity"
                    >
                        {pasteOpen ? t('adopter.ce_paste_hide') : t('adopter.ce_mode_paste')}
                    </button>
                </div>
            )}

            {pasteEnabled && pasteOpen && (
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
