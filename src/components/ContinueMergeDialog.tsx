'use client';

/**
 * «¿Continuar con el perfil de X?» — the ONE confirmation for folding what
 * someone typed into a profile that already exists (audit B8): the new-profile
 * form's «Continuar con este perfil» (AdopterForm) and the composer's
 * «Ya está en otro perfil» window (DuplicateHint, Jon 2026-10-29) both open it.
 *
 * Body: what will be added («Se agregará:» — contacts the profile doesn't have
 * yet, typed text, household text, records), or «No hay información nueva…»;
 * then the caller's own lines (`children`: the rating after the merge, who is
 * told, a failure), then «Cancelar» / «Sí, continuar».
 */
import type { ReactNode } from 'react';
import { Modal, ModalActions, ModalText } from '@/components/ui/Modal';
import { useLanguage } from '@/context/LanguageContext';
import type { ContactEntry } from '@/lib/contactEntries';

export function ContinueMergeDialog({ name, newContacts, typedText = '', family = '', records = 0, busy = false, onCancel, onConfirm, testId = 'continue-merge-dialog', confirmTestId = 'continue-merge-confirm', children }: {
    /** The profile that stays (its name in the title). */
    name: string;
    newContacts: readonly ContactEntry[];
    /** Typed free text when there are no contact chips. */
    typedText?: string;
    family?: string;
    /** Records the other profile brings (0 = none, not listed). */
    records?: number;
    busy?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    testId?: string;
    confirmTestId?: string;
    children?: ReactNode;
}) {
    const { t } = useLanguage();
    return (
        <Modal title={(t('adopter.merge_confirm_title') || '¿Continuar con el perfil de {name}?').replace('{name}', name)}
            onClose={onCancel} busy={busy} testId={testId}>
            <ModalText>{t('adopter.merge_confirm_body') || 'La información que ingresaste se agregará a este perfil. Los datos que ya existan en el perfil no se duplicarán.'}</ModalText>
            <ContinueMergePreview newContacts={newContacts} typedText={typedText} family={family} records={records} />
            {children}
            <ModalActions
                onCancel={onCancel}
                busy={busy}
                confirm={{ label: t('adopter.merge_confirm_action') || 'Sí, continuar', tone: 'primary', testId: confirmTestId, onClick: onConfirm }}
            />
        </Modal>
    );
}

/** «Se agregará: …» in «¿Continuar con el perfil de X?», or «No hay información nueva…» when nothing would be added. */
export function ContinueMergePreview({ newContacts, typedText, family, records = 0 }: { newContacts: readonly ContactEntry[]; typedText: string; family: string; records?: number }) {
    const { t } = useLanguage();
    if (newContacts.length === 0 && !typedText && !family && records <= 0) {
        return (
            <ModalText testId="continue-merge-nothing-new">{t('adopter.merge_confirm_no_new') || 'No hay información nueva para agregar. Solo abriremos el perfil existente.'}</ModalText>
        );
    }
    return (
        <div className="rounded-xl px-3 py-3 bg-amber-50 border border-amber-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 mb-2">
                {t('adopter.merge_confirm_preview') || 'Se agregará:'}
            </p>
            <ul className="space-y-1.5 text-sm text-stone-800" data-testid="continue-merge-new">
                {newContacts.map(e => (
                    <li key={e.id ?? `${e.type}|${e.value}`}>
                        <span className="text-xs font-medium text-stone-500">{t(`adopter.ce_type_${e.type}`)}: </span>
                        <span className="[overflow-wrap:anywhere]">{e.value.trim()}</span>
                    </li>
                ))}
                {typedText && (
                    <li>
                        <span className="text-xs font-medium text-stone-500">{t('adopter.contact') || 'Contacto'}: </span>
                        <span className="[overflow-wrap:anywhere]">{typedText}</span>
                    </li>
                )}
                {family && (
                    <li>
                        <span className="text-xs font-medium text-stone-500">{t('adopter.family_members') || 'Familia'}: </span>
                        <span className="[overflow-wrap:anywhere]">{family}</span>
                    </li>
                )}
                {records > 0 && (
                    <li data-testid="continue-merge-records">
                        {records === 1 ? t('adopter.dup_hint_records_one') : t('adopter.dup_hint_records_many').replace('{n}', String(records))}
                    </li>
                )}
            </ul>
        </div>
    );
}
