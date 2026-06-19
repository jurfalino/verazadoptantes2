'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Phone, Mail, AtSign, IdCard, MapPin, StickyNote, UserRound, Lock,
    Pencil, Trash2, Check, X, Plus, type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { deriveStreet, deriveLocality, type ContactEntry, type ContactEntryType } from '@/lib/contactEntries';
import { addContactEntry } from '@/app/actions/addContactEntry';
import { updateContactEntry } from '@/app/actions/updateContactEntry';
import { removeContactEntry } from '@/app/actions/removeContactEntry';
import { extractErrorId } from '@/lib/errorUtils';
import { renderTextWithLinks } from '@/lib/textUtils';
import DuplicateHint from '@/components/DuplicateHint';

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
    /** v2.19.47: adopter-level `is_public` flag, plumbed down from
     *  AdopterForm. The microcopy under the chip list honours BOTH this and
     *  the existence of any per-entry `isPublic:true` (legacy FB imports
     *  before per-record consent existed) so the UI stays accurate without
     *  a backfill. The model itself stays as-is — we just account for
     *  visibility at the PROFILE level in this surface; per-field
     *  visibility is left for a future change. */
    adopterIsPublic?: boolean;
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

export default function ContactEntriesSection({ entries, adopterId, onChange, canEditAll, currentUser, onMaskedClick, adopterIsPublic = false }: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const isLocalMode = !!onChange;

    // Per-entry edit gate: owner/admin can edit anything; everyone else can
    // edit entries they themselves contributed (matches the server-side
    // gate in update/removeContactEntry).
    const canEditEntry = (entry: ContactEntry): boolean =>
        canEditAll || (!!currentUser && !!entry.addedBy && entry.addedBy === currentUser);

    // Three-state composer (v2.18.4):
    //   - 'closed'    → only the "+ Agregar contacto" trigger is visible.
    //   - 'pick-type' → trigger replaced by a small panel asking "¿Qué dato
    //                   querés agregar?" with the type pills. No input field.
    //   - 'editing'   → panel shows the input(s) for the chosen type plus
    //                   Cancel + Save buttons, styled identically to the
    //                   in-row edit form (so add and edit feel symmetric).
    // The previous two-state model (closed + open with pills-and-input
    // simultaneously) had a UX hazard: the type pill row in the open state
    // looked like a multi-field form, so users typed a phone, clicked the
    // address pill expecting "add address too", and silently lost the
    // phone (patched defensively in v2.18.1 with auto-commit-on-pill-switch
    // toast — a bandaid). The three-state split eliminates the ambiguity
    // entirely: pills only fire when no input exists yet, so there's
    // nothing to lose.
    // v2.19.32: on a fresh new-adopter form (local mode, no entries yet) we
    // pre-open the composer in 'editing' stage with type='phone'. Every
    // record in practice starts with a phone number, so making the rescuer
    // click "Agregar → Teléfono" before they can type one is friction
    // without information value. The phone input has autoFocus, so the
    // cursor lands directly in it on first paint — they just type the
    // number. After Save or Cancel, the composer collapses back to the
    // trigger button so adding a SECOND entry still goes through the
    // type-picker (where the choice actually matters). Existing-record
    // views and forms that already have entries keep the default 'closed'
    // start — we don't want to surprise editors with an unsolicited input.
    const [composerStage, setComposerStage] = useState<'closed' | 'pick-type' | 'editing'>(
        () => isLocalMode && entries.length === 0 ? 'editing' : 'closed',
    );
    const [composerType, setComposerType] = useState<ContactEntryType>('phone');
    const [composerValue, setComposerValue] = useState('');
    const [composerStreet, setComposerStreet] = useState('');
    const [composerLocality, setComposerLocality] = useState('');
    const [composerBusy, setComposerBusy] = useState(false);
    // Debounced value handed to <DuplicateHint>. 500ms idle keeps server load
    // low and avoids flashing while typing. Local mode skips this entirely:
    // the new-adopter flow already has DuplicatePeek + StrongMatchStrip
    // hanging off the parent form, so a per-composer hint would be redundant.
    const [hintValue, setHintValue] = useState('');
    useEffect(() => {
        if (isLocalMode) { setHintValue(''); return; }
        const id = setTimeout(() => setHintValue(composerValue), 500);
        return () => clearTimeout(id);
    }, [composerValue, isLocalMode]);

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
        const isOpenNow = composerStage !== 'closed';
        if (wasComposerOpenRef.current && !isOpenNow) {
            triggerRef.current?.focus();
        }
        wasComposerOpenRef.current = isOpenNow;
    }, [composerStage]);

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
        clearComposerInputs();
        setComposerStage('closed');
    }

    /** Discard in-progress input + return to the pick-type stage so the
     *  user can choose a different type. Triggered by the "↺ cambiar"
     *  link in the editing stage. Per v2.18.4 design, this is a
     *  deliberate user-action discard — no auto-commit fallback. */
    function returnToPickType() {
        clearComposerInputs();
        setComposerStage('pick-type');
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

    function composerHasContent(): boolean {
        return composerType === 'address'
            ? (composerStreet.trim().length > 0 || composerLocality.trim().length > 0)
            : composerValue.trim().length > 0;
    }

    /** Clear input fields but leave the composer panel open + the current
     *  active type. Used by the auto-commit path (handlePillClick) which
     *  needs to keep editing the composer with a different active type. */
    function clearComposerInputs() {
        setComposerValue('');
        setComposerStreet('');
        setComposerLocality('');
    }

    /**
     * Commit the composer's current contents as a new entry. Shared by:
     *  - handleAdd (Save button): full reset + close composer on success.
     *  - handlePillClick (auto-commit on type switch, v2.18.1): keep composer
     *    open and just clear inputs so the user can continue with the new type.
     *
     * `silent` suppresses the per-commit success toast so handlePillClick can
     * show its own transition toast ("✓ Guardado · Teléfono → Dirección")
     * without doubling up.
     */
    async function commitComposer({ silent = false } = {}): Promise<{ ok: boolean }> {
        if (!composerHasContent() || composerBusy) return { ok: false };

        // Local mode (new-adopter creation): mutate in place, emit via onChange.
        // No server action; the parent batches everything through saveAdopter
        // on create.
        if (isLocalMode) {
            const newEntry = buildNewEntry();
            onChange!([...entries, newEntry]);
            clearComposerInputs();
            return { ok: true };
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
                clearComposerInputs();
                router.refresh();
                if (!silent) {
                    // Contextual feedback. The server returns 'appended' for
                    // a brand-new entry, 'unlocked_existing' when the typed
                    // value matched an existing (probably masked) entry and
                    // earned the viewer a fresh entry-scope grant ("you
                    // proved you know it, here it is"), and 'no_change' when
                    // the value was already visible to the viewer. The
                    // unlocked-existing toast is load-bearing — without it
                    // the user thinks the add silently did nothing when
                    // actually a masked chip is about to reveal itself in
                    // the refreshed list.
                    if (res.status === 'appended') {
                        // v2.19.51: when a non-owner contributes, the server
                        // auto-fires a PII access request on their behalf.
                        // Surface that in the toast so they understand why
                        // they're not suddenly seeing the rest of the profile.
                        toast.success(
                            '✓',
                            t(res.autoRequestFiled ? 'adopter.ce_add_toast_added_with_request' : 'adopter.ce_add_toast_added'),
                        );
                    } else if (res.status === 'unlocked_existing') {
                        toast.success('🔓', t('adopter.ce_add_toast_unlocked'));
                    }
                    // status === 'no_change' → silent (it would be noise).
                }
                return { ok: true };
            } else {
                toast.error(t('errors.generic'), res.error || t('adopter.ce_add_error'));
                return { ok: false };
            }
        } catch (e) {
            toast.error(t('errors.generic'), t('adopter.ce_add_error'), extractErrorId(e));
            return { ok: false };
        } finally {
            setComposerBusy(false);
        }
    }

    /** Save button entry-point — commit and close composer on success. */
    async function handleAdd() {
        const result = await commitComposer();
        if (result.ok) resetComposer();
    }

    /**
     * Type-pill click handler. With the v2.18.4 three-state composer the
     * pills only render in the `pick-type` stage when no input value yet
     * exists — so this handler doesn't need the auto-commit safety net
     * from v2.18.1: there's nothing to lose. Set the type, advance to the
     * editing stage, focus the input.
     */
    function handlePillClick(newType: ContactEntryType) {
        setComposerType(newType);
        setComposerStage('editing');
    }

    function startEdit(entry: ContactEntry) {
        if (!entry.id) return;
        // Cancel any pending delete first so the user doesn't accidentally
        // lose the entry they just opened.
        cancelPendingDelete();
        setEditingId(entry.id);
        // For address entries: when the legacy single-`value` shape is the
        // only thing present, fall back through deriveStreet / deriveLocality
        // (split on first comma) so the form pre-fills with the existing
        // text instead of empty inputs. v2.16.0-13 fix.
        setEditDraft({
            value: entry.value,
            streetAndNumber: entry.type === 'address' ? deriveStreet(entry) : (entry.streetAndNumber ?? ''),
            locality: entry.type === 'address' ? deriveLocality(entry) : (entry.locality ?? ''),
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

    // v2.19.47: visibility shown at the PROFILE level only. The data model
    // still has per-entry `isPublic` (we keep it for a possible per-field
    // visibility feature later), but here we collapse to a single profile
    // verdict:
    //   - `adopterIsPublic` prop (admin-flippable record-level flag), OR
    //   - every entry in the list is per-entry-public (legacy FB-imports
    //     before per-record consent existed — their effective visibility is
    //     public, even though the record-level flag is 0).
    const profileEffectivelyPublic = adopterIsPublic
        || (sorted.length > 0 && sorted.every(e => e.isPublic === true));
    // v2.19.49: the microcopy ("Solo visible para vos y tus organizaciones")
    // is addressed to the owner / privileged viewer — the "you" in the copy
    // is them. Showing it to a stranger viewing the masked profile is
    // confusing: they see masked data + copy claiming "only you can see
    // this," and the "you" doesn't refer to them.
    // The cleanest signal we already have: `onMaskedClick` is passed by
    // `AdopterForm` ONLY when the viewer is non-privileged (it opens the
    // verify popover when they tap a masked chip). Its absence means the
    // viewer is privileged (owner / editor / admin / moderator / org-mate)
    // OR we're rendering on the new-adopter form. Either way, the microcopy
    // is appropriate for them. When it's present, the viewer is the stranger
    // — hide the line. Public profiles still show the "público" copy
    // regardless, since that statement is true for any viewer.
    const viewerIsPrivileged = !onMaskedClick;
    const showMicrocopy = profileEffectivelyPublic || viewerIsPrivileged;
    const microcopyKey = profileEffectivelyPublic
        ? 'adopter.ce_visibility_profile_public'
        : 'adopter.ce_visibility_microcopy';

    return (
        <div className="space-y-3">
            {showMicrocopy && (
                <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {profileEffectivelyPublic ? (
                        <svg className="w-3.5 h-3.5 mt-px shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path strokeLinecap="round" d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
                        </svg>
                    ) : (
                        <svg className="w-3.5 h-3.5 mt-px shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="5" y="11" width="14" height="9" rx="2" />
                            <path strokeLinecap="round" d="M8 11V8a4 4 0 118 0v3" />
                        </svg>
                    )}
                    <span>{t(microcopyKey as never)}</span>
                </p>
            )}

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
            {sorted.length === 0 && !pendingDeleteId && composerStage === 'closed' && (
                <p className="text-sm text-stone-500 italic">{t('adopter.ce_empty')}</p>
            )}

            {/* Inline three-stage composer (v2.18.4 — see composerStage docs above):
                  - closed    → just the "+ Agregar dato" trigger.
                  - pick-type → prompt + type pills + Cancel. NO input.
                  - editing   → "Agregando: <type> ↺ cambiar" header + input(s)
                                + DuplicateHint + Cancel + Save buttons, laid
                                out identically to the in-row edit form so add
                                and edit feel symmetric. */}
            <div className="pt-1">
                {composerStage === 'closed' && (
                    <button
                        type="button"
                        ref={triggerRef}
                        onClick={() => setComposerStage('pick-type')}
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
                )}

                {composerStage === 'pick-type' && (
                    <div className="space-y-3 border border-stone-200 rounded-md p-3 bg-stone-50">
                        <p className="text-sm font-medium text-stone-700">
                            {t('adopter.ce_compose_prompt')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {COMPOSABLE_TYPES.map((typ, idx) => {
                                const Icon = TYPE_ICON[typ];
                                return (
                                    <button
                                        key={typ}
                                        type="button"
                                        onClick={() => handlePillClick(typ)}
                                        // autoFocus on the first (phone) pill so
                                        // keyboard users can Enter to advance to
                                        // the editing stage with phone selected —
                                        // the common path. Mouse users see no
                                        // difference. Per user pick on the
                                        // v2.18.4 plan.
                                        autoFocus={idx === 0}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-white border border-stone-300 text-stone-700 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-800 focus:bg-teal-50 focus:border-teal-300 focus:text-teal-800 focus:outline-none transition-colors"
                                        data-testid={`ce-type-${typ}`}
                                    >
                                        <Icon className="w-3 h-3" />
                                        {t(`adopter.ce_type_${typ}`)}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center justify-end">
                            <button
                                type="button"
                                onClick={resetComposer}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded transition-colors"
                                data-testid="ce-pick-type-cancel"
                            >
                                <X className="w-3.5 h-3.5" /> {t('adopter.ce_edit_cancel')}
                            </button>
                        </div>
                    </div>
                )}

                {composerStage === 'editing' && (
                    <div className="space-y-2 border border-stone-200 rounded-md p-3 bg-stone-50">
                        {/* Header — names the type the user picked and offers
                            an explicit "↺ cambiar" link to return to the
                            pick-type stage (discards any in-progress input;
                            this is a user-initiated action so the discard is
                            never a surprise). */}
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-stone-600">
                                <span className="font-medium">{t('adopter.ce_compose_adding_label')}:</span>{' '}
                                <span className="text-stone-900">{t(`adopter.ce_type_${composerType}`)}</span>
                            </p>
                            <button
                                type="button"
                                onClick={returnToPickType}
                                disabled={composerBusy}
                                className="text-xs text-teal-700 hover:text-teal-900 hover:underline transition-colors disabled:opacity-50"
                                data-testid="ce-compose-change-type"
                            >
                                ↺ {t('adopter.ce_compose_change_type')}
                            </button>
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
                        {/* Cross-record duplicate warning. Renders nothing for
                            local mode, non-strong types, empty values, or
                            when no high-confidence match exists on another
                            adopter. excludeAdopterId={adopterId} ensures the
                            user's own profile never appears as a match. */}
                        {!isLocalMode && adopterId && composerType !== 'address' && (
                            <DuplicateHint
                                type={composerType}
                                value={hintValue}
                                excludeAdopterId={adopterId}
                            />
                        )}
                        {/* Action row — structurally identical to the
                            inline-edit row above (right-aligned, same sizing,
                            same icons, same Cancel + Save order) so adding
                            a new entry feels the same as editing one. */}
                        <div className="flex items-center gap-2 justify-end">
                            <button
                                type="button"
                                onClick={resetComposer}
                                disabled={composerBusy}
                                data-testid="ce-composer-cancel"
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
