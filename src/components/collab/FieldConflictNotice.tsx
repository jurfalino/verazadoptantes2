'use client';

/**
 * Per-field collision notice, the same shape as the contract editor's
 * (ContractSectionsEditor): «<Nombre> cambió <el campo> mientras editabas.»
 * with «Ver su versión» (their value next to the editor, which still holds
 * mine and can be edited) and «Guardar la mía igual».
 */
import { useState, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { conflictMessage, theirVersionLabel, keepTheirsLabel, updatedByLabel } from '@/lib/collabCopy';

interface Props {
    field: string;
    by: string;
    /** Their stored value, already formatted for display. */
    theirs: ReactNode;
    onKeepMine: () => void;
    onKeepTheirs: () => void;
    saving?: boolean;
    testId?: string;
}

const linkBtn = 'min-h-11 px-2 text-sm font-semibold text-teal-700 hover:text-teal-800 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed';

export function FieldConflictNotice({ field, by, theirs, onKeepMine, onKeepTheirs, saving = false, testId }: Props) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const id = testId ?? `field-conflict-${field}`;
    return (
        <div role="alert" className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2" data-testid={id}>
            <p className="text-sm text-amber-900">{conflictMessage(t, field, by)}</p>
            {open && (
                <div className="space-y-1" data-testid={`${id}-theirs`}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{theirVersionLabel(t, by)}</p>
                    <div className="rounded-lg border border-stone-200 bg-white p-2 text-sm text-stone-900 whitespace-pre-wrap break-words">
                        {theirs === null || theirs === undefined || theirs === '' ? <span className="italic text-stone-500">{t('collab.empty_value')}</span> : theirs}
                    </div>
                </div>
            )}
            <div className="flex flex-wrap gap-2">
                <button type="button" className={linkBtn} onClick={() => setOpen(o => !o)} data-testid={`${id}-view`}>
                    {open ? t('collab.hide_theirs') : t('collab.view_theirs')}
                </button>
                {open && (
                    <button type="button" className={linkBtn} disabled={saving} onClick={onKeepTheirs} data-testid={`${id}-keep-theirs`}>
                        {keepTheirsLabel(t, by)}
                    </button>
                )}
                <button type="button" className={linkBtn} disabled={saving} onClick={onKeepMine} data-testid={`${id}-keep-mine`}>
                    {t('collab.keep_mine')}
                </button>
            </div>
        </div>
    );
}

/** «Actualizado por <Nombre>» — shown next to a field a teammate changed while this form was open. */
export function UpdatedByBadge({ by, testId }: { by: string; testId?: string }) {
    const { t } = useLanguage();
    return <span className="text-xs font-semibold text-teal-700" data-testid={testId}>{updatedByLabel(t, by)}</span>;
}
