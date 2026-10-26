'use client';

/**
 * The small contact composer of the household card — «Agregar dato de
 * contacto» → pick a type → value (network for a social, WhatsApp/Telegram for
 * a phone) → Guardar. Shared by a household member's contacts (HouseholdSection)
 * and a linked conviviente's card (LinkedProfileSummary, D55), so adding a
 * contact looks and behaves the same wherever a person is shown.
 *
 * `ContactDraftEditor` is the value form alone, also used to edit an existing
 * member contact in place.
 */

import { useState } from 'react';
import { Phone, Mail, AtSign, IdCard, MapPin, UserRound, Plus } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { SocialPlatformPicker } from '@/components/SocialPlatformPicker';
import { PhoneAppsToggle } from '@/components/PhoneAppsToggle';
import { detectSocialPlatform, type ContactEntryType, type SocialPlatform, type MessagingApp } from '@/lib/contactEntries';

export const COMPOSABLE_CONTACT_TYPES: ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address', 'alias'];
export const CONTACT_TYPE_ICON: Record<ContactEntryType, typeof Phone> = {
    phone: Phone, email: Mail, social: AtSign, id: IdCard, address: MapPin, alias: UserRound, other: UserRound,
};

export interface ComposerDraft { type: ContactEntryType; value: string; platform: SocialPlatform | null; apps: MessagingApp[] }

/** The network a social draft saves with: the one its URL names, else the one picked. */
export function draftPlatform(d: ComposerDraft): SocialPlatform | undefined {
    if (d.type !== 'social') return undefined;
    return detectSocialPlatform(d.value) ?? d.platform ?? undefined;
}

export function ContactDraftEditor({ draft, onChange, onSave, onCancel, busy, note, testIdPrefix = 'contact-composer' }: {
    draft: ComposerDraft;
    onChange: (up: Partial<ComposerDraft>) => void;
    onSave: () => void;
    onCancel: () => void;
    busy: boolean;
    /** A line above the input, e.g. «Se agrega al perfil de {nombre}». */
    note?: string;
    testIdPrefix?: string;
}) {
    const { t } = useLanguage();
    const det = draft.type === 'social' ? detectSocialPlatform(draft.value) : null;
    const eff = det ?? draft.platform;
    const canSave = draft.value.trim().length > 0 && (draft.type !== 'social' || !!eff);
    const placeholder = draft.type !== 'social'
        ? (t(`adopter.ce_input_ph_${draft.type}`) || '')
        : eff ? (t(`adopter.ce_input_ph_social_${eff}`) || t('adopter.ce_input_ph_social')) : t('adopter.ce_input_ph_social');
    return (
        <div className="rounded-lg border border-stone-200 bg-white p-2.5 mt-1.5 space-y-2 min-w-0">
            {note && <p className="text-xs text-stone-500 break-words" data-testid={`${testIdPrefix}-note`}>{note}</p>}
            {draft.type === 'social' && (
                <div>
                    {!det && <div className="text-[11px] font-semibold text-stone-700 mb-1.5">{t('adopter.ce_social_which')} <span className="text-red-600">*</span></div>}
                    <SocialPlatformPicker value={eff} locked={!!det} onChange={pl => onChange({ platform: pl })} size={18} />
                </div>
            )}
            <input autoFocus type="text" value={draft.value} onChange={e => onChange({ value: e.target.value })}
                placeholder={placeholder}
                data-testid={`${testIdPrefix}-input`}
                className="w-full min-w-0 px-2 py-1.5 border border-stone-300 rounded text-base outline-none focus:border-teal-500" />
            {draft.type === 'phone' && (
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-stone-500">{t('adopter.ce_phone_apps')}</span>
                    <PhoneAppsToggle value={draft.apps} onChange={apps => onChange({ apps })} />
                </div>
            )}
            <div className="flex items-center gap-2 justify-end">
                <button type="button" onClick={onCancel} disabled={busy} data-testid={`${testIdPrefix}-cancel`} className="min-h-[44px] text-xs font-medium px-3 rounded text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50">{t('adopter.ce_edit_cancel')}</button>
                <button type="button" onClick={onSave} disabled={busy || !canSave} data-testid={`${testIdPrefix}-save`} className="min-h-[44px] text-xs font-medium px-3 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40">{t('adopter.ce_edit_save')}</button>
            </div>
        </div>
    );
}

/**
 * Trigger → type pills → editor. `onSubmit` saves the draft and resolves true
 * when it was saved (the composer then closes) — on false it stays open with
 * what was typed, so nothing is lost on an error.
 */
export function ContactComposer({ onSubmit, disabled = false, note, triggerTestId, testIdPrefix = 'contact-composer', className = '' }: {
    onSubmit: (draft: ComposerDraft) => Promise<boolean>;
    disabled?: boolean;
    note?: string;
    triggerTestId?: string;
    testIdPrefix?: string;
    className?: string;
}) {
    const { t } = useLanguage();
    const [stage, setStage] = useState<'closed' | 'pick' | 'edit'>('closed');
    const [draft, setDraft] = useState<ComposerDraft>({ type: 'phone', value: '', platform: null, apps: [] });
    const [saving, setSaving] = useState(false);
    const busy = disabled || saving;

    const close = () => { setStage('closed'); setDraft({ type: 'phone', value: '', platform: null, apps: [] }); };
    async function save() {
        setSaving(true);
        try {
            if (await onSubmit({ ...draft, value: draft.value.trim() })) close();
        } finally { setSaving(false); }
    }

    if (stage === 'pick') {
        return (
            <div className={`rounded-lg border border-stone-200 bg-white p-2.5 min-w-0 ${className}`}>
                {note && <p className="text-xs text-stone-500 mb-2 break-words" data-testid={`${testIdPrefix}-note`}>{note}</p>}
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {COMPOSABLE_CONTACT_TYPES.map(ty => {
                        const I = CONTACT_TYPE_ICON[ty];
                        return (
                            <button key={ty} type="button" data-testid={`${testIdPrefix}-type-${ty}`}
                                onClick={() => { setDraft({ type: ty, value: '', platform: null, apps: [] }); setStage('edit'); }}
                                className="inline-flex min-h-[44px] items-center gap-1 px-2.5 text-xs font-medium rounded-md bg-white border border-stone-200 text-stone-700 hover:bg-teal-50">
                                <I className="w-3 h-3" />{t(`adopter.ce_type_${ty}`)}
                            </button>
                        );
                    })}
                </div>
                <div className="flex justify-end">
                    <button type="button" onClick={close} className="min-h-[44px] text-xs px-3 rounded text-stone-500 hover:text-stone-700">{t('adopter.ce_edit_cancel')}</button>
                </div>
            </div>
        );
    }
    if (stage === 'edit') {
        return (
            <div className={className}>
                <ContactDraftEditor draft={draft} onChange={up => setDraft(d => ({ ...d, ...up }))} onSave={() => { void save(); }} onCancel={close} busy={busy} note={note} testIdPrefix={testIdPrefix} />
            </div>
        );
    }
    return (
        <button type="button" onClick={() => setStage('pick')} disabled={busy} data-testid={triggerTestId}
            className={`inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-900 disabled:opacity-50 ${className}`}>
            <Plus className="w-4 h-4" aria-hidden="true" />{t('adopter.hh_add_contact')}
        </button>
    );
}
