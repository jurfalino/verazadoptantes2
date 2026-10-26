'use client';

/**
 * Structured household / family section — replaces the free-text field. Each
 * person: name + relationship + their own contact entries (same composer as the
 * titular: network-first social, WhatsApp/Telegram). Gated behind
 * ENABLE_HOUSEHOLD_MEMBERS. Calls the member CRUD server actions; contacts are
 * masked/partial-revealed upstream (maskHouseholdMembers).
 *
 * D54: anyone signed in adds a member, or a contact to any member, credited to
 * them; they change only what they added (the `own: true` view marker), the
 * owner's team/admins change everything — `domain/householdPermissions.ts`
 * decides each control, the server actions enforce the same rules. D55: a
 * member linked to their own profile gets its contacts added to THAT profile
 * (LinkedProfileSummary), never to this household's copy.
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { SocialLogo } from '@/components/SocialLogo';
import { MessagingLogo } from '@/components/MessagingLogo';
import { ContactComposer, ContactDraftEditor, CONTACT_TYPE_ICON, draftPlatform, type ComposerDraft } from '@/components/ContactComposer';
import { type ContactEntry } from '@/lib/contactEntries';
import { RELATIONSHIPS, currentAge, type HouseholdMember, type Relationship } from '@/lib/householdMembers';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { entryConflictMessage } from '@/lib/collabCopy';
import {
    HOUSEHOLD_NOT_AUTHORIZED, canAddToHousehold, canEditHouseholdMember, canRemoveHouseholdMember,
    canChangeMemberContact, showsAccessRequestHint, type HouseholdViewer,
} from '@/domain/householdPermissions';
import {
    addHouseholdMember, updateHouseholdMember, removeHouseholdMember,
    addMemberContactEntry, updateMemberContactEntry, removeMemberContactEntry,
} from '@/app/actions';
import { LinkedProfileSummary, NotLivingTogetherButton } from '@/components/LinkedProfileSummary';
import type { HouseholdLinkedMembers } from '@/domain/householdLinks';

const TYPE_ICON = CONTACT_TYPE_ICON;

type Draft = ComposerDraft;
interface MemberUI extends HouseholdMember {
    editing?: boolean; draftName?: string; draftRel?: Relationship | null; draftAge?: string;
    /** The age as shown when the edit opened — sent as `expected.age`, and to tell whether the rescuer changed it. */
    openAge?: string;
}
interface CEditing extends ContactEntry { editing?: boolean; draft?: Draft }

export default function HouseholdSection({ adopterId, initialMembers, canEditAll, canAdd, hasLegacyText = false, linkedMembers = {}, hostName = '' }: {
    adopterId: string; initialMembers: HouseholdMember[];
    /** Owner ∨ admin ∨ moderator ∨ org-mate of the owner: may change every member and contact (D54). */
    canEditAll: boolean;
    /** Signed in: may add a member, or a contact to any member, and change what they added. */
    canAdd: boolean;
    /** Legacy free-text family notes (or «Convive con» rows) are shown beneath; don't also say "no family". */
    hasLegacyText?: boolean;
    /** D46: live summaries of members linked to their own profile, keyed by member id (masked for this viewer). */
    linkedMembers?: HouseholdLinkedMembers;
    /** This profile's name, for the «No convive» dialog (D48). */
    hostName?: string;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const viewer: HouseholdViewer = { signedIn: canAdd, privileged: canEditAll };
    const [members, setMembers] = useState<MemberUI[]>(() => initialMembers.map(m => ({ ...m })));
    const [busy, setBusy] = useState(false);
    // One dialog serves both delete paths; `kind` picks the copy.
    const [confirmTarget, setConfirmTarget] = useState<
        | { kind: 'member'; member: MemberUI }
        | { kind: 'contact'; member: MemberUI; entry: CEditing }
        | null
    >(null);

    // Fresh server data (after any refresh) replaces what's shown — while
    // keeping open editors and their drafts — so a teammate's change is
    // visible, and becomes what the next save is compared against.
    const serverKey = useMemo(() => JSON.stringify(initialMembers), [initialMembers]);
    useEffect(() => {
        setMembers(prev => {
            const merged: MemberUI[] = initialMembers.map(sm => {
                const lm = prev.find(x => x.id === sm.id);
                if (!lm) return { ...sm };
                return {
                    ...sm,
                    editing: lm.editing, draftName: lm.draftName, draftRel: lm.draftRel, draftAge: lm.draftAge, openAge: lm.openAge,
                    contactEntries: sm.contactEntries.map(se => {
                        const le = lm.contactEntries.find(e => e.id === se.id) as CEditing | undefined;
                        return le?.editing ? { ...se, editing: true, draft: le.draft } as CEditing : se;
                    }),
                };
            });
            // Members being added here and not yet saved stay (a saved one is
            // already in the server list — never show it twice).
            return [...merged, ...prev.filter(x => (x as MemberUI & { isNew?: boolean }).isNew && !initialMembers.some(sm => sm.id === x.id))];
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverKey]);

    const relLabel = (r: Relationship | null | undefined) => r ? t(`adopter.hh_rel_${r}`) : '';
    const patch = (id: string, up: Partial<MemberUI>) => setMembers(prev => prev.map(m => m.id === id ? { ...m, ...up } : m));
    /** `onConflict` runs when a teammate changed/removed the item meanwhile (after the warning). */
    async function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T>, onConflict?: (kind: 'changed' | 'deleted') => void): Promise<Extract<T, { ok: true }> | null> {
        setBusy(true);
        try {
            const res = await fn();
            if (!res.ok) {
                const r = res as { error?: string; conflict?: { kind: 'changed' | 'deleted'; by: string }; errorId?: string };
                if (r.error === 'conflict' && r.conflict) {
                    toast.warning(entryConflictMessage(t, r.conflict.kind, r.conflict.by));
                    onConflict?.(r.conflict.kind);
                    router.refresh();
                } else if (r.error === 'busy') {
                    toast.error(t('errors.generic') || 'Error', t('collab.busy'), r.errorId);
                } else if (r.error === HOUSEHOLD_NOT_AUTHORIZED) {
                    // Not theirs to change — or it was theirs and the owner changed or
                    // removed it meanwhile (the refusal comes before the conflict
                    // check). Show what is there now.
                    toast.error(t('errors.generic') || 'Error', t('errors.household_not_authorized'),
                        r.errorId ?? resolveErrorId(new Error(`HouseholdSection: ${r.error}`), 'HouseholdSection'));
                    router.refresh();
                } else {
                    toast.error(t('errors.generic') || 'Error', t('errors.save_household_failed'),
                        r.errorId ?? resolveErrorId(new Error(`HouseholdSection: ${r.error ?? 'unknown'}`), 'HouseholdSection'));
                }
                return null;
            }
            return res as Extract<T, { ok: true }>;
        } catch (e) {
            // A stale tab's id is the one the toast layer drops: the "new version" notice speaks instead.
            toast.error(t('errors.generic') || 'Error', t('errors.save_household_failed'), resolveErrorId(e, 'HouseholdSection'));
            return null;
        } finally { setBusy(false); }
    }

    // ── member ops ──
    function startAdd() {
        setMembers(prev => [...prev, { id: `tmp-${Math.random().toString(36).slice(2)}`, name: '', relationship: null, contactEntries: [], editing: true, draftName: '', draftRel: null, isNew: true } as MemberUI & { isNew: boolean }]);
    }
    async function saveMember(m: MemberUI) {
        const name = (m.draftName ?? '').trim();
        const relationship = m.draftRel ?? null;
        // Sent only when the rescuer changed it, so saving a name fix can never
        // write back a stale age over a teammate's newer one. '' clears it.
        const ageChanged = m.draftAge !== undefined && m.draftAge.trim() !== (m.openAge ?? '');
        const age = !ageChanged ? undefined : m.draftAge!.trim() === '' ? null : Number(m.draftAge);
        const isNew = (m as MemberUI & { isNew?: boolean }).isNew;
        if (isNew) {
            const res = await run(() => addHouseholdMember({ adopterId, name, relationship, age: age ?? undefined }));
            if (!res) return;
            setMembers(prev => prev.map(x => x.id === m.id
                // `own`: the viewer just added it, as the refreshed server copy will say.
                ? { ...x, id: res.memberId, name, relationship, own: true, ...(typeof age === 'number' ? { age, ageAsOf: new Date().toISOString().slice(0, 10) } : {}), editing: false, draftName: undefined, draftRel: undefined, draftAge: undefined, isNew: false } as MemberUI
                : x));
        } else {
            const res = await run(
                () => updateHouseholdMember({ adopterId, memberId: m.id, name, relationship, age, expected: { name: m.name, relationship: m.relationship ?? null, age: m.openAge ? Number(m.openAge) : null } }),
                (kind) => { if (kind === 'deleted') setMembers(prev => prev.filter(x => x.id !== m.id)); },
            );
            if (!res) return;
            patch(m.id, {
                name, relationship,
                ...(age === null ? { age: undefined, ageAsOf: undefined } : typeof age === 'number' ? { age, ageAsOf: new Date().toISOString().slice(0, 10) } : {}),
                editing: false, draftName: undefined, draftRel: undefined, draftAge: undefined, openAge: undefined,
            });
        }
        router.refresh();
    }
    function cancelMember(m: MemberUI) {
        if ((m as MemberUI & { isNew?: boolean }).isNew) setMembers(prev => prev.filter(x => x.id !== m.id));
        else patch(m.id, { editing: false, draftName: undefined, draftRel: undefined, draftAge: undefined, openAge: undefined });
    }
    function deleteMember(m: MemberUI) {
        setConfirmTarget({ kind: 'member', member: m });
    }

    // ── contact ops ──
    /** Resolves true once saved (the composer closes); false keeps it open with what was typed. */
    async function saveNewContact(m: MemberUI, c: Draft): Promise<boolean> {
        const platform = draftPlatform(c);
        const res = await run(() => addMemberContactEntry({ adopterId, memberId: m.id, type: c.type, value: c.value, platform, apps: c.apps }));
        if (!res) return false;
        // A value the member already has comes back as that entry's id, with nothing appended.
        const duplicate = m.contactEntries.some(e => e.id === res.entryId);
        if (!duplicate) {
            const entry: ContactEntry = { id: res.entryId, type: c.type, value: c.value, own: true, ...(platform ? { platform } : {}), ...(c.apps.length ? { apps: c.apps } : {}) };
            setMembers(prev => prev.map(x => x.id === m.id ? { ...x, contactEntries: [...x.contactEntries, entry] } : x));
            // A contributor's contact files an access request on their behalf (D54), as on the titular.
            if (showsAccessRequestHint(viewer) && c.type !== 'alias') toast.success('✓', t('adopter.ce_add_toast_added_with_request'));
        }
        router.refresh();
        return true;
    }
    function startEditContact(m: MemberUI, ce: CEditing) {
        patch(m.id, { contactEntries: m.contactEntries.map(e => e.id === ce.id ? { ...e, editing: true, draft: { type: e.type, value: e.value, platform: e.platform ?? null, apps: e.apps ?? [] } } as CEditing : e) });
    }
    async function saveEditContact(m: MemberUI, ce: CEditing) {
        const d = ce.draft; if (!d) return;
        const platform = ce.type === 'social' ? (draftPlatform(d) ?? ce.platform ?? undefined) : ce.platform;
        const res = await run(
            () => updateMemberContactEntry({ adopterId, memberId: m.id, entryId: ce.id!, value: d.value.trim(), platform: platform ?? undefined, apps: d.apps, expectedValue: ce.value }),
            (kind) => { if (kind === 'deleted') patch(m.id, { contactEntries: m.contactEntries.filter(e => e.id !== ce.id) }); },
        );
        if (!res) return;
        patch(m.id, { contactEntries: m.contactEntries.map(e => e.id === ce.id ? { ...e, value: d.value.trim(), platform, apps: d.apps, editing: false, draft: undefined } as CEditing : e) });
        router.refresh();
    }
    function deleteContact(m: MemberUI, ce: CEditing) {
        if (!ce.id) return;
        setConfirmTarget({ kind: 'contact', member: m, entry: ce });
    }

    /**
     * Runs the confirmed deletion. Local `members` state is the source of truth
     * for this list, so the row is removed from it in the same commit that
     * closes the dialog — there is no window where the row can flash back while
     * `router.refresh()` is still in flight.
     */
    async function runConfirmedDelete() {
        const target = confirmTarget;
        if (!target) return;

        if (target.kind === 'member') {
            const res = await run(
                () => removeHouseholdMember({ adopterId, memberId: target.member.id, expected: { name: target.member.name, relationship: target.member.relationship ?? null } }),
                (kind) => { if (kind === 'deleted') setMembers(prev => prev.filter(x => x.id !== target.member.id)); },
            );
            if (!res) { setConfirmTarget(null); return; }
            setMembers(prev => prev.filter(x => x.id !== target.member.id));
        } else {
            const m = target.member;
            const res = await run(
                () => removeMemberContactEntry({ adopterId, memberId: m.id, entryId: target.entry.id!, expectedValue: target.entry.value }),
                (kind) => { if (kind === 'deleted') patch(m.id, { contactEntries: m.contactEntries.filter(e => e.id !== target.entry.id) }); },
            );
            if (!res) { setConfirmTarget(null); return; }
            patch(m.id, { contactEntries: m.contactEntries.filter(e => e.id !== target.entry.id) });
        }
        setConfirmTarget(null);
        router.refresh();
    }

    // ── contact editor (edit in place) ──
    const editor = (d: Draft, onChange: (up: Partial<Draft>) => void, onSave: () => void, onCancel: () => void) => (
        <ContactDraftEditor draft={d} onChange={onChange} onSave={onSave} onCancel={onCancel} busy={busy} testIdPrefix="household-contact" />
    );

    return (
        <div className="space-y-3">
            {members.length === 0 && !canAddToHousehold(viewer) && !hasLegacyText && <p className="text-sm text-stone-500 italic">{t('adopter.no_family')}</p>}
            {members.map(m => {
                const linked = m.profileId ? linkedMembers[m.id] : undefined;
                const canEditMember = canEditHouseholdMember(viewer, m);
                const canRemoveMember = canRemoveHouseholdMember(viewer, m);
                // D55: a linked member's contacts are added to their own profile (on the summary).
                const canAddContact = canAddToHousehold(viewer) && !linked;
                return (
                <div key={m.id} className="border border-stone-200 rounded-xl p-3.5 bg-stone-50" data-testid="household-member">
                    {m.editing ? (
                        <div className="space-y-2">
                            <div className="flex gap-2 flex-wrap">
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[11px] font-semibold text-stone-500 mb-1">{t('adopter.hh_name')}</label>
                                    <input autoFocus type="text" data-testid="household-member-name-input" value={m.draftName ?? ''} onChange={e => patch(m.id, { draftName: e.target.value })} placeholder={t('adopter.hh_name_ph')} className="w-full px-2.5 py-1.5 border border-stone-300 rounded text-sm outline-none focus:border-teal-500" />
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[11px] font-semibold text-stone-500 mb-1">{t('adopter.hh_rel')}</label>
                                    <select value={m.draftRel ?? ''} onChange={e => patch(m.id, { draftRel: (e.target.value || null) as Relationship | null })} className="w-full px-2.5 py-1.5 border border-stone-300 rounded text-sm bg-white outline-none focus:border-teal-500">
                                        <option value="">{t('adopter.hh_rel_choose')}</option>
                                        {RELATIONSHIPS.map(r => <option key={r} value={r}>{t(`adopter.hh_rel_${r}`)}</option>)}
                                    </select>
                                </div>
                                <div className="w-24">
                                    <label className="block text-[11px] font-semibold text-stone-500 mb-1">{t('adopter.hh_age')}</label>
                                    <input type="number" inputMode="numeric" min={0} max={120} step={1} data-testid="household-member-age-input" value={m.draftAge ?? ''} onChange={e => patch(m.id, { draftAge: e.target.value })} className="w-full px-2.5 py-1.5 border border-stone-300 rounded text-base outline-none focus:border-teal-500" />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                                <button type="button" onClick={() => cancelMember(m)} disabled={busy} className="text-xs font-medium px-3 py-1.5 rounded text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50"><X className="w-3.5 h-3.5 inline" /> {t('adopter.ce_edit_cancel')}</button>
                                <button type="button" data-testid="household-member-save" onClick={() => saveMember(m)} disabled={busy || !((m.draftName ?? '').trim() || m.draftRel)} className="text-xs font-semibold px-3.5 py-1.5 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"><Check className="w-3.5 h-3.5 inline" /> {t('adopter.ce_edit_save')}</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-start gap-2.5">
                                <div className="w-9 h-9 rounded-lg bg-teal-600 text-white font-bold text-sm flex items-center justify-center shrink-0">{(m.name.trim()[0] || '?').toUpperCase()}</div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-[15px] text-stone-900 break-words">
                                        {m.profileId ? (
                                            // D35: a member with their own profile links to it; a later merge redirects there.
                                            <a href={`/adopter/${encodeURIComponent(m.profileId)}`} data-testid="household-member-profile-link" className="text-teal-700 hover:underline">
                                                {m.name || t('adopter.hh_name')}
                                            </a>
                                        ) : (
                                            m.name || <span className="italic text-stone-400">{t('adopter.hh_name')}</span>
                                        )}
                                        {m.giftRecipient && <span className="ml-1.5 inline-block whitespace-nowrap align-middle text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700">{t('adopter.hh_gift_recipient')}</span>}
                                    </div>
                                    <div className={`text-xs ${m.relationship ? 'text-stone-500' : 'text-stone-400 italic'}`}>
                                        {m.relationship === 'unknown' ? t('adopter.hh_rel_unknown_display') : m.relationship ? relLabel(m.relationship) : t('adopter.hh_rel_none')}
                                        {currentAge(m) !== null && <> · {t('adopter.hh_years').replace('{n}', String(currentAge(m)))}</>}
                                    </div>
                                </div>
                                {(canEditMember || canRemoveMember) && (
                                    <div className="flex gap-0.5 shrink-0">
                                        {canEditMember && <button type="button" data-testid="household-member-edit" onClick={() => { const shown = m.age !== undefined ? String(currentAge(m)) : ''; patch(m.id, { editing: true, draftName: m.name, draftRel: m.relationship, draftAge: shown, openAge: shown }); }} title={t('adopter.ce_edit_label')} aria-label={t('adopter.ce_edit_label')} className="inline-flex min-w-[44px] min-h-[44px] items-center justify-center text-stone-500 hover:text-teal-700 hover:bg-teal-50 rounded"><Pencil className="w-3.5 h-3.5" /></button>}
                                        {canRemoveMember && <button type="button" data-testid="household-member-remove" onClick={() => deleteMember(m)} title={t('adopter.ce_remove')} aria-label={t('adopter.ce_remove')} className="inline-flex min-w-[44px] min-h-[44px] items-center justify-center text-stone-500 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>}
                                    </div>
                                )}
                            </div>
                            {linked && (
                                // D46: who this person is on their own profile, read live; D55: add their contacts there.
                                <LinkedProfileSummary summary={linked} canAddContact={canAddToHousehold(viewer)} />
                            )}
                            {m.profileId && linkedMembers[m.id]?.canReportNotLiving && (
                                // D48: the linked profile's team (or an admin) corrects the fact from here too.
                                <NotLivingTogetherButton linkId={linkedMembers[m.id].linkId} personName={m.name} hostName={hostName} className="mt-2.5" />
                            )}
                            {/* contacts — no heading: "Agregar dato de contacto" says it. A
                                viewer who can't edit a member with no contacts gets no
                                block at all rather than an empty divider. */}
                            {(m.contactEntries.length > 0 || canAddContact) && (
                            <div className="mt-3 pt-3 border-t border-dashed border-stone-200">
                                {m.contactEntries.length > 0 && (
                                    <ul className="space-y-1.5 mb-2">
                                        {(m.contactEntries as CEditing[]).map((ce, ci) => ce.editing ? (
                                            <li key={`${ce.id}-${ci}`}>{editor(ce.draft!, up => patch(m.id, { contactEntries: m.contactEntries.map(e => e.id === ce.id ? { ...e, draft: { ...(e as CEditing).draft!, ...up } } as CEditing : e) }), () => saveEditContact(m, ce), () => patch(m.id, { contactEntries: m.contactEntries.map(e => e.id === ce.id ? { ...e, editing: false, draft: undefined } as CEditing : e) }))}</li>
                                        ) : (() => {
                                            const branded = ce.type === 'social' && ce.platform && ce.platform !== 'other' && !ce.masked;
                                            const Icon = TYPE_ICON[ce.type];
                                            return (
                                                <li key={`${ce.id}-${ci}`} className="group flex items-center gap-2 text-sm">
                                                    {branded ? <SocialLogo platform={ce.platform!} size={16} className="shrink-0" /> : <Icon className="w-4 h-4 shrink-0 text-teal-600" />}
                                                    <span className="w-20 shrink-0 text-stone-500 text-xs">{branded ? '' : t(`adopter.ce_type_${ce.type}`)}</span>
                                                    <span className={`flex-1 min-w-0 truncate ${ce.masked ? 'text-stone-400 select-none' : 'text-stone-800'}`}>{ce.value}</span>
                                                    {(ce.apps ?? []).map(a => <MessagingLogo key={a} app={a} size={14} />)}
                                                    {canChangeMemberContact(viewer, ce) && (
                                                        // Always shown on a phone (no hover there); revealed on hover from md up.
                                                        <span className="flex md:hidden md:group-hover:flex gap-0.5 shrink-0">
                                                            <button type="button" data-testid="household-contact-edit" onClick={() => startEditContact(m, ce)} aria-label={t('adopter.ce_edit_label')} className="inline-flex min-w-[44px] min-h-[44px] items-center justify-center text-stone-500 hover:text-teal-700 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                                                            <button type="button" data-testid="household-contact-remove" onClick={() => deleteContact(m, ce)} aria-label={t('adopter.ce_remove')} className="inline-flex min-w-[44px] min-h-[44px] items-center justify-center text-stone-500 hover:text-red-600 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                                                        </span>
                                                    )}
                                                </li>
                                            );
                                        })())}
                                    </ul>
                                )}
                                {canAddContact && (
                                    <ContactComposer
                                        onSubmit={d => saveNewContact(m, d)}
                                        disabled={busy}
                                        triggerTestId="household-add-contact"
                                        testIdPrefix="household-contact"
                                    />
                                )}
                            </div>
                            )}
                        </>
                    )}
                </div>
                );
            })}
            {canAddToHousehold(viewer) && (
                <button type="button" data-testid="household-add-member" onClick={startAdd} disabled={busy} className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-md disabled:opacity-50">
                    <Plus className="w-4 h-4" />{t('adopter.hh_cta_add')}
                </button>
            )}

            <ConfirmDialog
                open={!!confirmTarget}
                busy={busy}
                title={
                    confirmTarget?.kind === 'contact'
                        ? t('dialogs.confirm_delete_contact').replace('{value}', confirmTarget.entry.value)
                        : confirmTarget?.member.name?.trim()
                            ? t('dialogs.confirm_delete_member').replace('{name}', confirmTarget.member.name.trim())
                            : t('dialogs.confirm_delete_member_unnamed')
                }
                message={
                    confirmTarget?.kind === 'contact'
                        ? t('dialogs.confirm_delete_contact_note')
                        : t('dialogs.confirm_delete_member_note')
                }
                onConfirm={runConfirmedDelete}
                onCancel={() => setConfirmTarget(null)}
            />
        </div>
    );
}
