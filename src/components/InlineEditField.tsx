'use client';

/**
 * A single directly-editable field, matching the contact-entry edit pattern
 * exactly (ContactEntriesSection): a hover-revealed pencil opens an inline
 * input with explicit Cancelar (✕) / Guardar (✓) buttons — Enter saves
 * (single-line), Escape cancels. No autosave-on-blur, no edit-undo (undo is
 * delete-only elsewhere), so every simple profile field edits the same way.
 *
 * `onSave(next)` persists and returns whether it stuck; on failure the field
 * stays in edit (the caller surfaces the error). `required` blocks saving empty.
 */

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Check, X, Pencil } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

interface Props {
    value: string;
    onSave: (next: string) => Promise<boolean>;
    canEdit: boolean;
    multiline?: boolean;
    required?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    /** Custom display renderer (e.g. linkified text). Defaults to the raw value. */
    displayRender?: (v: string) => ReactNode;
    /** Shown when the value is empty and the viewer can edit (a prompt to add). */
    emptyLabel?: string;
    displayClassName?: string;
    inputClassName?: string;
    /** Applied to the outer wrapper (e.g. `min-w-0 flex-1` inline in a flex row). */
    rootClassName?: string;
    /** data-testid for the pencil button (edit affordance), for e2e targeting. */
    editButtonTestId?: string;
    /** Fires when this field enters/leaves its inline-edit state, so a parent can
     *  react (e.g. hide a sibling badge while the name is being edited). */
    onEditingChange?: (editing: boolean) => void;
}

export function InlineEditField({
    value, onSave, canEdit, multiline = false, required = false,
    placeholder, ariaLabel, displayRender, emptyLabel, displayClassName, inputClassName,
    rootClassName, editButtonTestId, onEditingChange,
}: Props) {
    const { t } = useLanguage();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

    useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
    useEffect(() => { onEditingChange?.(editing); }, [editing, onEditingChange]);

    function startEdit() { if (!canEdit) return; setDraft(value); setEditing(true); }
    function cancelEdit() { setDraft(value); setEditing(false); }

    async function commit() {
        const next = draft.trim();
        if (required && !next) { inputRef.current?.focus(); return; }
        if (next === value.trim()) { setEditing(false); return; }
        setBusy(true);
        const ok = await onSave(next);
        setBusy(false);
        if (ok) setEditing(false); // else stay in edit — the caller toasts the error
    }

    if (editing) {
        const shared = {
            ref: inputRef,
            value: draft,
            disabled: busy,
            placeholder,
            'aria-label': ariaLabel,
            autoFocus: true,
            onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
            onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
            },
            className: inputClassName,
        };
        return (
            <div className={rootClassName}>
                {multiline ? <textarea rows={2} {...shared} /> : <input type="text" {...shared} />}
                <div className="flex items-center gap-2 justify-end mt-2">
                    <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded transition-colors disabled:opacity-50"
                    >
                        <X className="w-3.5 h-3.5" /> {t('adopter.ce_edit_cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={commit}
                        disabled={busy || (required && !draft.trim())}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                    >
                        <Check className="w-3.5 h-3.5" /> {t('adopter.ce_edit_save')}
                    </button>
                </div>
            </div>
        );
    }

    const isEmpty = !value.trim();
    return (
        <div className={rootClassName}>
            <div className={`group/inline flex items-center gap-2 ${displayClassName || ''}`}>
                <div className={`min-w-0 flex-1 ${isEmpty ? 'italic' : ''}`} style={isEmpty ? { color: 'var(--text-muted)' } : undefined}>
                    {isEmpty ? (emptyLabel || '') : (displayRender ? displayRender(value) : value)}
                </div>
                {canEdit && (
                    <button
                        type="button"
                        onClick={startEdit}
                        aria-label={t('adopter.ce_edit_label')}
                        title={t('adopter.ce_edit_label')}
                        data-testid={editButtonTestId}
                        className="shrink-0 p-1 text-stone-500 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors opacity-100 sm:opacity-0 sm:group-hover/inline:opacity-100 sm:focus-within:opacity-100"
                    >
                        <Pencil className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}
