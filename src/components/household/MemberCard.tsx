'use client';

/**
 * One person in a household — a compact row (addendum 2026-10-27, variant A):
 *
 *   (M) Marta Paez ★4.0 · 1 alerta   1 adopción · 1 tránsito          ⋯
 *       pareja · 16 años · según Refugio Patitas · 2 datos ▾
 *
 * The initial; the name — the link to their profile; the rating and open
 * alerts («Menor de edad» instead: a minor carries no rating or alerts);
 * the person's activity counted exactly as their own «Actividad» header
 * counts it (ActivityCountsLine — for a minor only when they have any); then one line with the relationship, the
 * age, ONE attribution («agregado por vos» / «según {quien lo agregó}») and
 * the contacts collapsed behind «N datos ▾» (a padlock when some are
 * protected), which open to that person's contact list — the profile's own
 * (MemberContacts → ContactEntriesSection). With no contacts there is nothing
 * to open: a signed-in viewer sees that list's «Agregar dato de contacto»
 * straight away, the one add-contact control of the whole app. The «⋯» menu holds what this viewer may do:
 * - «Editar»: everyone signed in, on every row (the same form for all — the
 *   anchor's row too, without a relationship field: its row has none);
 * - «Quitar del hogar» («Quitar como destinatario» on a gift recipient):
 *   whoever may take the person out (`canRemove`: the adder, the household's
 *   teams, admins and moderators);
 * - «Eliminar perfil de X» / «Pedir eliminación»: today's deletion rules — the
 *   person's owner (delete when nobody else contributed, else ask the admins)
 *   or an admin (always delete). Which one is read when the menu opens
 *   (checkAdopterDeletable), as the profile's own delete button does.
 * Rendered as an `<li>`: the caller's `<ul>` divides the rows.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import { useRouter } from 'next/navigation';
import { ChevronDown, Lock, Pencil, Trash2, UserMinus } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { MemberContacts } from '@/components/LinkedProfileSummary';
import { PersonStanding, PersonActivity } from '@/components/PersonStanding';
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

export function MemberCard({ member, hostName, relativeName, signedIn, currentUser, isAdmin, preview, gift = false, testId = 'household-member' }: {
    member: HouseholdMemberView;
    /** The viewed profile's name («del hogar de Pedro Paez»). */
    hostName: string;
    /** «Parentesco de Pedro» in «Editar». */
    relativeName: string;
    signedIn: boolean;
    /** The viewer's email: the contacts they added stay editable, as on the profile. */
    currentUser?: string;
    isAdmin: boolean;
    /** «Ver como desconocido»: no menu, no «agregado por vos». */
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
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const closeMenu = useCallback(() => setMenuOpen(false), []);
    useEscapeToClose(menuOpen, closeMenu, menuButtonRef);
    const [editing, setEditing] = useState(false);
    const [dialog, setDialog] = useState<'remove' | 'delete' | 'request' | null>(null);
    const [busy, setBusy] = useState(false);
    const [deletion, setDeletion] = useState<Deletion | 'loading' | 'none'>('none');
    const [contactsOpen, setContactsOpen] = useState(false);
    const contactsId = useId();

    const name = member.name?.trim() || t('adopter.nameless');
    // «Editar» is the same form for everyone signed in (spec «Editing (revised)»): name, age, minor and,
    // where the row has one, the relationship — open, credited, the owner's team told.
    const canEdit = !preview && signedIn;
    const canRemove = !preview && signedIn && member.canRemove;
    const mayDelete = !preview && signedIn && (member.ownerIsViewer || isAdmin);
    const hasMenu = canEdit || canRemove || mayDelete;
    const rel = labelOf(member.label);
    // Mid-sentence on the row: «pareja de Pedro · 16 años».
    const sub = [rel ? rel.charAt(0).toLowerCase() + rel.slice(1) : null, member.age != null ? fill(t('adopter.hh_years'), { n: member.age }) : null].filter(Boolean).join(' · ');
    // ONE attribution: the viewer's own add, else who added them (an anchor row has no adder: none).
    const own = !preview && member.addedByViewer;
    const attribution = own ? t('adopter.hh_added_by_you') : member.addedByName ? fill(t('adopter.hh_lives_with_by'), { name: member.addedByName }) : null;
    const dataCount = member.contacts.length + member.moreContacts;
    const locked = member.contacts.some(c => c.masked);
    // «N datos ▾» only when there is something to open.
    const hasContactsToggle = dataCount > 0;
    // No contacts yet: a signed-in viewer gets «Agregar dato de contacto» right under the row (D55).
    const showAddContact = dataCount === 0 && signedIn;
    // The first contact was just added from there: keep the list open on it instead of folding it into «1 dato ▾».
    const prevCount = useRef(dataCount);
    useEffect(() => {
        if (prevCount.current === 0 && dataCount > 0 && signedIn) setContactsOpen(true);
        prevCount.current = dataCount;
    }, [dataCount, signedIn]);
    // As on that person's own profile: its owner or an admin edits every contact, anyone their own.
    const canEditContacts = !preview && (member.ownerIsViewer || isAdmin);

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
            toast.success('✓', fill(t('adopter.hh_remove_done'), { name }));
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
            toast.success('✓', fill(t('adopter.hh_delete_done'), { name }));
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
            <li className="py-2" data-testid={testId}>
                {/* Edited in place, like a contact row: no grey card (it reads as a dark hole in Azul Noche), aligned with the names. */}
                <div className="pl-10">
                    <EditMemberForm member={member} relativeName={relativeName} onDone={() => setEditing(false)} />
                </div>
            </li>
        );
    }

    const items: Array<{ id: 'edit' | 'remove' | 'delete' | 'request'; icon: ReactNode; title: string; desc?: string; danger?: boolean; disabled?: boolean }> = [];
    if (canEdit) items.push({ id: 'edit', icon: <Pencil className="w-5 h-5 mt-0.5 shrink-0 text-teal-700" aria-hidden="true" />, title: t('adopter.hh_menu_edit') });
    if (canRemove) items.push({
        id: 'remove', icon: <UserMinus className="w-5 h-5 mt-0.5 shrink-0 text-teal-700" aria-hidden="true" />,
        title: t(gift ? 'adopter.hh_menu_remove_gift' : 'adopter.hh_menu_remove'), desc: t('adopter.hh_menu_remove_desc'),
    });
    if (mayDelete && deletion === 'loading') items.push({ id: 'delete', icon: <Trash2 className="w-5 h-5 mt-0.5 shrink-0 text-stone-400" aria-hidden="true" />, title: t('adopter.hh_menu_checking'), disabled: true });
    if (mayDelete && deletion && typeof deletion === 'object') {
        items.push(deletion.kind === 'delete'
            ? {
                id: 'delete', danger: true, icon: <Trash2 className="w-5 h-5 mt-0.5 shrink-0 text-rose-700" aria-hidden="true" />,
                title: fill(t('adopter.hh_menu_delete'), { name: firstName(name) || name }),
                desc: t(deletion.others > 0 ? 'adopter.hh_menu_delete_admin_desc' : 'adopter.hh_menu_delete_desc'),
            }
            : {
                id: 'request', danger: true, icon: <Trash2 className="w-5 h-5 mt-0.5 shrink-0 text-rose-700" aria-hidden="true" />,
                title: t('adopter.hh_menu_request'), desc: t('adopter.hh_menu_request_desc'),
            });
    }

    return (
        <li className="py-2" data-testid={testId} data-profile-id={member.profileId}>
            <div className="flex items-start gap-2">
                <span className="mt-1.5 w-8 h-8 rounded-full bg-teal-600 text-white font-bold text-xs flex items-center justify-center shrink-0" aria-hidden="true">{(name[0] || '?').toUpperCase()}</span>
                <div className="min-w-0 flex-1 py-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        {/* `relative z-10`: the contacts toggle's padded hit area (below) reaches up into this line; the name always wins. */}
                        <a href={`/adopter/${encodeURIComponent(member.profileId)}`} data-testid="household-member-profile-link" className="relative z-10 font-semibold text-[15px] text-teal-700 hover:underline min-w-0 break-words">{name}</a>
                        {/* The one «standing + activity» renderer (PersonStanding), as «¿Es este perfil?» and every card's household line. */}
                        <PersonStanding rating={member.rating} openAlerts={member.openAlerts} isMinor={member.isMinor} alertsTestId="household-member-alerts" />
                        <PersonActivity activity={member.activity} isMinor={member.isMinor} testId="household-member-activity" />
                    </div>
                    {(sub || attribution || hasContactsToggle) && (
                        <div className="text-xs text-stone-500 mt-1 break-words">
                            {/* Each piece keeps together («según Test Admin», «4 datos ▾»); the line wraps between them. */}
                            {sub && <span className="inline-block max-w-full" data-testid="household-member-label">{sub}</span>}
                            {attribution && (
                                // The «·» travels with the piece it introduces, so a piece («según Test Admin», «4 datos ▾») never splits across lines.
                                <span className="inline-block max-w-full">
                                    {sub && <span className="text-stone-400 mx-1" aria-hidden="true">·</span>}
                                    <span data-testid={own ? 'household-member-own' : 'household-member-by'}>{attribution}</span>
                                </span>
                            )}
                            {hasContactsToggle && (
                                <span className="inline-block">
                                    {(sub || attribution) && <span className="text-stone-400 mx-1" aria-hidden="true">·</span>}
                                    {/* Inline, so the name keeps the row's width; the ::after pads the hit area to 44px. */}
                                    <button type="button" onClick={() => setContactsOpen(o => !o)} aria-expanded={contactsOpen} aria-controls={contactsId}
                                        data-testid="household-member-contacts-toggle"
                                        className="relative inline-flex items-center gap-1 leading-5 font-semibold text-teal-700 hover:underline whitespace-nowrap after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']">
                                        {locked && <Lock className="w-3 h-3 opacity-70" aria-label={t('adopter.ce_masked')} data-testid="household-member-contacts-locked" />}
                                        {dataCount === 1 ? t('adopter.hh_data_one') : fill(t('adopter.hh_data_many'), { n: dataCount })}
                                        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${contactsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                                    </button>
                                </span>
                            )}
                        </div>
                    )}
                </div>
                {hasMenu && (
                    <div className="relative shrink-0">
                        <button ref={menuButtonRef} type="button" onClick={() => { void openMenu(); }} aria-label={t('adopter.hh_menu_more')} aria-haspopup="menu" aria-expanded={menuOpen}
                            data-testid="household-member-menu"
                            className="group inline-flex min-w-[44px] min-h-[44px] items-center justify-center text-stone-500 hover:text-stone-600">
                            {/* The profile header's ⋯ (profile-overflow), in a 44px tap area. */}
                            <span className="flex items-center p-1.5 rounded-lg bg-stone-50 group-hover:bg-stone-100 transition-all duration-150">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                            </span>
                        </button>
                        {menuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                                <div role="menu" data-testid="household-member-menu-panel" className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-stone-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                    {items.map((i, n) => (
                                        <div key={i.id}>
                                            {n > 0 && <div className="border-t border-stone-100" />}
                                            <button type="button" role="menuitem" disabled={i.disabled} onClick={() => pick(i.id)} data-testid={`household-member-menu-${i.id}`}
                                                className="w-full flex items-start gap-3 px-4 py-3 min-h-[44px] hover:bg-stone-50 transition-colors text-left disabled:cursor-wait">
                                                {i.icon}
                                                <div className="min-w-0">
                                                    <div className={`text-sm font-semibold ${i.danger ? 'text-rose-700' : i.disabled ? 'text-stone-500' : 'text-stone-900'}`}>{i.title}</div>
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
            {(contactsOpen || showAddContact) && (
                // With no contacts this is the list's own «Agregar dato de contacto» (no empty line): the same
                // control, copy and composer as on the profile.
                <div className="pl-10 pr-2 pt-1" id={contactsId}>
                    <MemberContacts summary={member} canAddContact={signedIn} canEditAll={canEditContacts} currentUser={preview ? undefined : currentUser} />
                </div>
            )}
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
        </li>
    );
}
