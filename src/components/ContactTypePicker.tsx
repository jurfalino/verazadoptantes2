'use client';

import { useEffect, useRef, useState } from 'react';
import { Phone, Mail, AtSign, IdCard, MapPin, StickyNote, UserRound, ChevronDown, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { ContactEntryType } from '@/lib/contactEntries';

export const CONTACT_TYPE_ORDER: ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address', 'alias', 'other'];

export const CONTACT_TYPE_ICON: Record<ContactEntryType, LucideIcon> = {
    phone: Phone,
    email: Mail,
    social: AtSign,
    id: IdCard,
    address: MapPin,
    alias: UserRound,
    other: StickyNote,
};

/**
 * The entry's type, as a single icon control.
 *
 * Replaces a labelled `<select>`. A native select is sized by its LONGEST
 * option, not the selected one, so every row reserved the width of "Otro
 * nombre/identidad" (21 characters) even when it read "Email" — and it was
 * `shrink-0`, so the value input absorbed the entire shortfall. On a 360px
 * screen that left the input around 50px: the control describing the data had
 * three times the room of the data.
 *
 * The icon was already sitting beside that select saying the same thing, so
 * merging the two removes a redundancy rather than hiding a control. This is
 * also the idiom the surrounding component already uses twice —
 * `SocialPlatformPicker` picks a network and `PhoneAppsToggle` picks
 * WhatsApp/Telegram, both as unlabelled icon buttons.
 *
 * 44px so it clears the minimum touch target; the old remove control next to it
 * was 24px, which is a small target for a destructive action sitting beside a
 * text field.
 */
export function ContactTypePicker({ value, onChange, disabled, compact, types }: {
    value: ContactEntryType;
    onChange: (type: ContactEntryType) => void;
    disabled?: boolean;
    /** 36px, for the header line of a stacked row where the label is visible. */
    compact?: boolean;
    /**
     * Restrict the offered types. Defaults to all of them. The import wizard
     * passes the composer's own list so that correcting a type offers exactly
     * what adding one offers — `other` is excluded there because notes belong on
     * the activity record, not on a contact detail.
     */
    types?: readonly ContactEntryType[];
}) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const Icon = CONTACT_TYPE_ICON[value];

    useEffect(() => {
        if (!open) return;
        function onDocClick(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const size = compact ? 'w-9 h-9' : 'w-11 h-11';

    return (
        <div ref={wrapRef} className="relative shrink-0">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`${t('adopter.ce_type_label')}: ${t(`adopter.ce_type_${value}`)}`}
                title={t(`adopter.ce_type_${value}`)}
                data-testid="ce-type-picker"
                // No background fill. `globals.css` maps `.bg-white` to
                // `var(--surface-card)` unconditionally and with `!important`, so a
                // filled button paints a card-coloured block wherever it sits — which
                // read as a black box once this moved out of the composer's old
                // `bg-stone-50` card and onto the row itself. Transparent lets it sit
                // flush with the inputs beside it; the themed teal border still marks
                // it as the one control in that row.
                className={`${size} relative grid place-items-center rounded-lg border border-teal-200 text-teal-600 transition-colors hover:border-teal-400 hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:text-stone-400 disabled:cursor-not-allowed`}
            >
                <Icon className="w-[18px] h-[18px] -translate-x-px -translate-y-px" aria-hidden="true" />
                {!disabled && (
                    // Sized explicitly rather than by a shared `svg` rule — a parent
                    // rule that sizes every icon in the button would scale this to the
                    // glyph's size and sit it on top of the glyph.
                    <ChevronDown className="absolute right-[3px] bottom-[3px] w-[9px] h-[9px] text-stone-400" aria-hidden="true" />
                )}
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute z-30 top-full left-0 mt-1.5 min-w-[13rem] rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg"
                >
                    {(types ?? CONTACT_TYPE_ORDER).map(type => {
                        const OptIcon = CONTACT_TYPE_ICON[type];
                        const active = type === value;
                        return (
                            <button
                                key={type}
                                type="button"
                                role="menuitemradio"
                                aria-checked={active}
                                data-testid={`ce-type-option-${type}`}
                                onClick={() => { onChange(type); setOpen(false); }}
                                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${active
                                    ? 'bg-teal-50 font-semibold text-teal-900'
                                    : 'text-stone-700 hover:bg-teal-50 hover:text-teal-900'}`}
                            >
                                <OptIcon className="w-4 h-4 shrink-0 text-teal-600" aria-hidden="true" />
                                <span className="min-w-0 truncate">{t(`adopter.ce_type_${type}`)}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
