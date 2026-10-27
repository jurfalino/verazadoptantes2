'use client';

/**
 * One person in a household (households as profiles, prototype P1–P3, M1):
 * the initial, the name — the link to their profile — with «Menor de edad»,
 * «pareja de Pedro · 16 años», then the «⋯» menu, then the live summary
 * (LinkedProfileSummary). The menu holds what this viewer may do:
 * - «Editar»: everyone signed in, on every card (the same form for all — the
 *   anchor's card too, without a relationship field: its row has none);
 * - «Quitar del hogar»: whoever may take the person out (`canRemove`: the
 *   adder, the household's teams, admins);
 * - «Eliminar perfil de X» / «Pedir eliminación»: today's deletion rules — the
 *   person's owner (delete when nobody else contributed, else ask the admins)
 *   or an admin (always delete). Which one is read when the menu opens
 *   (checkAdopterDeletable), as the profile's own delete button does.
 */
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, UserMinus } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { MinorTag } from '@/components/MinorTag';
import { LinkedProfileSummary } from '@/components/LinkedProfileSummary';
import { EditMemberForm, useHouseholdFailure } from '@/components/household/PersonForms';
import { RemoveFromHomeDialog, RequestDeletionDialog, DeleteProfileDialog, type DeletionCollaborators, type RemoveReason } from '@/components/household/HouseholdDialogs';
import { checkAdopterDeletable, deleteOwnAdopter, removeHouseholdMembership, requestAdopterDeletion } from '@/app/actions';
import type { HouseholdMemberView } from '@/lib/households';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { fill, firstName } from '@/lib/householdCopy';

type Deletion = { kind: 'delete' | 'request'; collaborators: DeletionCollaborators; others: number } | null;

/** The membership's label as words: «Pareja» / «Pareja de Pedro». */
export function useMemberLabel() {
    const { t } = useLanguage();
    return (label: HouseholdMemberView['label']): string | null => {
        if (!label) return null;
        if (label.key === 'adopter.hh_rel_of') {
            return fill(t('adopter.hh_rel_of'), { rel: t(label.params.rel), name: firstName(label.params.name) || label.params.name });
        }
        return fill(t(label.key), label.params);
    };
}

export function MemberCard({ member, hostName, relativeName, signedIn, isAdmin, preview, gift = false, testId = 'household-member' }: {
    member: HouseholdMemberView;
    /** The viewed profile's name («del hogar de Pedro Paez»). */
    hostName: string;
    /** «Parentesco de Pedro» in «Editar». */
    relativeName: string;
    signedIn: boolean;
    isAdmin: boolean;
    /** «Ver como desconocido»: no menu, no own-line. */
    preview: boolean;
    /** A gift recipient (P5): «Quitar como destinatario» instead of «Quitar del hogar» («Editar» as on every card). */
    gift?: boolean;
    testId?: string;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const fail = useHouseholdFailure('MemberCard');
    const labelOf = useMemberLabel();
    const [menuOpen, setMenuOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [dialog, setDialog] = useState<'remove' | 'delete' | 'request' | null>(null);
    const [busy, setBusy] = useState(false);
    const [deletion, setDeletion] = useState<Deletion | 'loading' | 'none'>('none');

    const name = member.name?.trim() || t('adopter.nameless');
    // «Editar» is the same form for everyone signed in (spec «Editing (revised)»): name, age, minor and,
    // where the row has one, the relationship — open, credited, the owner's team told.
    const canEdit = !preview && signedIn;
    const canRemove = !preview && signedIn && member.canRemove;
    const mayDelete = !preview && signedIn && (member.ownerIsViewer || isAdmin);
    const hasMenu = canEdit || canRemove || mayDelete;
    const sub = [labelOf(member.label), member.age != null ? fill(t('adopter.hh_years'), { n: member.age }) : null].filter(Boolean).join(' · ');
    const ownLine = !preview && member.addedByViewer && !member.ownerIsViewer ? t('adopter.hh_added_by_you') : null;

    async function openMenu() {
        const next = !menuOpen;
        setMenuOpen(next);
        if (!next || !mayDelete || deletion !== 'none') return;
        setDeletion('loading');
        try {
            const res = await checkAdopterDeletable(member.profileId);
            if (!res.isOwner) { setDeletion(null); return; }
            const others = Object.values(res.collaborators).reduce((a, b) => a + b, 0);
            setDeletion({ kind: res.canDelete ? 'delete' : 'request', collaborators: res.collaborators, others });
        } catch (e) {
            setDeletion(null);
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('adopter.delete_error_check'), resolveErrorId(e, 'MemberCard.checkDeletable'));
        }
    }

    function pick(action: 'edit' | 'remove' | 'delete' | 'request') {
        setMenuOpen(false);
        if (action === 'edit') setEditing(true);
        else setDialog(action);
    }

    async function remove(reason: RemoveReason) {
        setBusy(true);
        try {
            const res = await removeHouseholdMembership({ membershipId: member.membershipId, reason });
            if (!res.ok) { fail.refused(res); setDialog(null); return; }
            toast.success(fill(t('adopter.hh_remove_done'), { name }));
            setDialog(null);
            router.refresh();
        } catch (e) {
            fail.thrown(e);
        } finally {
            setBusy(false);
        }
    }

    async function deleteProfile() {
        setBusy(true);
        try {
            await deleteOwnAdopter(member.profileId);
            toast.success(fill(t('adopter.hh_delete_done'), { name }));
            setDialog(null);
            router.refresh();
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('errors.delete_failed_generic'), resolveErrorId(e, 'MemberCard.delete'));
        } finally {
            setBusy(false);
        }
    }

    async function requestDeletion() {
        setBusy(true);
        try {
            await requestAdopterDeletion(member.profileId);
            toast.success('✓', t('adopter.delete_request_success'));
            setDialog(null);
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('errors.delete_request_failed'), resolveErrorId(e, 'MemberCard.request'));
        } finally {
            setBusy(false);
        }
    }

    if (editing) {
        return (
            <div className="border border-stone-200 rounded-xl p-3.5 bg-stone-50" data-testid={testId}>
                <EditMemberForm member={member} relativeName={relativeName} onDone={() => setEditing(false)} />
            </div>
        );
    }

    const items: Array<{ id: 'edit' | 'remove' | 'delete' | 'request'; icon: ReactNode; title: string; desc?: string; danger?: boolean; disabled?: boolean }> = [];
    if (canEdit) items.push({ id: 'edit', icon: <Pencil className="w-4 h-4 mt-0.5 shrink-0 text-teal-700" aria-hidden="true" />, title: t('adopter.hh_menu_edit') });
    if (canRemove) items.push({
        id: 'remove', icon: <UserMinus className="w-4 h-4 mt-0.5 shrink-0 text-teal-700" aria-hidden="true" />,
        title: t(gift ? 'adopter.hh_menu_remove_gift' : 'adopter.hh_menu_remove'), desc: t('adopter.hh_menu_remove_desc'),
    });
    if (mayDelete && deletion === 'loading') items.push({ id: 'delete', icon: <Trash2 className="w-4 h-4 mt-0.5 shrink-0 text-stone-400" aria-hidden="true" />, title: t('adopter.hh_menu_checking'), disabled: true });
    if (mayDelete && deletion && typeof deletion === 'object') {
        items.push(deletion.kind === 'delete'
            ? {
                id: 'delete', danger: true, icon: <Trash2 className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" aria-hidden="true" />,
                title: fill(t('adopter.hh_menu_delete'), { name: firstName(name) || name }),
                desc: t(deletion.others > 0 ? 'adopter.hh_menu_delete_admin_desc' : 'adopter.hh_menu_delete_desc'),
            }
            : {
                id: 'request', danger: true, icon: <Trash2 className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" aria-hidden="true" />,
                title: t('adopter.hh_menu_request'), desc: t('adopter.hh_menu_request_desc'),
            });
    }

    return (
        <div className="border border-stone-200 rounded-xl p-3.5 bg-stone-50" data-testid={testId} data-profile-id={member.profileId}>
            <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-teal-600 text-white font-bold text-sm flex items-center justify-center shrink-0" aria-hidden="true">{(name[0] || '?').toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-semibold text-[15px] text-stone-900 break-words">
                        <a href={`/adopter/${encodeURIComponent(member.profileId)}`} data-testid="household-member-profile-link" className="text-teal-700 hover:underline min-w-0 break-words">{name}</a>
                        {member.isMinor && <MinorTag />}
                    </div>
                    {sub && <div className="text-xs text-stone-500" data-testid="household-member-label">{sub}</div>}
                    {ownLine && <div className="text-xs text-stone-500" data-testid="household-member-own">{ownLine}</div>}
                </div>
                {hasMenu && (
                    <div className="relative shrink-0">
                        <button type="button" onClick={() => { void openMenu(); }} aria-label={t('adopter.hh_menu_more')} aria-haspopup="menu" aria-expanded={menuOpen}
                            data-testid="household-member-menu"
                            className="inline-flex min-w-[44px] min-h-[44px] items-center justify-center rounded-lg text-stone-500 hover:text-stone-600 hover:bg-stone-100 transition-all duration-150">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                        </button>
                        {menuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                                <div role="menu" data-testid="household-member-menu-panel" className="absolute right-0 mt-1 w-64 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-stone-200 z-50 overflow-hidden">
                                    {items.map((i, n) => (
                                        <div key={i.id}>
                                            {n > 0 && <div className="border-t border-stone-100" />}
                                            <button type="button" role="menuitem" disabled={i.disabled} onClick={() => pick(i.id)} data-testid={`household-member-menu-${i.id}`}
                                                className="w-full flex items-start gap-3 px-4 py-3 min-h-[44px] hover:bg-stone-50 transition-colors text-left disabled:cursor-wait">
                                                {i.icon}
                                                <div className="min-w-0">
                                                    <div className={`text-sm font-semibold ${i.danger ? 'text-rose-600' : i.disabled ? 'text-stone-500' : 'text-stone-900'}`}>{i.title}</div>
                                                    {i.desc && <div className="text-xs text-stone-500 mt-0.5">{i.desc}</div>}
                                                </div>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
            <LinkedProfileSummary summary={member} canAddContact={signedIn} minor={member.isMinor} />
            {dialog === 'remove' && (
                <RemoveFromHomeDialog person={name} host={hostName} gift={gift} busy={busy} onCancel={() => setDialog(null)} onConfirm={reason => { void remove(reason); }} />
            )}
            {dialog === 'request' && (
                <RequestDeletionDialog name={name} collaborators={deletion && typeof deletion === 'object' ? deletion.collaborators : null} busy={busy}
                    onCancel={() => setDialog(null)} onConfirm={() => { void requestDeletion(); }} />
            )}
            {dialog === 'delete' && (
                <DeleteProfileDialog name={name} host={hostName} busy={busy} onCancel={() => setDialog(null)} onConfirm={() => { void deleteProfile(); }} />
            )}
        </div>
    );
}
