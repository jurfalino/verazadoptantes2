'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Phone, Mail, AtSign, IdCard, MapPin, StickyNote, UserRound, Lock,
    Pencil, Trash2, Check, X, Plus, type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import type { ContactEntry, ContactEntryType } from '@/lib/contactEntries';
import { addContactEntry } from '@/app/actions/addContactEntry';
import { updateContactEntry } from '@/app/actions/updateContactEntry';
import { removeContactEntry } from '@/app/actions/removeContactEntry';
import { extractErrorId } from '@/lib/errorUtils';
import { renderTextWithLinks } from '@/lib/textUtils';

const TYPE_ICON: Record<ContactEntryType, LucideIcon> = {
    phone: Phone,
    email: Mail,
    social: AtSign,
    id: IdCard,
    address: MapPin,
    alias: UserRound,
    other: StickyNote,
};

/** Read order — actionable contact methods first, aliases near top (name-like), notes last. */
const DISPLAY_ORDER: ContactEntryType[] = ['alias', 'phone', 'email', 'social', 'address', 'id', 'other'];

/** Types offered in the add composer chip row. `other` is not contributable
 *  through this surface (notes belong on the activity record, not contact). */
const COMPOSABLE_TYPES: ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address', 'alias'];

const LINK_CLASS = 'text-teal-700 hover:underline';

const UNDO_DELAY_MS = 5000;

interface Props {
    entries: ContactEntry[];
    /**
     * Server mode (existing adopter): `adopterId` set, no `onChange`. Add /
     * edit / delete fire the corresponding server actions. Required for the
     * profile-page rendering.
     *
     * Local mode (new-adopter creation): `adopterId` omitted, `onChange`
     * provided. Add / edit / delete mutate locally and emit the next entries
     * array via `onChange`. The parent batches everything through saveAdopter
     * on create. Lets the SAME component drive both flows so the user sees
     * the same add UX regardless of context.
     */
    adopterId?: string;
    onChange?: (next: ContactEntry[]) => void;
    /** True if the viewer can edit/remove ANY entry (owner/admin). In local
     *  mode always true (you're creating it). Per-entry contributor-self
     *  edit is computed in addition to this — see `currentUser` below. */
    canEditAll: boolean;
    /** Current viewer's email. Combined with each entry's `addedBy` to
     *  surface edit/delete on entries the viewer themselves contributed,
     *  even when they are not owner/admin. Server gates apply the same
     *  rule, so a stale/tampered UI can't bypass it. */
    currentUser?: string;
    /** Tap-handler for masked chips — opens the verify popover. Undefined when
     * the viewer is not subject to PII gating. Server mode only. */
    onMaskedClick?: (entryType: ContactEntryType) => void;
}

interface EditDraft {
    value: string;
    streetAndNumber: string;
    locality: string;
}

function socialHref(value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+\//.test(v)) return `https://${v}`;
    return null;
}

export default function ContactEntriesSection({ entries, adopterId, onChange, canEditAll, currentUser, onMaskedClick }: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const isLocalMode = !!onChange;

    // Per-entry edit gate: owner/admin can edit anything; everyone else can
    // edit entries they themselves contributed (matches the server-side
    // gate in update/removeContactEntry).
    const canEditEntry = (entry: ContactEntry): boolean =>
        canEditAll || (!!currentUser && !!entry.addedBy && entry.addedBy === currentUser);

    // Add composer state.
    const [composerOpen, setComposerOpen] = useState(false);
    const [composerType, setComposerType] = useState<ContactEntryType>('phone');
    const [composerValue, setComposerValue] = useState('');
    const [composerStreet, setComposerStreet] = useState('');
    const [composerLocality, setComposerLocality] = useState('');
    const [composerBusy, setComposerBusy] = useState(false);

    // Edit state — the id of the entry currently being edited (one at a time).
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<EditDraft>({ value: '', streetAndNumber: '', locality: '' });
    const [editBusy, setEditBusy] = useState(false);

    // Optimistic delete state. While `pendingDeleteId` is set, that entry is
    // hidden from the list and an inline undo bar is shown; on timer expiry
    // removeContactEntry fires, on Deshacer click the timer is cleared.
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    }, []);

    // Focus restoration — when the composer closes (either after a successful
    // add or after Cancelar), return focus to the trigger button so keyboard
    // users can continue without re-tabbing. wasOpenRef gates the first mount
    // so we don't steal focus from the page on initial render.
    const triggerRef = useRef<HTMLButtonElement>(null);
    const wasComposerOpenRef = useRef(false);
    useEffect(() => {
        if (wasComposerOpenRef.current && !composerOpen) {
            triggerRef.current?.focus();
        }
        wasComposerOpenRef.current = composerOpen;
    }, [composerOpen]);

    const visibleEntries = entries.filter(e => e.id !== pendingDeleteId);
    const sorted = [...visibleEntries].sort(
        (a, b) => DISPLAY_ORDER.indexOf(a.type) - DISPLAY_ORDER.indexOf(b.type),
    );

    const labelFor = (entry: ContactEntry): string =>
        entry.type === 'id' && entry.label?.trim()
            ? entry.label.trim()
            : t(`adopter.ce_type_${entry.type}`);

    function resetComposer() {
        setComposerType('phone');
        setComposerValue('');
        setComposerStreet('');
        setComposerLocality('');
        setComposerOpen(false);
    }

    function buildNewEntry(): ContactEntry {
        if (composerType === 'address') {
            return {
                id: crypto.randomUUID(),
                type: 'address',
                value: [composerStreet.trim(), composerLocality.trim()].filter(Boolean).join(', '),
                streetAndNumber: composerStreet.trim() || undefined,
                locality: composerLocality.trim() || undefined,
            };
        }
        return { id: crypto.randomUUID(), type: composerType, value: composerValue.trim() };
    }

    async function handleAdd() {
        const hasContent = composerType === 'address'
            ? (composerStreet.trim().length > 0 || composerLocality.trim().length > 0)
            : composerValue.trim().length > 0;
        if (!hasContent || composerBusy) return;

        // Local mode (new-adopter creation): mutate in place, emit via onChange.
        // No server action; the parent batches everything through saveAdopter
        // on create.
        if (isLocalMode) {
            const newEntry = buildNewEntry();
            onChange!([...entries, newEntry]);
            resetComposer();
            return;
        }

        // Server mode (existing adopter): the original addContactEntry path.
        setComposerBusy(true);
        try {
            const payload: Parameters<typeof addContactEntry>[0] = composerType === 'address'
                ? {
                    adopterId: adopterId!,
                    type: 'address',
                    value: [composerStreet.trim(), composerLocality.trim()].filter(Boolean).join(', '),
                    streetAndNumber: composerStreet.trim() || undefined,
                    locality: composerLocality.trim() || undefined,
                }
                : { adopterId: adopterId!, type: composerType, value: composerValue.trim() };
            const res = await addContactEntry(payload);
            if (res.ok) {
                resetComposer();
                router.refresh();
            } else {
                toast.error(t('errors.generic'), res.error || t('adopter.ce_add_error'));
            }
        } catch (e) {
            toast.error(t('errors.generic'), t('adopter.ce_add_error'), extractErrorId(e));
        } finally {
            setComposerBusy(false);
        }
    }

    function startEdit(entry: ContactEntry) {
        if (!entry.id) return;
        // Cancel any pending delete first so the user doesn't accidentally
        // lose the entry they just opened.
        cancelPendingDelete();
        setEditingId(entry.id);
        setEditDraft({
            value: entry.value,
            streetAndNumber: entry.streetAndNumber ?? '',
            locality: entry.locality ?? '',
        });
    }

    function cancelEdit() {
        setEditingId(null);
        setEditDraft({ value: '', streetAndNumber: '', locality: '' });
    }

    async function commitEdit(entry: ContactEntry) {
        if (!entry.id || editBusy) return;
        const hasContent = entry.type === 'address'
            ? (editDraft.streetAndNumber.trim().length > 0 || editDraft.locality.trim().length > 0)
            : editDraft.value.trim().length > 0;
        if (!hasContent) return;

        // Local mode: build the updated entry in place, emit.
        if (isLocalMode) {
            const updated: ContactEntry = entry.type === 'address'
                ? {
                    id: entry.id,
                    type: 'address',
                    value: [editDraft.streetAndNumber.trim(), editDraft.locality.trim()].filter(Boolean).join(', '),
                    streetAndNumber: editDraft.streetAndNumber.trim() || undefined,
                    locality: editDraft.locality.trim() || undefined,
                }
                : {
                    id: entry.id,
                    type: entry.type,
                    value: editDraft.value.trim(),
                    ...(entry.label ? { label: entry.label } : {}),
                };
            onChange!(entries.map(e => (e.id === entry.id ? updated : e)));
            cancelEdit();
            return;
        }

        setEditBusy(true);
        try {
            const payload: Parameters<typeof updateContactEntry>[0] = entry.type === 'address'
                ? {
                    adopterId: adopterId!, entryId: entry.id,
                    value: [editDraft.streetAndNumber.trim(), editDraft.locality.trim()].filter(Boolean).join(', '),
                    streetAndNumber: editDraft.streetAndNumber.trim() || undefined,
                    locality: editDraft.locality.trim() || undefined,
                }
                : { adopterId: adopterId!, entryId: entry.id, value: editDraft.value.trim() };
            const res = await updateContactEntry(payload);
            if (res.ok) {
                cancelEdit();
                router.refresh();
            } else {
                toast.error(t('errors.generic'), res.error || t('adopter.ce_edit_error'));
            }
        } catch (e) {
            toast.error(t('errors.generic'), t('adopter.ce_edit_error'), extractErrorId(e));
        } finally {
            setEditBusy(false);
        }
    }

    function startDelete(entry: ContactEntry) {
        if (!entry.id) return;
        // If something is currently being edited, cancel — the user shouldn't
        // be able to edit a chip that's about to disappear.
        if (editingId === entry.id) cancelEdit();
        // Cancel any other in-flight delete first; chain them serially.
        cancelPendingDelete();
        setPendingDeleteId(entry.id);
        const entryIdToDelete = entry.id;
        deleteTimerRef.current = setTimeout(async () => {
            deleteTimerRef.current = null;

            // Local mode: emit the filtered array, done.
            if (isLocalMode) {
                onChange!(entries.filter(e => e.id !== entryIdToDelete));
                setPendingDeleteId(null);
                return;
            }

            try {
                const res = await removeContactEntry({ adopterId: adopterId!, entryId: entryIdToDelete });
                if (!res.ok) {
                    // Restore on server failure.
                    setPendingDeleteId(null);
                    toast.error(t('errors.generic'), res.error || t('adopter.ce_delete_error'));
                    return;
                }
                setPendingDeleteId(null);
                router.refresh();
            } catch (e) {
                setPendingDeleteId(null);
                toast.error(t('errors.generic'), t('adopter.ce_delete_error'), extractErrorId(e));
            }
        }, UNDO_DELAY_MS);
    }

    function cancelPendingDelete() {
        if (deleteTimerRef.current) {
            clearTimeout(deleteTimerRef.current);
            deleteTimerRef.current = null;
        }
        setPendingDeleteId(null);
    }

    function renderValueReadOnly(entry: ContactEntry) {
        if (entry.masked) {
            if (onMaskedClick) {
                return (
                    <button
                        type="button"
                        onClick={() => onMaskedClick(entry.type)}
                        aria-label={t('adopter.pii_masked_chip_aria')}
                        className="inline-flex items-center gap-1.5 text-stone-500 hover:text-teal-700 hover:bg-teal-50 -mx-1.5 -my-0.5 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer group"
                    >
                        <Lock className="w-3 h-3 opacity-60 group-hover:opacity-100" aria-hidden="true" />
                        <span className="select-none">{entry.value}</span>
                    </button>
                );
            }
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
        if (entry.type === 'other') {
            return <span className="text-stone-700">{renderTextWithLinks(entry.value)}</span>;
        }
        return <span className="text-stone-800">{entry.value}</span>;
    }

    function placeholderFor(type: ContactEntryType): string {
        if (type === 'alias') return t('adopter.ce_alias_ph');
        return t(`adopter.ce_input_ph_${type}`) || '';
    }

    return (
        <div className="space-y-3">
            {/* Inline undo bar shown while a delete is in its 5-second window. */}
            {pendingDeleteId && (
                <div className="flex items-center justify-between gap-3 bg-stone-100 border border-stone-200 rounded-md px-3 py-2 text-sm">
                    <span className="text-stone-700">{t('adopter.ce_delete_toast')}</span>
                    <button
                        type="button"
                        onClick={cancelPendingDelete}
                        className="font-medium text-teal-700 hover:text-teal-900"
                    >
                        {t('adopter.ce_undo')}
                    </button>
                </div>
            )}

            {/* Chip list. */}
            {sorted.length > 0 && (
                <ul className="space-y-1.5">
                    {sorted.map(entry => {
                        const Icon = TYPE_ICON[entry.type];
                        const isEditing = editingId === entry.id;
                        return (
                            <li
                                key={entry.id || `${entry.type}:${entry.value}`}
                                className="group flex items-start gap-2 text-sm"
                                data-testid="ce-chip"
                                data-entry-type={entry.type}
                            >
                                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />
                                <span className="w-24 shrink-0 text-stone-500">{labelFor(entry)}</span>
                                <div className="flex-1 min-w-0">
                                    {isEditing ? (
                                        <div className="space-y-2">
                                            {entry.type === 'address' ? (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={editDraft.streetAndNumber}
                                                        onChange={e => setEditDraft({ ...editDraft, streetAndNumber: e.target.value })}
                                                        placeholder={t('adopter.ce_input_ph_address')}
                                                        className="w-full px-2 py-1 border border-stone-300 rounded text-sm"
                                                        autoFocus
                                                    />
                                                    <input
                                                        type="text"
                                                        value={editDraft.locality}
                                                        onChange={e => setEditDraft({ ...editDraft, locality: e.target.value })}
                                                        placeholder={t('adopter.ce_input_ph_locality')}
                                                        className="w-full px-2 py-1 border border-stone-300 rounded text-sm"
                                                    />
                                                </>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={editDraft.value}
                                                    onChange={e => setEditDraft({ ...editDraft, value: e.target.value })}
                                                    placeholder={placeholderFor(entry.type)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') { e.preventDefault(); commitEdit(entry); }
                                                        if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                                                    }}
                                                    className="w-full px-2 py-1 border border-stone-300 rounded text-sm"
                                                    autoFocus
                                                />
                                            )}
                                            <div className="flex items-center gap-2 justify-end">
                                                <button
                                                    type="button"
                                                    onClick={cancelEdit}
                                                    disabled={editBusy}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded transition-colors"
                                                >
                                                    <X className="w-3.5 h-3.5" /> {t('adopter.ce_edit_cancel')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => commitEdit(entry)}
                                                    disabled={editBusy}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                                                    data-testid="ce-edit-save"
                                                >
                                                    <Check className="w-3.5 h-3.5" /> {t('adopter.ce_edit_save')}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-start justify-between gap-2">
                                            <span className="font-medium text-stone-800 flex-1 min-w-0" style={{ overflowWrap: 'anywhere' }}>
                                                {renderValueReadOnly(entry)}
                                            </span>
                                            {canEditEntry(entry) && !entry.masked && entry.id && (
                                                <span className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                                                    <button
                                                        type="button"
                                                        onClick={() => startEdit(entry)}
                                                        aria-label={t('adopter.ce_edit_label')}
                                                        title={t('adopter.ce_edit_label')}
                                                        className="p-1 text-stone-500 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors"
                                                        data-testid="ce-edit-btn"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => startDelete(entry)}
                                                        aria-label={t('adopter.ce_delete_label')}
                                                        title={t('adopter.ce_delete_label')}
                                                        className="p-1 text-stone-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                                                        data-testid="ce-delete-btn"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* Empty state — when there are no entries to show, surface a
                hint and emphasise the composer trigger so it reads as the
                primary affordance instead of a faint link tucked at the
                bottom. Suppressed when an undo bar is up (the deleted entry's
                temporary absence isn't an empty state). */}
            {sorted.length === 0 && !pendingDeleteId && !composerOpen && (
                <p className="text-sm text-stone-500 italic">{t('adopter.ce_empty')}</p>
            )}

            {/* Inline add composer. Collapsed: just the "+ Agregar dato" trigger.
                Styled as a faint link when entries exist (secondary action) and
                as a button when the list is empty (primary action — see above).
                Expanded: type chip row + value input + cancel/add buttons. */}
            <div className="pt-1">
                {!composerOpen ? (
                    <button
                        type="button"
                        ref={triggerRef}
                        onClick={() => setComposerOpen(true)}
                        data-testid="ce-add-trigger"
                        className={
                            sorted.length === 0
                                ? 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-md transition-colors'
                                : 'inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-900 transition-colors'
                        }
                    >
                        <Plus className="w-4 h-4" />
                        {t('adopter.contrib_cta')}
                    </button>
                ) : (
                    <div className="space-y-2 border border-stone-200 rounded-md p-3 bg-stone-50">
                        <div className="flex flex-wrap gap-1.5">
                            {COMPOSABLE_TYPES.map(typ => {
                                const Icon = TYPE_ICON[typ];
                                const active = composerType === typ;
                                return (
                                    <button
                                        key={typ}
                                        type="button"
                                        onClick={() => setComposerType(typ)}
                                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                                            active
                                                ? 'bg-teal-600 text-white'
                                                : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-100'
                                        }`}
                                        data-testid={`ce-type-${typ}`}
                                    >
                                        <Icon className="w-3 h-3" />
                                        {t(`adopter.ce_type_${typ}`)}
                                    </button>
                                );
                            })}
                        </div>
                        {composerType === 'address' ? (
                            <div className="space-y-2">
                                <input
                                    type="text"
                                    value={composerStreet}
                                    onChange={e => setComposerStreet(e.target.value)}
                                    placeholder={t('adopter.ce_input_ph_address')}
                                    className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                                    autoFocus
                                />
                                <input
                                    type="text"
                                    value={composerLocality}
                                    onChange={e => setComposerLocality(e.target.value)}
                                    placeholder={t('adopter.ce_input_ph_locality')}
                                    className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                                />
                            </div>
                        ) : (
                            <input
                                type="text"
                                value={composerValue}
                                onChange={e => setComposerValue(e.target.value)}
                                placeholder={placeholderFor(composerType)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
                                    if (e.key === 'Escape') { e.preventDefault(); resetComposer(); }
                                }}
                                className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                                autoFocus
                            />
                        )}
                        {/* Bottom action row — kept structurally identical to
                            the inline-edit row above (right-aligned, same
                            sizing, same icons, same Cancel + Save order) so
                            adding a new entry feels the same as editing one. */}
                        <div className="flex items-center gap-2 justify-end">
                            <button
                                type="button"
                                onClick={resetComposer}
                                disabled={composerBusy}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded transition-colors"
                            >
                                <X className="w-3.5 h-3.5" /> {t('adopter.ce_edit_cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleAdd}
                                disabled={composerBusy}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                                data-testid="ce-composer-submit"
                            >
                                <Check className="w-3.5 h-3.5" /> {t('adopter.ce_edit_save')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
