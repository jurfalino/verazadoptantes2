'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Phone, Mail, AtSign, IdCard, MapPin, StickyNote, UserRound, Lock,
    Pencil, Trash2, Check, X, Plus, type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { deriveStreet, deriveLocality, detectSocialPlatform, socialUrl, phoneAppUrl, retypeDraft, SOCIAL_PLATFORMS, type ContactEntry, type ContactEntryType, type ContactDraft, type SocialPlatform, type MessagingApp } from '@/lib/contactEntries';
import { ContactTypePicker } from '@/components/ContactTypePicker';
import { SocialPlatformPicker } from '@/components/SocialPlatformPicker';
import { SocialLogo } from '@/components/SocialLogo';
import { PhoneAppsToggle } from '@/components/PhoneAppsToggle';
import { MessagingLogo } from '@/components/MessagingLogo';
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

/** Per-network brand label (Facebook / Instagram / ...), keyed by platform. */
const SOCIAL_LABEL = Object.fromEntries(SOCIAL_PLATFORMS.map(p => [p.key, p.label])) as Record<SocialPlatform, string>;

/**
 * A social entry that should render with its OWN network icon + name (Facebook,
 * Instagram, TikTok, X, Threads) instead of the generic "@ Red social" row.
 * Returns null only for a non-social entry or the 'other'/undetected network.
 * Masked rows still get the branded icon + name — only the handle value is
 * hidden; which network it is isn't treated as PII.
 */
function brandedSocialPlatform(entry: ContactEntry): Exclude<SocialPlatform, 'other'> | null {
    if (entry.type !== 'social') return null;
    const p = entry.platform;
    return p && p !== 'other' ? (p as Exclude<SocialPlatform, 'other'>) : null;
}

/** Types offered in the add composer chip row. `other` is not contributable
 *  through this surface (notes belong on the activity record, not contact). */
const COMPOSABLE_TYPES: ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address', 'alias'];

const LINK_CLASS = 'text-teal-700 hover:underline';

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
    /**
     * Let an existing entry's TYPE be corrected in place (local mode only).
     *
     * Off by default, and deliberately so: on a saved profile the type was
     * chosen on purpose a moment ago, and changing it would have to move the
     * value across server-side validation — delete and re-add is the honest
     * path there. The import wizard is the exception. Its whole job is
     * reviewing what the AI guessed, and it guesses types wrong — a document
     * number read as a phone, a note read as an address — so correcting one
     * in place is the point of the review step rather than an edge case.
     *
     * It reuses the composer's own pills, so the affordance is identical to
     * choosing the type in the first place.
     */
    allowTypeChange?: boolean;
    /**
     * Suppress the visibility line entirely.
     *
     * For a surface that owns the visibility decision itself — the import
     * wizard has its own labelled toggle with an explainer — this line is a
     * second statement about one setting sitting above the list. One signal,
     * not two (Nielsen #8), which is the same reason `hidePublicMicrocopy`
     * exists for the profile header.
     */
    hideVisibilityMicrocopy?: boolean;
    /** Override the "no entries yet" copy for contexts where "yet" is wrong. */
    emptyMessage?: string;
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
    /** When the profile header already shows the "Público" pill (read view), hide
     *  the redundant public eye line here — one signal, not two (Nielsen #8). The
     *  owner-only "solo visible para vos" (padlock) line is unaffected. */
    hidePublicMicrocopy?: boolean;
}

/**
 * The open row's draft. `type` is provisional: picking a new type in the edit
 * form only moves this, so the form can re-shape around it (a phone gains the
 * WhatsApp/Telegram toggle, a social gains the network picker) BEFORE anything
 * is committed. Cancelar reverts it with the rest of the draft. Only meaningful
 * in local mode with `allowTypeChange`; server mode has no way to move a value
 * across type validation, so it stays pinned to the entry's own type.
 *
 * The shape and its type transition live in `lib/contactEntries` so the
 * field-carry rules are unit-testable without rendering the component.
 */
type EditDraft = ContactDraft;

function socialHref(value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+\//.test(v)) return `https://${v}`;
    return null;
}

export default function ContactEntriesSection({ entries, adopterId, onChange, canEditAll, currentUser, onMaskedClick, adopterIsPublic = false, hidePublicMicrocopy = false, allowTypeChange = false, hideVisibilityMicrocopy = false, emptyMessage }: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const isLocalMode = !!onChange;
    /** Correcting a mis-extracted type is a local-mode affordance only. */
    const typeChangeEnabled = allowTypeChange && isLocalMode;

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
    const [composerPlatform, setComposerPlatform] = useState<SocialPlatform | null>(null);
    const [composerApps, setComposerApps] = useState<MessagingApp[]>([]);
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
    const [editDraft, setEditDraft] = useState<EditDraft>({ type: 'other', value: '', streetAndNumber: '', locality: '', platform: null, apps: [] });
    const [editBusy, setEditBusy] = useState(false);

    // Deletion is gated by a confirmation dialog. `deletingId` hides the row
    // from the moment the user confirms and is released ONLY when the refreshed
    // server data no longer contains it (see the effect below) or the delete
    // fails. Clearing it any earlier makes the row flash back into the list
    // while the request is still in flight.
    const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<ContactEntry | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        if (deletingId && !entries.some(e => e.id === deletingId)) setDeletingId(null);
    }, [entries, deletingId]);

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

    const visibleEntries = entries.filter(e => e.id !== deletingId);
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

    /**
     * Re-file the in-progress entry under a different type, KEEPING what has
     * been typed.
     *
     * This replaces `returnToPickType`, which sent the user back to the
     * pick-type stage and discarded the input on the way. That discard was
     * defensible while changing type meant leaving the form — but the type
     * control now sits beside the input, so there is no stage to return to and
     * nothing to justify throwing the value away. Choosing the wrong type first
     * is the common case, not a reset.
     *
     * Delegates to the same `retypeDraft` the edit form uses, so the rules for
     * which fields survive a type change live in one tested place rather than
     * being re-derived per surface.
     */
    function changeComposerType(next: ContactEntryType) {
        const moved = retypeDraft({
            type: composerType,
            value: composerValue,
            streetAndNumber: composerStreet,
            locality: composerLocality,
            platform: composerPlatform,
            apps: composerApps,
        }, next);
        setComposerType(moved.type);
        setComposerStreet(moved.streetAndNumber);
        setComposerLocality(moved.locality);
        setComposerPlatform(moved.platform ?? null);
        setComposerApps(moved.apps ?? []);
    }

    // Social platform: deduced from a URL (locked) or picked by the user.
    const socialDetected = composerType === 'social' ? detectSocialPlatform(composerValue) : null;
    const effectiveSocialPlatform: SocialPlatform | null = socialDetected ?? composerPlatform;
    const socialNeedsPlatform = composerType === 'social' && composerValue.trim().length > 0 && !effectiveSocialPlatform;

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
        if (composerType === 'social') {
            return { id: crypto.randomUUID(), type: 'social', value: composerValue.trim(), ...(effectiveSocialPlatform ? { platform: effectiveSocialPlatform } : {}) };
        }
        if (composerType === 'phone') {
            return { id: crypto.randomUUID(), type: 'phone', value: composerValue.trim(), ...(composerApps.length ? { apps: composerApps } : {}) };
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
        setComposerPlatform(null);
        setComposerApps([]);
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
        if (!composerHasContent() || composerBusy || socialNeedsPlatform) return { ok: false };

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
                : { adopterId: adopterId!, type: composerType, value: composerValue.trim(), ...(composerType === 'social' && effectiveSocialPlatform ? { platform: effectiveSocialPlatform } : {}), ...(composerType === 'phone' && composerApps.length ? { apps: composerApps } : {}) };
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
        // Deliberately does NOT touch a pending delete. `visibleEntries` filters
        // the pending entry out of the rendered list, so this can only ever be
        // reached for a *different* entry — and cancelling there would resurrect
        // a deletion the user asked for. (The old call was vestigial.)
        setEditingId(entry.id);
        // For address entries: when the legacy single-`value` shape is the
        // only thing present, fall back through deriveStreet / deriveLocality
        // (split on first comma) so the form pre-fills with the existing
        // text instead of empty inputs. v2.16.0-13 fix.
        setEditDraft({
            type: entry.type,
            value: entry.value,
            streetAndNumber: entry.type === 'address' ? deriveStreet(entry) : (entry.streetAndNumber ?? ''),
            locality: entry.type === 'address' ? deriveLocality(entry) : (entry.locality ?? ''),
            platform: entry.type === 'social' ? (entry.platform ?? detectSocialPlatform(entry.value)) : null,
            apps: entry.type === 'phone' ? (entry.apps ?? []) : [],
        });
    }

    /**
     * Re-file the row under a different type WITHOUT leaving the form.
     *
     * The old `changeEntryType` committed straight to the parent and then closed
     * edit mode, which left the rescuer outside the only form where the new
     * type's fields live — a phone could not get its WhatsApp/Telegram toggles
     * and a social could not get its network, so the corrected row was saved
     * incomplete (and for a social, Save was disabled by a picker that had just
     * been taken off screen). Moving the type into the draft keeps the form open
     * and lets it re-shape in place.
     *
     * Type-specific fields are dropped on the way across rather than carried: a
     * phone's messaging apps mean nothing once it is a document, and a
     * structured address's parts mean nothing once it is a note. `value`
     * survives — correcting the LABEL the AI guessed is the whole point.
     */
    function changeDraftType(next: ContactEntryType) {
        setEditDraft(d => retypeDraft(d, next));
    }

    function cancelEdit() {
        setEditingId(null);
        setEditDraft({ type: 'other', value: '', streetAndNumber: '', locality: '', platform: null, apps: [] });
    }

    async function commitEdit(entry: ContactEntry) {
        if (!entry.id || editBusy) return;
        // The type being saved. Only the local + allowTypeChange combination can
        // move it; server mode has no way to carry a value across type-specific
        // validation, so it stays pinned to the entry's own type there.
        const effType = typeChangeEnabled ? editDraft.type : entry.type;
        const hasContent = effType === 'address'
            ? (editDraft.streetAndNumber.trim().length > 0 || editDraft.locality.trim().length > 0)
            : editDraft.value.trim().length > 0;
        if (!hasContent) return;
        const editPlatform: SocialPlatform | null = effType === 'social'
            ? (detectSocialPlatform(editDraft.value) ?? editDraft.platform ?? null) : null;
        const editApps: MessagingApp[] = effType === 'phone' ? (editDraft.apps ?? []) : [];
        // A social must have a network before it can be saved.
        if (effType === 'social' && editDraft.value.trim().length > 0 && !editPlatform) return;

        // Local mode: build the updated entry in place, emit.
        if (isLocalMode) {
            const updated: ContactEntry = effType === 'address'
                ? {
                    id: entry.id,
                    type: 'address',
                    value: [editDraft.streetAndNumber.trim(), editDraft.locality.trim()].filter(Boolean).join(', '),
                    streetAndNumber: editDraft.streetAndNumber.trim() || undefined,
                    locality: editDraft.locality.trim() || undefined,
                    ...(entry.addedBy ? { addedBy: entry.addedBy } : {}),
                }
                : {
                    id: entry.id,
                    type: effType,
                    value: editDraft.value.trim(),
                    // The `id` label belongs to the document type; carrying it
                    // onto a phone or address would mislabel the new row.
                    ...(entry.label && effType === 'id' ? { label: entry.label } : {}),
                    ...(entry.addedBy ? { addedBy: entry.addedBy } : {}),
                    ...(editPlatform ? { platform: editPlatform } : {}),
                    ...(editApps.length ? { apps: editApps } : {}),
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
                : { adopterId: adopterId!, entryId: entry.id, value: editDraft.value.trim(), ...(editPlatform ? { platform: editPlatform } : {}), ...(editApps.length ? { apps: editApps } : {}) };
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
        setConfirmDeleteTarget(entry);
    }

    async function confirmDelete() {
        const entry = confirmDeleteTarget;
        if (!entry?.id) return;
        const entryId = entry.id;
        setConfirmDeleteTarget(null);
        setDeletingId(entryId);

        // Local mode: emit the filtered array. The parent owns the list, so the
        // row is gone from `entries` on the next render and the effect above
        // releases `deletingId`.
        if (isLocalMode) {
            onChange!(entries.filter(e => e.id !== entryId));
            return;
        }

        try {
            const res = await removeContactEntry({ adopterId: adopterId!, entryId });
            if (!res.ok) {
                setDeletingId(null); // restore the row — it was not deleted
                toast.error(t('errors.generic'), res.error || t('adopter.ce_delete_error'));
                return;
            }
            // Deliberately does NOT clear deletingId: `router.refresh()` is
            // fire-and-forget, so the row must stay hidden until the new server
            // data lands. The effect above clears it then.
            router.refresh();
        } catch (e) {
            setDeletingId(null);
            toast.error(t('errors.generic'), t('adopter.ce_delete_error'), extractErrorId(e));
        }
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
            const tel = (
                <a href={`tel:${entry.value.replace(/[^\d+]/g, '')}`} className={LINK_CLASS}>{entry.value}</a>
            );
            if (!entry.apps?.length) return tel;
            return (
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                    {tel}
                    {entry.apps.map(app => {
                        const u = phoneAppUrl(app, entry.value);
                        const logo = <MessagingLogo app={app} size={15} />;
                        return u
                            ? <a key={app} href={u} target="_blank" rel="noopener noreferrer" title={app === 'whatsapp' ? 'WhatsApp' : 'Telegram'} className="inline-flex">{logo}</a>
                            : <span key={app} title={app === 'whatsapp' ? 'WhatsApp' : 'Telegram'}>{logo}</span>;
                    })}
                </span>
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
            const href = socialUrl(entry.value, entry.platform) ?? socialHref(entry.value);
            const inner = href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>{entry.value}</a>
            ) : (
                <span className="text-stone-800">{entry.value}</span>
            );
            // Branded networks now carry their icon + name in the row's leading
            // icon + label, so the value shows only the handle. 'other' keeps its
            // inline generic-link mark (its row stays "@ Red social").
            return entry.platform === 'other' ? (
                <span className="inline-flex items-center gap-1.5"><SocialLogo platform="other" size={15} />{inner}</span>
            ) : inner;
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
    // Public eye line — shown to everyone, UNLESS the profile header already shows
    // the "Público" pill (then it's a duplicate signal, Nielsen #8). The private
    // padlock line ("solo visible para vos") is owner-facing and always stays.
    const showPublicLine = profileEffectivelyPublic && !hidePublicMicrocopy;
    const showPrivateLine = !profileEffectivelyPublic && viewerIsPrivileged;
    const showMicrocopy = (showPublicLine || showPrivateLine) && !hideVisibilityMicrocopy;
    const microcopyKey = showPublicLine
        ? 'adopter.ce_visibility_profile_public'
        : 'adopter.ce_visibility_microcopy';

    return (
        <div className="space-y-3">
            {showMicrocopy && (
                <p className="flex items-start gap-1.5 text-xs" style={{ color: showPublicLine ? 'var(--status-sky-text)' : 'var(--text-muted)' }}>
                    {showPublicLine ? (
                        // v2.26.3: eye = public (visible to everyone), matching the search-result
                        // badge. Was a globe (overloaded: language/web). The private/masked state
                        // below keeps the closed padlock — visible ↔ protected.
                        <svg className="w-3.5 h-3.5 mt-px shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5s9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
                            <circle cx="12" cy="12" r="3" />
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

            {/* Chip list. */}
            {sorted.length > 0 && (
                <ul className="space-y-1.5">
                    {sorted.map(entry => {
                        const branded = brandedSocialPlatform(entry);
                        const Icon = TYPE_ICON[entry.type];
                        const isEditing = editingId === entry.id;
                        /**
                         * The type the FORM is currently shaped around. While editing with
                         * type-change enabled that's the draft's provisional type, so
                         * picking "Red social" swaps the messaging-app toggles for the
                         * network picker immediately, before anything is saved. Everywhere
                         * else it is simply the entry's own type.
                         */
                        const formType = isEditing && typeChangeEnabled ? editDraft.type : entry.type;
                        /**
                         * While the picker is on screen it IS the row's type indicator, so
                         * the static icon and label step aside rather than sitting beside
                         * it showing the pre-change type — two indicators disagreeing while
                         * the rescuer re-files the row. Standing down also hands the input
                         * back the label's fixed 96px, which is the width that motivated
                         * hiding the label below `sm:` in the first place.
                         */
                        const pickerOwnsType = isEditing && typeChangeEnabled;
                        return (
                            <li
                                key={entry.id || `${entry.type}:${entry.value}`}
                                className="group flex items-start gap-2 text-sm"
                                data-testid="ce-chip"
                                data-entry-type={entry.type}
                            >
                                {!pickerOwnsType && (branded
                                    ? <SocialLogo platform={branded} size={16} className="mt-0.5 shrink-0" />
                                    : <Icon className="w-4 h-4 mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />)}
                                {/* The icon already states the type, so this label is a
                                    second copy of it costing a fixed 96px — the width the
                                    value (and, while editing, the input) has to give up on
                                    a phone. Kept from `sm:` up, where it genuinely helps
                                    scanning a list, and sr-only below so the type is still
                                    announced: the icon beside it is aria-hidden. */}
                                {!pickerOwnsType && (
                                    <span className="sr-only sm:not-sr-only sm:w-24 sm:shrink-0 text-stone-500">{branded ? SOCIAL_LABEL[branded] : labelFor(entry)}</span>
                                )}
                                <div className="flex-1 min-w-0">
                                    {isEditing ? (
                                        <div className="space-y-2">
                                            {/* The type control sits INLINE with the value, as the
                                                row's own icon rather than a block beneath it — so
                                                correcting a mis-extracted type costs no vertical
                                                space and Guardar stays on screen on a phone. Same
                                                idiom as SocialPlatformPicker / PhoneAppsToggle. */}
                                            <div className="flex gap-2 items-start">
                                                {typeChangeEnabled && (
                                                    <ContactTypePicker
                                                        compact
                                                        value={formType}
                                                        onChange={changeDraftType}
                                                        types={COMPOSABLE_TYPES}
                                                    />
                                                )}
                                                <div className="flex-1 min-w-0 space-y-2">
                                                    {formType === 'address' ? (
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
                                                            placeholder={placeholderFor(formType)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') { e.preventDefault(); commitEdit(entry); }
                                                                if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                                                            }}
                                                            className="w-full px-2 py-1 border border-stone-300 rounded text-sm"
                                                            autoFocus
                                                        />
                                                    )}
                                                    {/* Type-specific fields sit INSIDE the input's
                                                        column so they line up with it rather than
                                                        starting back at the type picker's left edge.
                                                        They also key off the type alone, not off a
                                                        non-empty value: re-filing a row as a phone
                                                        has to surface its app toggles immediately,
                                                        or the option looks like it does not exist. */}
                                                    {formType === 'social' && (() => {
                                                        const det = detectSocialPlatform(editDraft.value);
                                                        return (
                                                            <div>
                                                                {/* The asterisk marks an UNMET requirement, so it
                                                                    tracks whether a network is actually set — not
                                                                    whether one was auto-detected. Keying it to `det`
                                                                    alone left "required" showing over an already
                                                                    chosen network. */}
                                                                {!det && (
                                                                    <div className="text-xs font-semibold text-stone-700 mb-1.5">
                                                                        {t('adopter.ce_social_which')}
                                                                        {!editDraft.platform && <span className="text-red-600"> *</span>}
                                                                    </div>
                                                                )}
                                                                <SocialPlatformPicker value={det ?? editDraft.platform ?? null} locked={!!det} onChange={(pl) => setEditDraft({ ...editDraft, platform: pl })} />
                                                            </div>
                                                        );
                                                    })()}
                                                    {formType === 'phone' && (
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-xs font-semibold text-stone-500">{t('adopter.ce_phone_apps')}</span>
                                                            <PhoneAppsToggle value={editDraft.apps ?? []} onChange={(apps) => setEditDraft({ ...editDraft, apps })} />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
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
                                                    disabled={editBusy || (formType === 'social' && editDraft.value.trim().length > 0 && !(detectSocialPlatform(editDraft.value) ?? editDraft.platform))}
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
            {sorted.length === 0 && !deletingId && composerStage === 'closed' && (
                <p className="text-sm text-stone-500 italic">{emptyMessage ?? t('adopter.ce_empty')}</p>
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
                        /* One treatment in BOTH states — deliberate, and it must stay
                         * that way. Until v2.54.4 this was a Secondary button on an empty
                         * list and a bare text link once entries existed.
                         *
                         * The deciding evidence is `HouseholdSection`, the sibling
                         * list-section on the same profile: its section-level "add a
                         * member" is this exact Secondary button, rendered unconditionally
                         * (HouseholdSection.tsx:274), while its NESTED per-member "add a
                         * contact" is a bare text link (:266). The link is not a lighter
                         * button — it marks an action one level down. Swapping to it
                         * whenever this list happened to be non-empty dressed a
                         * section-level action as a nested one, and made two sibling
                         * sections answer "add a record to this list" differently.
                         *
                         * Emphasis for the empty state is carried by its own hint line
                         * above ("Aún no hay datos de contacto…"), not by changing what
                         * the button is. If this ever reads too loud beside a populated
                         * list, quiet the Secondary variant globally — do not special-case
                         * one state back into a different component.
                         */
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-md transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        {t('adopter.contrib_cta')}
                    </button>
                )}

                {composerStage === 'pick-type' && (
                    /* Same row treatment as the editing stage below it — the card
                       this used to sit in painted `bg-stone-50` (→ --surface-base),
                       which reads as a dark box in the dark theme and made choosing a
                       type look like a different surface from filling one in. */
                    <div className="space-y-3 pt-3 border-t border-stone-100">
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
                    /* Adding a detail is editing a row that does not exist yet, so it
                       gets the row treatment rather than a card: no border, no grey
                       panel, just the list's own separator. The card used to carry the
                       "Añadiendo: X / ↺ Cambiar tipo" header; with the type control now
                       beside the input — exactly as in the inline edit form — there is
                       no header left for it to hold, and two surfaces answering the same
                       question stop looking like different features. */
                    <div className="space-y-2 pt-3 border-t border-stone-100">
                        {/* Type control inline with the value — the same shape the edit
                            form uses, so "which kind of detail is this" is asked the same
                            way whether the row already exists or not.

                            Every type-specific field lives INSIDE the right-hand column
                            rather than beside it, so the network picker and the app
                            toggles line up with the input instead of starting back at the
                            picker's left edge. */}
                        <div className="flex gap-2 items-start">
                            <ContactTypePicker
                                compact
                                value={composerType}
                                onChange={changeComposerType}
                                disabled={composerBusy}
                                types={COMPOSABLE_TYPES}
                            />
                            <div className="flex-1 min-w-0 space-y-2">
                                {/* Network-first: pick the social network before typing so the
                                    input can show a per-network placeholder (Facebook nudges the
                                    profile link → captures the numeric id). Locked to "auto" when
                                    a pasted URL already reveals the platform. */}
                                {composerType === 'social' && (
                                    <div>
                                        <div className="text-xs font-semibold text-stone-700 mb-1.5">
                                            {/* Asterisk = still unmet, not "not auto-detected". */}
                                            {t('adopter.ce_social_which')}{!effectiveSocialPlatform && <span className="text-red-600"> *</span>}
                                        </div>
                                        <SocialPlatformPicker
                                            value={effectiveSocialPlatform}
                                            locked={!!socialDetected}
                                            onChange={setComposerPlatform}
                                        />
                                    </div>
                                )}
                                {composerType === 'address' ? (
                                    <>
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
                                    </>
                                ) : (
                                    <input
                                        type="text"
                                        value={composerValue}
                                        onChange={e => setComposerValue(e.target.value)}
                                        placeholder={composerType === 'social'
                                            ? (effectiveSocialPlatform ? t(`adopter.ce_input_ph_social_${effectiveSocialPlatform}`) : t('adopter.ce_input_ph_social'))
                                            : placeholderFor(composerType)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
                                            if (e.key === 'Escape') { e.preventDefault(); resetComposer(); }
                                        }}
                                        className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                                        autoFocus
                                    />
                                )}
                                {/* Shown as soon as the type is phone, not once a value has
                                    been typed. Gating on a non-empty value meant choosing
                                    "Teléfono" — or correcting a row to it — surfaced no
                                    WhatsApp/Telegram toggles at all, which read as the
                                    option simply not existing. */}
                                {composerType === 'phone' && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs font-semibold text-stone-500">{t('adopter.ce_phone_apps')}</span>
                                        <PhoneAppsToggle value={composerApps} onChange={setComposerApps} />
                                    </div>
                                )}
                            </div>
                        </div>
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
                                disabled={composerBusy || socialNeedsPlatform}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                                data-testid="ce-composer-submit"
                            >
                                <Check className="w-3.5 h-3.5" /> {t('adopter.ce_edit_save')}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <ConfirmDialog
                open={!!confirmDeleteTarget}
                title={t('dialogs.confirm_delete_contact').replace('{value}', confirmDeleteTarget?.value ?? '')}
                message={t('dialogs.confirm_delete_contact_note')}
                onConfirm={confirmDelete}
                onCancel={() => setConfirmDeleteTarget(null)}
            />
        </div>
    );
}
