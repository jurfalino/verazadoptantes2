'use client';

/**
 * A single directly-editable field: tap → edit inline → autosaves on blur → a
 * 5-second "Deshacer" to revert. The same model the contact entries use, so
 * every simple profile field (name, family) behaves identically — no batch
 * "edit mode", no global Save button.
 *
 * `onSave(next)` performs the actual persistence and returns whether it stuck;
 * on failure the field stays in edit so nothing is silently lost. `required`
 * blocks committing an empty value. Undo just calls `onSave(previous)`.
 */

import { useState, useRef, useEffect, type ReactNode } from 'react';
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
    /** Applied to the component's outer wrapper (e.g. `min-w-0 flex-1` when the
     *  field sits inline in a flex row next to a badge). */
    rootClassName?: string;
}

export function InlineEditField({
    value, onSave, canEdit, multiline = false, required = false,
    placeholder, ariaLabel, displayRender, emptyLabel, displayClassName, inputClassName, rootClassName,
}: Props) {
    const { t } = useLanguage();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const [undoValue, setUndoValue] = useState<string | null>(null);
    const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

    useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
    useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

    function startEdit() {
        if (!canEdit) return;
        setUndoValue(null);
        setDraft(value);
        setError(false);
        setEditing(true);
    }
    function cancel() { setEditing(false); setError(false); setDraft(value); }

    async function commit() {
        const next = draft.trim();
        if (required && !next) { setError(true); inputRef.current?.focus(); return; }
        if (next === value.trim()) { setEditing(false); return; }
        const prev = value;
        setBusy(true);
        const ok = await onSave(next);
        setBusy(false);
        if (!ok) return; // stay in edit; the caller surfaces the error toast
        setEditing(false);
        setUndoValue(prev);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndoValue(null), 5000);
    }

    async function undo() {
        if (undoValue === null) return;
        const prev = undoValue;
        setUndoValue(null);
        if (undoTimer.current) clearTimeout(undoTimer.current);
        await onSave(prev);
    }

    if (editing) {
        const shared = {
            ref: inputRef,
            value: draft,
            disabled: busy,
            placeholder,
            'aria-label': ariaLabel,
            autoFocus: true,
            onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => { setDraft(e.target.value); if (error) setError(false); },
            onBlur: commit,
            onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                if (e.key === 'Enter' && !multiline) { e.preventDefault(); (e.target as HTMLElement).blur(); }
            },
            className: inputClassName,
        };
        return (
            <div className={rootClassName}>
                <div className="flex items-start gap-2">
                    {multiline ? <textarea rows={2} {...shared} /> : <input type="text" {...shared} />}
                    {/* onMouseDown preventDefault so clicking ✕ doesn't blur-commit first. */}
                    <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={cancel}
                        aria-label={t('common.cancel')}
                        className="flex-none w-6 h-6 mt-1 rounded-full flex items-center justify-center text-xs border"
                        style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)', borderColor: 'var(--border-default)' }}
                    >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                </div>
                <p className="text-[11px] mt-1" style={{ color: error ? 'var(--status-error-text)' : 'var(--text-muted)' }}>
                    {error ? t('adopter.field_required') : t('adopter.tap_outside_to_save')}
                </p>
            </div>
        );
    }

    const isEmpty = !value.trim();
    return (
        <div className={rootClassName}>
            <div
                className={`group/inline flex items-center gap-2 ${canEdit ? 'cursor-pointer' : 'cursor-default'} ${displayClassName || ''}`}
                onClick={startEdit}
                title={canEdit ? (t('common.edit') || 'Editar') : undefined}
            >
                <div className={`min-w-0 flex-1 ${isEmpty ? 'italic' : ''}`} style={isEmpty ? { color: 'var(--text-muted)' } : undefined}>
                    {isEmpty ? (emptyLabel || '') : (displayRender ? displayRender(value) : value)}
                </div>
                {canEdit && (
                    <svg className="flex-none w-3.5 h-3.5 opacity-0 group-hover/inline:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M15.2 5.2l3.6 3.6M4 20l3.5-.5L18.7 8.3a2.5 2.5 0 10-3.5-3.5L4 16v4z" />
                    </svg>
                )}
            </div>
            {undoValue !== null && (
                <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium rounded-md px-2 py-0.5"
                    style={{ color: 'var(--btn-primary-bg)', background: 'var(--teal-050, rgba(45,212,191,.14))' }}>
                    ✓ {t('adopter.ce_autocommit_saved')}
                    <span style={{ opacity: 0.4 }}>·</span>
                    <button type="button" onClick={undo} className="underline font-semibold">{t('adopter.ce_undo')}</button>
                </span>
            )}
        </div>
    );
}
