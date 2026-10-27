'use client';

/**
 * «Familiares / Convivientes» on a profile — households as profiles (spec
 * 2026-10-26, prototype states P1–P5, M1, Q1, D1, D2, E1, E2, A1–A5).
 *
 * Every person here is a profile; a household is a group of profiles. One
 * block per household — titled «Hogar con Pedro Paez y Marta Paez» (with the
 * viewed profile's own place: «Lucas figura como hijo/a de Pedro · según …»)
 * only when the person lives in two or more homes. Each person is a MemberCard
 * (name = link to the profile, «⋯» menu, live summary masked exactly as that
 * profile is for this viewer). Anyone signed in adds someone
 * («Agregar familiar / conviviente», with «¿Es este perfil?» before saving).
 *
 * Gift recipients are never «Convive con»: a gift household shows as
 * «Destinatario del regalo» with the recipient's card (P5); a gift form whose
 * recipient has no profile yet shows what the form said, read-only, with
 * «Crear perfil de {nombre}» for the giver's team and admins (P4).
 *
 * Nothing here reads or writes the old `household_members` JSON: the data is
 * `getHouseholdsFor` (src/lib/households.ts) via the page.
 */
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, Home, Plus, UserPlus } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { AnswerRow } from '@/components/FormAnswersPanel';
import { MemberCard, useMemberLabel } from '@/components/household/MemberCard';
import { AddPersonForm, useHouseholdFailure } from '@/components/household/PersonForms';
import { createGiftRecipientProfile } from '@/app/actions';
import type { HouseholdView } from '@/lib/households';
import type { ProfileHouseholds } from '@/domain/profileHouseholds';
import { fill, firstName, joinNames } from '@/lib/householdCopy';

function AddMemberButton({ onClick }: { onClick: () => void }) {
    const { t } = useLanguage();
    return (
        <button type="button" data-testid="household-add-member" onClick={onClick}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-md">
            <Plus className="w-4 h-4" />{t('adopter.hh_cta_add')}
        </button>
    );
}

/** A titled block for one household when the profile is in several (P2). */
function HomeBlock({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
    return (
        <section className="rounded-xl border border-stone-200 p-3 space-y-3" data-testid="household-block">
            <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0"><Home className="w-4 h-4" aria-hidden="true" /></div>
                <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-[15px] text-stone-900 break-words">{title}</h4>
                    {sub && <div className="text-xs text-stone-500 break-words">{sub}</div>}
                </div>
            </div>
            {children}
        </section>
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

export default function HouseholdSection({ adopterId, hostName, data, signedIn, isAdmin, preview = false, hasLegacyText = false }: {
    adopterId: string;
    /** This profile's name. */
    hostName: string;
    data: ProfileHouseholds;
    signedIn: boolean;
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
    const [creating, setCreating] = useState<string | null>(null);

    const homes = data.views.filter(v => !v.isGift);
    const gifts = data.views.filter(v => v.isGift);
    const hostFirst = firstName(hostName) || hostName;
    const canAdd = signedIn;
    const titled = homes.length >= 2;

    /** «Parentesco de Pedro»: who a member's relationship points at. */
    const relativeNameOf = (view: HouseholdView, relativeTo: string | null) => {
        if (!relativeTo) return '';
        if (relativeTo === adopterId) return hostFirst;
        const r = view.members.find(m => m.profileId === relativeTo);
        return r ? firstName(r.name) || r.name : '';
    };

    const memberCards = (view: HouseholdView, gift = false) => view.members
        .filter(m => !gift || m.giftRecipient)
        .map(m => (
            <MemberCard key={m.membershipId} member={m} hostName={hostName} relativeName={relativeNameOf(view, m.relativeToAdopterId)}
                signedIn={signedIn} isAdmin={isAdmin} preview={preview} gift={gift} testId={gift ? 'household-gift-recipient' : 'household-member'} />
        ));

    const addArea = (view: HouseholdView | null) => {
        if (!canAdd) return null;
        const key = view?.id ?? '';
        if (adding === key) {
            return (
                <AddPersonForm
                    anchorAdopterId={adopterId}
                    householdId={view?.id}
                    hostName={hostName}
                    relativeName={hostFirst}
                    othersInHome={view?.members.map(m => m.name).filter(Boolean) ?? []}
                    excludeIds={view?.members.map(m => m.profileId) ?? []}
                    onDone={() => setAdding(null)}
                />
            );
        }
        return <AddMemberButton onClick={() => setAdding(key)} />;
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
            toast.success(fill(t('adopter.hh_gift_created'), { name }));
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
        <div className="space-y-3" data-testid="household-section">
            {nothing && !canAdd && !hasLegacyText && <p className="text-sm text-stone-500 italic">{t('adopter.no_family')}</p>}

            {titled ? homes.map(view => {
                const others = view.members.map(m => m.name).filter(Boolean);
                const selfLabel = labelOf(view.self.label);
                const sub = [
                    selfLabel ? fill(t('adopter.hh_self_as'), { name: hostFirst, rel: selfLabel.charAt(0).toLowerCase() + selfLabel.slice(1) }) : null,
                    view.self.addedByName ? fill(t('adopter.hh_lives_with_by'), { name: view.self.addedByName }) : null,
                ].filter(Boolean).join(' · ');
                return (
                    <HomeBlock key={view.id} title={fill(t('adopter.hh_home_title'), { names: joinNames(t, others) })} sub={sub}>
                        {memberCards(view)}
                        {addArea(view)}
                    </HomeBlock>
                );
            }) : homes.map(view => <div key={view.id} className="space-y-3" data-household-id={view.id}>{memberCards(view)}</div>)}

            {gifts.map(view => {
                const recipient = view.members.find(m => m.giftRecipient);
                if (!recipient) return null;
                const recipientFirst = firstName(recipient.name) || recipient.name;
                return (
                    <GiftShell key={view.id} testId="household-gift" title={t('adopter.hh_gift_title')}
                        body={fill(t('adopter.hh_gift_body'), { giver: giverFirst, recipient: recipientFirst })}>
                        {memberCards(view, true)}
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

            {/* One home (or none yet): its add button sits under its people. Several: each block has its own. */}
            {!titled && addArea(homes[0] ?? null)}
        </div>
    );
}
