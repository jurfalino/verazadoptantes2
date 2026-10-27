'use client';

/**
 * «Familiares / Convivientes» on a profile — households as profiles (spec
 * 2026-10-26), compact rows (addendum 2026-10-27, variant A).
 *
 * Every person here is a profile; a household is a group of profiles. One
 * compact row per person (MemberCard: name = link to the profile, rating /
 * alerts / activity, one attribution, contacts behind «N datos ▾», «⋯» menu,
 * live summary masked exactly as that profile is for this viewer). No
 * «Hogar con …» titles: only when the person lives in 2+ homes does each home
 * get a small divider («Lucas figura como hijo/a de Pedro»), and then
 * «+ Agregar» first asks «¿En qué hogar?» (each choice labelled by the home's
 * people). Anyone signed in adds someone, with «¿Es este perfil?» before saving.
 *
 * Gift recipients are never «Convive con»: a gift household shows as
 * «Destinatario del regalo» with the recipient's row (P5); a gift form whose
 * recipient has no profile yet shows what the form said, read-only, with
 * «Crear perfil de {nombre}» for the giver's team and admins (P4).
 *
 * Nothing here reads or writes the old `household_members` JSON: the data is
 * `getHouseholdsFor` (src/lib/households.ts) via the page.
 */
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Gift, Plus, UserPlus } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { AnswerRow } from '@/components/FormAnswersPanel';
import { MemberCard, useMemberLabel } from '@/components/household/MemberCard';
import { AddPersonForm, useHouseholdFailure } from '@/components/household/PersonForms';
import { createGiftRecipientProfile } from '@/app/actions';
import type { HouseholdView } from '@/lib/households';
import type { ProfileHouseholds } from '@/domain/profileHouseholds';
import { fill, firstName, joinNames } from '@/lib/householdCopy';
import { householdForAdd, separateHomes } from '@/domain/households';

/** «+ Agregar» — a slim text button; with 2+ homes it opens «¿En qué hogar?» (the ▾). */
function AddMemberButton({ onClick, expanded, buttonRef }: { onClick: () => void; expanded?: boolean; buttonRef?: Ref<HTMLButtonElement> }) {
    const { t } = useLanguage();
    return (
        // The visible «Agregar» sits under the «Familiares / Convivientes» heading; the accessible name says the whole thing.
        <button ref={buttonRef} type="button" data-testid="household-add-member" onClick={onClick} aria-label={t('adopter.hh_cta_add')}
            aria-expanded={expanded} aria-haspopup={expanded === undefined ? undefined : 'menu'}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-teal-700 hover:underline">
            <Plus className="w-4 h-4" aria-hidden="true" />{t('adopter.hh_add_short')}
            {expanded !== undefined && <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />}
        </button>
    );
}

/** The small divider above each home, only when the profile lives in 2+. */
function HomeDivider({ text }: { text: string }) {
    return (
        <div className="flex items-center gap-2 pt-2" data-testid="household-home-divider">
            <span className="text-[11px] font-semibold text-stone-500 break-words min-w-0">{text}</span>
            <span className="flex-1 border-t border-stone-200" aria-hidden="true" />
        </div>
    );
}

function GiftShell({ title, body, children, testId }: { title: string; body: string; children: ReactNode; testId: string }) {
    return (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3" data-testid={testId}>
            <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0"><Gift className="w-4 h-4" aria-hidden="true" /></div>
                <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-[15px] text-amber-900 break-words">{title}</h4>
                    <p className="text-xs text-amber-800 break-words">{body}</p>
                </div>
            </div>
            {children}
        </section>
    );
}

export default function HouseholdSection({ adopterId, hostName, data, signedIn, currentUser, isAdmin, preview = false, hasLegacyText = false }: {
    adopterId: string;
    /** This profile's name. */
    hostName: string;
    data: ProfileHouseholds;
    signedIn: boolean;
    /** The viewer's email: the contacts they added to a member stay editable there, as on the profile. */
    currentUser?: string;
    /** Admin (false in «Ver como desconocido»): deletes any member's profile. */
    isAdmin: boolean;
    /** «Ver como desconocido»: what a stranger sees — no menus, no own markers, no «Crear perfil». */
    preview?: boolean;
    /** Legacy free-text family notes are shown beneath: don't also say «Sin familiares». */
    hasLegacyText?: boolean;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const fail = useHouseholdFailure('HouseholdSection.gift');
    const labelOf = useMemberLabel();
    /** Which add form is open: a household id, or '' for the profile's own (or new) household. */
    const [adding, setAdding] = useState<string | null>(null);
    /** «¿En qué hogar?» is open (2+ homes). */
    const [choosing, setChoosing] = useState(false);
    const [creating, setCreating] = useState<string | null>(null);
    /** Focus goes back to «+ Agregar» when the form closes (cancelled or saved), as the contact list does. */
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const wasAdding = useRef(false);
    useEffect(() => {
        if (wasAdding.current && adding === null) addButtonRef.current?.focus();
        wasAdding.current = adding !== null;
    }, [adding]);
    /** «¿En qué hogar?» closes on Escape, back on its button. */
    useEffect(() => {
        if (!choosing) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setChoosing(false); addButtonRef.current?.focus(); } };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [choosing]);

    const homes = data.views.filter(v => !v.isGift);
    const gifts = data.views.filter(v => v.isGift);
    const hostFirst = firstName(hostName) || hostName;
    const canAdd = signedIn;
    const separate = separateHomes(homes);

    /** «Parentesco de Pedro»: who a member's relationship points at. */
    const relativeNameOf = (view: HouseholdView, relativeTo: string | null) => {
        if (!relativeTo) return '';
        if (relativeTo === adopterId) return hostFirst;
        const r = view.members.find(m => m.profileId === relativeTo);
        return r ? firstName(r.name) || r.name : '';
    };

    /** A home by its people, the anchor (the person relationships point at) first: «Pedro y Marta». */
    const peopleOf = (view: HouseholdView) => joinNames(t, [...view.members]
        .sort((a, b) => Number(b.isAnchor) - Number(a.isAnchor))
        .map(m => firstName(m.name) || m.name).filter(Boolean));

    /** The divider's words: the profile's own place there («Lucas figura como hijo/a de Pedro»), else whose home it is. */
    const dividerOf = (view: HouseholdView) => {
        const self = labelOf(view.self.label);
        return self
            ? fill(t('adopter.hh_self_as'), { name: hostFirst, rel: self.charAt(0).toLowerCase() + self.slice(1) })
            : fill(t('adopter.hh_with_names'), { names: peopleOf(view) });
    };

    const memberRows = (view: HouseholdView, gift = false) => (
        <ul className="divide-y divide-stone-100">
            {view.members
                .filter(m => !gift || m.giftRecipient)
                .map(m => (
                    <MemberCard key={m.membershipId} member={m} hostName={hostName} relativeName={relativeNameOf(view, m.relativeToAdopterId)}
                        signedIn={signedIn} currentUser={currentUser} isAdmin={isAdmin} preview={preview} gift={gift} testId={gift ? 'household-gift-recipient' : 'household-member'} />
                ))}
        </ul>
    );

    /** «+ Agregar»: into the one home (or a new one when there is none); with 2+, into the one picked. */
    const addArea = () => {
        if (!canAdd) return null;
        if (adding !== null) {
            const view = homes.find(h => h.id === adding) ?? null;
            // Always an explicit household when the profile has one; only a profile-level add names none.
            const target = householdForAdd(view);
            return (
                <div className="pt-1">
                    <AddPersonForm
                        anchorAdopterId={adopterId}
                        householdId={target}
                        hostName={hostName}
                        relativeName={hostFirst}
                        othersInHome={view?.members.map(m => m.name).filter(Boolean) ?? []}
                        excludeIds={homes.flatMap(h => h.members.map(m => m.profileId))}
                        onDone={() => setAdding(null)}
                    />
                </div>
            );
        }
        if (!separate) return <AddMemberButton buttonRef={addButtonRef} onClick={() => setAdding(homes[0]?.id ?? '')} />;
        return (
            <span className="relative inline-flex">
                <AddMemberButton buttonRef={addButtonRef} onClick={() => setChoosing(c => !c)} expanded={choosing} />
                {choosing && (
                    <>
                        <span className="fixed inset-0 z-40" onClick={() => setChoosing(false)} />
                        <span role="menu" data-testid="household-add-which"
                            className="absolute left-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-stone-200 z-50 overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-150">
                            <span className="px-4 pt-3 pb-1 text-xs font-semibold text-stone-500">{t('adopter.hh_add_which')}</span>
                            {homes.map(v => (
                                <button key={v.id} type="button" role="menuitem" data-testid="household-add-which-option" data-household-id={v.id}
                                    className="px-4 py-3 min-h-[44px] text-left text-sm font-semibold text-stone-900 hover:bg-stone-50 transition-colors border-t border-stone-100 break-words"
                                    onClick={() => { setChoosing(false); setAdding(v.id); }}>
                                    {fill(t('adopter.hh_with_names'), { names: peopleOf(v) })}
                                </button>
                            ))}
                        </span>
                    </>
                )}
            </span>
        );
    };

    async function createGift(submissionId: string, name: string) {
        setCreating(submissionId);
        try {
            const res = await createGiftRecipientProfile({ giverAdopterId: adopterId, submissionId });
            if (!res.ok) {
                if (res.error === 'conflict') { toast.warning(t('adopter.hh_err_gift_conflict')); return; }
                fail.refused(res);
                return;
            }
            toast.success('✓', fill(t('adopter.hh_gift_created'), { name }));
            router.refresh();
        } catch (e) {
            fail.thrown(e);
        } finally {
            setCreating(null);
        }
    }

    const giverFirst = hostFirst || t('adopter.nameless');
    const nothing = homes.length === 0 && gifts.length === 0 && data.giftForms.length === 0;

    return (
        <div data-testid="household-section">
            {nothing && !canAdd && !hasLegacyText && <p className="text-sm text-stone-500 italic">{t('adopter.no_family')}</p>}

            {homes.map(view => (
                <div key={view.id} data-household-id={view.id}>
                    {separate && <HomeDivider text={dividerOf(view)} />}
                    {memberRows(view)}
                </div>
            ))}

            {addArea()}

            {(gifts.length > 0 || data.giftForms.length > 0) && <div className="mt-2 space-y-3">
            {gifts.map(view => {
                const recipient = view.members.find(m => m.giftRecipient);
                if (!recipient) return null;
                const recipientFirst = firstName(recipient.name) || recipient.name;
                return (
                    <GiftShell key={view.id} testId="household-gift" title={t('adopter.hh_gift_title')}
                        body={fill(t('adopter.hh_gift_body'), { giver: giverFirst, recipient: recipientFirst })}>
                        {memberRows(view, true)}
                    </GiftShell>
                );
            })}

            {data.giftForms.map(g => (
                <GiftShell key={g.submissionId} testId="household-gift-form" title={t('adopter.hh_gift_form_title')}
                    body={fill(t('adopter.hh_gift_form_body'), { giver: giverFirst })}>
                    {/* Read-only, as the form gave it — the same rows as «Respuestas del formulario». */}
                    <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm space-y-1" data-testid="household-gift-form-data">
                        <AnswerRow label={t('adopter.hh_name')}>{g.name || <span className="italic text-stone-500">{t('adopter.hh_gift_masked_name')}</span>}</AnswerRow>
                        {g.phone && <AnswerRow label={t('adopter.ce_type_phone')}>{g.phone}</AnswerRow>}
                    </div>
                    {!preview && data.canCreateGift && !g.masked && g.name && (
                        <button type="button" data-testid="household-gift-create" disabled={creating !== null} onClick={() => { void createGift(g.submissionId, g.name); }}
                            className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-md disabled:opacity-50">
                            <UserPlus className="w-4 h-4" aria-hidden="true" />{creating === g.submissionId ? '…' : fill(t('adopter.hh_gift_create'), { name: g.name })}
                        </button>
                    )}
                </GiftShell>
            ))}
            </div>}
        </div>
    );
}
