'use client';

/**
 * The household member card's dialogs (households as profiles, prototype
 * states Q1, D1, D2): the house modal shell (ConfirmDialog / the profile's
 * delete modal), rendered on <body> so no ancestor's stacking context traps it.
 *
 * - `RemoveFromHomeDialog` (Q1): «Quitar del hogar» asks why — «Lo cargué por
 *   error» ('mistake': no «No convive» memory) or «No vive acá» ('not_living':
 *   a correction; a re-add is a dispute). For a gift recipient there is no
 *   «why»: it is a plain confirm ('mistake').
 * - `RequestDeletionDialog` (D1): the owner, others contributed → admins decide.
 * - `DeleteProfileDialog` (D2): the owner with nobody else's data, or an admin.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/context/LanguageContext';
import { fill, firstName } from '@/lib/householdCopy';

export type RemoveReason = 'mistake' | 'not_living';

export type DeletionCollaborators = { adoptions: number; images: number; edits: number; flags: number; forms: number };

function Modal({ label, onCancel, busy, children, testId }: { label: string; onCancel: () => void; busy: boolean; children: ReactNode; testId: string }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [busy, onCancel]);
    if (!mounted) return null;
    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--overlay-bg)' }} role="presentation"
            onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
            <div className="rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4 max-h-[90svh] overflow-y-auto" style={{ background: 'var(--surface-card)' }}
                role="dialog" aria-modal="true" aria-label={label} data-testid={testId}>
                {children}
            </div>
        </div>,
        document.body,
    );
}

const CANCEL_BTN = 'flex-1 min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors';
const DANGER_BTN = 'flex-1 min-h-[44px] px-4 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

function Buttons({ busy, onCancel, onConfirm, label, disabled = false, cancelLabel, confirmTestId }: {
    busy: boolean; onCancel: () => void; onConfirm: () => void; label: string; disabled?: boolean; cancelLabel: string; confirmTestId: string;
}) {
    const cancelRef = useRef<HTMLButtonElement>(null);
    // Focus on «Cancelar»: an accidental Enter on a destructive dialog does nothing.
    useEffect(() => { cancelRef.current?.focus(); }, []);
    return (
        <div className="flex gap-3 pt-1">
            <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} data-testid="hh-dialog-cancel" className={CANCEL_BTN} style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}>{cancelLabel}</button>
            <button type="button" onClick={onConfirm} disabled={busy || disabled} data-testid={confirmTestId} className={DANGER_BTN}>{busy ? '…' : label}</button>
        </div>
    );
}

/** Q1 — «¿Por qué quitás a Marta Paez del hogar de Pedro Paez?» */
export function RemoveFromHomeDialog({ person, host, gift = false, busy, onCancel, onConfirm }: {
    person: string; host: string; gift?: boolean; busy: boolean;
    onCancel: () => void; onConfirm: (reason: RemoveReason) => void;
}) {
    const { t } = useLanguage();
    const [why, setWhy] = useState<RemoveReason | null>(null);
    const names = { person, host };
    if (gift) {
        return (
            <Modal label={fill(t('adopter.hh_remove_gift_title'), names)} onCancel={onCancel} busy={busy} testId="hh-remove-dialog">
                <div className="space-y-1.5">
                    <h3 className="text-base font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{fill(t('adopter.hh_remove_gift_title'), names)}</h3>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{fill(t('adopter.hh_remove_gift_body'), names)}</p>
                </div>
                <Buttons busy={busy} onCancel={onCancel} onConfirm={() => onConfirm('mistake')} label={t('adopter.hh_remove_gift_confirm')} cancelLabel={t('common.cancel')} confirmTestId="hh-remove-confirm" />
            </Modal>
        );
    }
    const short = { person: firstName(person) || person, host: firstName(host) || host };
    const opt = (v: RemoveReason, title: string, desc: string) => {
        const on = why === v;
        return (
            <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${on ? 'border-teal-400 bg-teal-50' : 'border-stone-200 hover:bg-stone-50'}`} data-testid={`hh-remove-why-${v}`}>
                {/* A drawn radio: the native one paints its own (white) fill in dark mode; this one is teal when chosen. */}
                <input type="radio" name="hh-remove-why" checked={on} onChange={() => setWhy(v)} className="sr-only peer" />
                <span aria-hidden="true" data-checked={on ? 'true' : 'false'}
                    className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-500 peer-focus-visible:ring-offset-1 ${on ? 'border-teal-600 bg-teal-600' : ''}`}
                    style={on ? undefined : { borderColor: 'var(--text-muted)' }}>
                    {on && <span className="w-2 h-2 rounded-full" style={{ background: '#fff' }} />}
                </span>
                <span className="min-w-0">
                    <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
                    <span className="block text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{desc}</span>
                </span>
            </label>
        );
    };
    return (
        <Modal label={fill(t('adopter.hh_remove_title'), names)} onCancel={onCancel} busy={busy} testId="hh-remove-dialog">
            <div className="space-y-1.5">
                <h3 className="text-base font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{fill(t('adopter.hh_remove_title'), names)}</h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('adopter.hh_remove_body')}</p>
            </div>
            <div className="space-y-2" role="radiogroup">
                {opt('mistake', t('adopter.hh_remove_mistake'), t('adopter.hh_remove_mistake_desc'))}
                {opt('not_living', t('adopter.hh_remove_not_living'), fill(t('adopter.hh_remove_not_living_desc'), short))}
            </div>
            <Buttons busy={busy} disabled={!why} onCancel={onCancel} onConfirm={() => { if (why) onConfirm(why); }} label={t('adopter.hh_remove_confirm')} cancelLabel={t('common.cancel')} confirmTestId="hh-remove-confirm" />
        </Modal>
    );
}

/**
 * «Contribuciones de otros usuarios: • 1 edición • 3 fotos» — what others added, on
 * every «can't delete, ask the admins» dialog (the profile's own and a household
 * row's). Singular for one (audit C4: «1 ediciones»).
 */
export function DeletionCollaboratorList({ collaborators: c }: { collaborators: DeletionCollaborators }) {
    const { t } = useLanguage();
    const line = (n: number, key: keyof DeletionCollaborators) => n > 0 && (
        <p key={key}>• {n} {t(`adopter.delete_collab_${key}${n === 1 ? '_one' : ''}`)}</p>
    );
    return (
        <div className="text-xs space-y-1 rounded-xl p-3" style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)' }} data-testid="delete-collab-list">
            <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t('adopter.delete_collab_detail')}:</p>
            {line(c.adoptions, 'adoptions')}
            {line(c.images, 'images')}
            {line(c.edits, 'edits')}
            {line(c.flags, 'flags')}
            {line(c.forms, 'forms')}
        </div>
    );
}

/** D1 — the owner can't delete (others contributed): ask the admins. */
export function RequestDeletionDialog({ name, collaborators, busy, onCancel, onConfirm }: {
    name: string; collaborators: DeletionCollaborators | null; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
    const { t } = useLanguage();
    const c = collaborators;
    return (
        <Modal label={fill(t('adopter.hh_request_title'), { name })} onCancel={onCancel} busy={busy} testId="hh-request-dialog">
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{fill(t('adopter.hh_request_title'), { name })}</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('adopter.hh_request_body')}</p>
            {c && <DeletionCollaboratorList collaborators={c} />}
            <Buttons busy={busy} onCancel={onCancel} onConfirm={onConfirm} label={t('adopter.hh_request_confirm')} cancelLabel={t('adopter.delete_cancel')} confirmTestId="hh-request-confirm" />
        </Modal>
    );
}

/** D2 — the owner with nobody else's data (or an admin): the profile's own delete confirm. */
export function DeleteProfileDialog({ name, host, busy, onCancel, onConfirm }: {
    name: string; host: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
    const { t } = useLanguage();
    return (
        <Modal label={fill(t('adopter.hh_delete_title'), { name })} onCancel={onCancel} busy={busy} testId="hh-delete-dialog">
            <h3 className="text-lg font-bold text-rose-600">{fill(t('adopter.hh_delete_title'), { name })}</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('adopter.delete_confirm_body')} {fill(t('adopter.hh_delete_body_extra'), { person: firstName(name) || name, host })}
            </p>
            <Buttons busy={busy} onCancel={onCancel} onConfirm={onConfirm} label={t('adopter.delete_confirm_btn')} cancelLabel={t('adopter.delete_cancel')} confirmTestId="hh-delete-confirm" />
        </Modal>
    );
}
