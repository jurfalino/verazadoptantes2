'use client';

/**
 * Structured household / family section — replaces the free-text field. Each
 * person: name + relationship + their own contact entries (same composer as the
 * titular: network-first social, WhatsApp/Telegram). Gated behind
 * ENABLE_HOUSEHOLD_MEMBERS. Calls the member CRUD server actions; contacts are
 * masked/partial-revealed upstream (maskHouseholdMembers) so a non-privileged
 * viewer (canEdit=false) sees a read-only, masked list.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, Mail, AtSign, IdCard, MapPin, UserRound, Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { SocialPlatformPicker } from '@/components/SocialPlatformPicker';
import { SocialLogo } from '@/components/SocialLogo';
import { PhoneAppsToggle } from '@/components/PhoneAppsToggle';
import { MessagingLogo } from '@/components/MessagingLogo';
import { detectSocialPlatform, type ContactEntry, type ContactEntryType, type SocialPlatform, type MessagingApp } from '@/lib/contactEntries';
import { RELATIONSHIPS, type HouseholdMember, type Relationship } from '@/lib/householdMembers';
import {
    addHouseholdMember, updateHouseholdMember, removeHouseholdMember,
    addMemberContactEntry, updateMemberContactEntry, removeMemberContactEntry,
} from '@/app/actions';

const COMPOSABLE: ContactEntryType[] = ['phone', 'email', 'social', 'id', 'address', 'alias'];
const TYPE_ICON: Record<ContactEntryType, typeof Phone> = {
    phone: Phone, email: Mail, social: AtSign, id: IdCard, address: MapPin, alias: UserRound, other: UserRound,
};

interface Draft { type: ContactEntryType; value: string; platform: SocialPlatform | null; apps: MessagingApp[] }
interface MemberUI extends HouseholdMember {
    editing?: boolean; draftName?: string; draftRel?: Relationship | null;
    composer?: { stage: 'pick' } | ({ stage: 'edit' } & Draft) | null;
}
interface CEditing extends ContactEntry { editing?: boolean; draft?: Draft }

export default function HouseholdSection({ adopterId, initialMembers, canEdit }: {
    adopterId: string; initialMembers: HouseholdMember[]; canEdit: boolean;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [members, setMembers] = useState<MemberUI[]>(() => initialMembers.map(m => ({ ...m })));
    const [busy, setBusy] = useState(false);

    const relLabel = (r: Relationship | null | undefined) => r ? t(`adopter.hh_rel_${r}`) : '';
    const patch = (id: string, up: Partial<MemberUI>) => setMembers(prev => prev.map(m => m.id === id ? { ...m, ...up } : m));
    async function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T>): Promise<Extract<T, { ok: true }> | null> {
        setBusy(true);
        try {
            const res = await fn();
            if (!res.ok) { toast.error('No se pudo guardar', res.error); return null; }
            return res as Extract<T, { ok: true }>;
        } catch (e) {
            toast.error('Error', e instanceof Error ? e.message : 'Error inesperado'); return null;
        } finally { setBusy(false); }
    }

    // ── member ops ──
    function startAdd() {
        setMembers(prev => [...prev, { id: `tmp-${Math.random().toString(36).slice(2)}`, name: '', relationship: null, contactEntries: [], editing: true, draftName: '', draftRel: null, isNew: true } as MemberUI & { isNew: boolean }]);
    }
    async function saveMember(m: MemberUI) {
        const name = (m.draftName ?? '').trim();
        const relationship = m.draftRel ?? null;
        const isNew = (m as MemberUI & { isNew?: boolean }).isNew;
        if (isNew) {
            const res = await run(() => addHouseholdMember({ adopterId, name, relationship }));
            if (!res) return;
            patch(m.id, { id: res.memberId, name, relationship, editing: false, draftName: undefined, draftRel: undefined });
            setMembers(prev => prev.map(x => x.id === m.id ? { ...x, id: res.memberId } : x));
        } else {
            const res = await run(() => updateHouseholdMember({ adopterId, memberId: m.id, name, relationship }));
            if (!res) return;
            patch(m.id, { name, relationship, editing: false, draftName: undefined, draftRel: undefined });
        }
        router.refresh();
    }
    function cancelMember(m: MemberUI) {
        if ((m as MemberUI & { isNew?: boolean }).isNew) setMembers(prev => prev.filter(x => x.id !== m.id));
        else patch(m.id, { editing: false, draftName: undefined, draftRel: undefined });
    }
    async function deleteMember(m: MemberUI) {
        const res = await run(() => removeHouseholdMember({ adopterId, memberId: m.id }));
        if (!res) return;
        setMembers(prev => prev.filter(x => x.id !== m.id));
        router.refresh();
    }

    // ── contact ops ──
    function openComposer(m: MemberUI) { patch(m.id, { composer: { stage: 'pick' } }); }
    function pickType(m: MemberUI, type: ContactEntryType) { patch(m.id, { composer: { stage: 'edit', type, value: '', platform: null, apps: [] } }); }
    async function saveNewContact(m: MemberUI) {
        const c = m.composer; if (!c || c.stage !== 'edit') return;
        const platform = c.type === 'social' ? (detectSocialPlatform(c.value) ?? c.platform ?? undefined) : undefined;
        const res = await run(() => addMemberContactEntry({ adopterId, memberId: m.id, type: c.type, value: c.value.trim(), platform, apps: c.apps }));
        if (!res) return;
        const entry: ContactEntry = { id: res.entryId, type: c.type, value: c.value.trim(), ...(platform ? { platform } : {}), ...(c.apps.length ? { apps: c.apps } : {}) };
        patch(m.id, { contactEntries: [...m.contactEntries, entry], composer: null });
        router.refresh();
    }
    function startEditContact(m: MemberUI, ce: CEditing) {
        patch(m.id, { contactEntries: m.contactEntries.map(e => e.id === ce.id ? { ...e, editing: true, draft: { type: e.type, value: e.value, platform: e.platform ?? null, apps: e.apps ?? [] } } as CEditing : e) });
    }
    async function saveEditContact(m: MemberUI, ce: CEditing) {
        const d = ce.draft; if (!d) return;
        const res = await run(() => updateMemberContactEntry({ adopterId, memberId: m.id, entryId: ce.id!, value: d.value.trim(), apps: d.apps }));
        if (!res) return;
        const platform = ce.type === 'social' ? (detectSocialPlatform(d.value) ?? ce.platform) : ce.platform;
        patch(m.id, { contactEntries: m.contactEntries.map(e => e.id === ce.id ? { ...e, value: d.value.trim(), platform, apps: d.apps, editing: false, draft: undefined } as CEditing : e) });
        router.refresh();
    }
    async function deleteContact(m: MemberUI, ce: CEditing) {
        const res = await run(() => removeMemberContactEntry({ adopterId, memberId: m.id, entryId: ce.id! }));
        if (!res) return;
        patch(m.id, { contactEntries: m.contactEntries.filter(e => e.id !== ce.id) });
        router.refresh();
    }

    const contactPlaceholder = (d: Draft) => {
        if (d.type !== 'social') return t(`adopter.ce_input_ph_${d.type}`) || '';
        const eff = detectSocialPlatform(d.value) ?? d.platform;
        return eff ? (t(`adopter.ce_input_ph_social_${eff}`) || t('adopter.ce_input_ph_social')) : t('adopter.ce_input_ph_social');
    };

    // ── contact editor (shared by add + edit) ──
    const editor = (m: MemberUI, d: Draft, onChange: (up: Partial<Draft>) => void, onSave: () => void, onCancel: () => void) => {
        const det = d.type === 'social' ? detectSocialPlatform(d.value) : null;
        const eff = det ?? d.platform;
        const canSave = d.value.trim().length > 0 && (d.type !== 'social' || !!eff);
        return (
            <div className="rounded-lg border border-stone-200 bg-white p-2.5 mt-1.5 space-y-2">
                {d.type === 'social' && (
                    <div>
                        {!det && <div className="text-[11px] font-semibold text-stone-700 mb-1.5">{t('adopter.ce_social_which')} <span className="text-red-600">*</span></div>}
                        <SocialPlatformPicker value={eff} locked={!!det} onChange={pl => onChange({ platform: pl })} size={18} />
                    </div>
                )}
                <input autoFocus type="text" value={d.value} onChange={e => onChange({ value: e.target.value })}
                    placeholder={contactPlaceholder(d)}
                    className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm outline-none focus:border-teal-500" />
                {d.type === 'phone' && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-stone-500">{t('adopter.ce_phone_apps')}</span>
                        <PhoneAppsToggle value={d.apps} onChange={apps => onChange({ apps })} />
                    </div>
                )}
                <div className="flex items-center gap-2 justify-end">
                    <button type="button" onClick={onCancel} disabled={busy} className="text-xs font-medium px-3 py-1.5 rounded text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50">{t('adopter.ce_edit_cancel')}</button>
                    <button type="button" onClick={onSave} disabled={busy || !canSave} className="text-xs font-medium px-3 py-1.5 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40">{t('adopter.ce_edit_save')}</button>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-3">
            {members.length === 0 && !canEdit && <p className="text-sm text-stone-500 italic">{t('adopter.no_family')}</p>}
            {members.map(m => (
                <div key={m.id} className="border border-stone-200 rounded-xl p-3.5 bg-stone-50/60">
                    {m.editing ? (
                        <div className="space-y-2">
                            <div className="flex gap-2 flex-wrap">
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[11px] font-semibold text-stone-500 mb-1">{t('adopter.hh_name')}</label>
                                    <input autoFocus type="text" value={m.draftName ?? ''} onChange={e => patch(m.id, { draftName: e.target.value })} placeholder={t('adopter.hh_name_ph')} className="w-full px-2.5 py-1.5 border border-stone-300 rounded text-sm outline-none focus:border-teal-500" />
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                    <label className="block text-[11px] font-semibold text-stone-500 mb-1">{t('adopter.hh_rel')}</label>
                                    <select value={m.draftRel ?? ''} onChange={e => patch(m.id, { draftRel: (e.target.value || null) as Relationship | null })} className="w-full px-2.5 py-1.5 border border-stone-300 rounded text-sm bg-white outline-none focus:border-teal-500">
                                        <option value="">{t('adopter.hh_rel_choose')}</option>
                                        {RELATIONSHIPS.map(r => <option key={r} value={r}>{t(`adopter.hh_rel_${r}`)}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                                <button type="button" onClick={() => cancelMember(m)} disabled={busy} className="text-xs font-medium px-3 py-1.5 rounded text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50"><X className="w-3.5 h-3.5 inline" /> {t('adopter.ce_edit_cancel')}</button>
                                <button type="button" onClick={() => saveMember(m)} disabled={busy || !((m.draftName ?? '').trim() || m.draftRel)} className="text-xs font-semibold px-3.5 py-1.5 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"><Check className="w-3.5 h-3.5 inline" /> {t('adopter.ce_edit_save')}</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-start gap-2.5">
                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 text-white font-bold text-sm flex items-center justify-center shrink-0">{(m.name.trim()[0] || '?').toUpperCase()}</div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-[15px] text-stone-900 break-words">{m.name || <span className="italic text-stone-400">{t('adopter.hh_name')}</span>}</div>
                                    <div className={`text-xs ${m.relationship ? 'text-stone-500' : 'text-stone-400 italic'}`}>
                                        {m.relationship === 'unknown' ? t('adopter.hh_rel_unknown_display') : m.relationship ? relLabel(m.relationship) : t('adopter.hh_rel_none')}
                                    </div>
                                </div>
                                {canEdit && (
                                    <div className="flex gap-0.5 shrink-0">
                                        <button type="button" onClick={() => patch(m.id, { editing: true, draftName: m.name, draftRel: m.relationship })} title={t('adopter.ce_edit_label')} className="p-1.5 text-stone-500 hover:text-teal-700 hover:bg-teal-50 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                                        <button type="button" onClick={() => deleteMember(m)} title="Quitar" className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                )}
                            </div>
                            {/* contacts */}
                            <div className="mt-3 pt-3 border-t border-dashed border-stone-200">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-2">{t('adopter.hh_contacts')}</p>
                                {m.contactEntries.length > 0 && (
                                    <ul className="space-y-1.5 mb-2">
                                        {(m.contactEntries as CEditing[]).map(ce => ce.editing ? (
                                            <li key={ce.id}>{editor(m, ce.draft!, up => patch(m.id, { contactEntries: m.contactEntries.map(e => e.id === ce.id ? { ...e, draft: { ...(e as CEditing).draft!, ...up } } as CEditing : e) }), () => saveEditContact(m, ce), () => patch(m.id, { contactEntries: m.contactEntries.map(e => e.id === ce.id ? { ...e, editing: false, draft: undefined } as CEditing : e) }))}</li>
                                        ) : (() => {
                                            const branded = ce.type === 'social' && ce.platform && ce.platform !== 'other' && !ce.masked;
                                            const Icon = TYPE_ICON[ce.type];
                                            return (
                                                <li key={ce.id} className="group flex items-center gap-2 text-sm">
                                                    {branded ? <SocialLogo platform={ce.platform!} size={16} className="shrink-0" /> : <Icon className="w-4 h-4 shrink-0 text-teal-600" />}
                                                    <span className="w-20 shrink-0 text-stone-500 text-xs">{branded ? '' : t(`adopter.ce_type_${ce.type}`)}</span>
                                                    <span className={`flex-1 min-w-0 truncate ${ce.masked ? 'text-stone-400 select-none' : 'text-stone-800'}`}>{ce.value}</span>
                                                    {(ce.apps ?? []).map(a => <MessagingLogo key={a} app={a} size={14} />)}
                                                    {canEdit && !ce.masked && (
                                                        <span className="hidden group-hover:flex gap-0.5 shrink-0">
                                                            <button type="button" onClick={() => startEditContact(m, ce)} className="p-1 text-stone-500 hover:text-teal-700 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                                                            <button type="button" onClick={() => deleteContact(m, ce)} className="p-1 text-stone-500 hover:text-red-600 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                                                        </span>
                                                    )}
                                                </li>
                                            );
                                        })())}
                                    </ul>
                                )}
                                {canEdit && (m.composer?.stage === 'pick' ? (
                                    <div className="rounded-lg border border-stone-200 bg-white p-2.5">
                                        <div className="flex flex-wrap gap-1.5 mb-2">
                                            {COMPOSABLE.map(ty => { const I = TYPE_ICON[ty]; return (
                                                <button key={ty} type="button" onClick={() => pickType(m, ty)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-white border border-stone-300 text-stone-700 hover:bg-teal-50 hover:border-teal-300"><I className="w-3 h-3" />{t(`adopter.ce_type_${ty}`)}</button>
                                            ); })}
                                        </div>
                                        <div className="flex justify-end"><button type="button" onClick={() => patch(m.id, { composer: null })} className="text-xs px-3 py-1 rounded text-stone-500 hover:text-stone-700">{t('adopter.ce_edit_cancel')}</button></div>
                                    </div>
                                ) : m.composer?.stage === 'edit' ? (
                                    editor(m, m.composer, up => patch(m.id, { composer: { ...(m.composer as { stage: 'edit' } & Draft), ...up } }), () => saveNewContact(m), () => patch(m.id, { composer: null }))
                                ) : (
                                    <button type="button" onClick={() => openComposer(m)} className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-900"><Plus className="w-4 h-4" />{t('adopter.hh_add_contact')}</button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            ))}
            {canEdit && (
                <button type="button" onClick={startAdd} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-md disabled:opacity-50">
                    <Plus className="w-4 h-4" />{t('adopter.hh_cta_add')}
                </button>
            )}
        </div>
    );
}
