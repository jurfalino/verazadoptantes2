'use client';

/**
 * A household member's live summary (D46, households as profiles): rating and
 * alerts first («★2 · 1 alerta»), then «3 adopciones · 5 registros», then
 * «Perfil cargado por …», then the contacts exactly as the server masked them
 * for this viewer (a locked one shows the partial value with a padlock, as on
 * the profile). A minor shows none of the rating / activity lines — a minor
 * carries no rating, alerts or records (the card's name row has the tag).
 *
 * A signed-in viewer adds a contact here (D55): it is saved on THAT person's
 * profile through `addContactEntry` — stored once, same rules as on that
 * profile — and the summary refreshes in place. The name above the summary is
 * the link to the profile (no «Ver perfil completo» row any more).
 *
 * Also used by «¿Es este perfil?» in the add form, with the contact that
 * matched what was typed marked «coincide».
 */
import { type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, Mail, AtSign, IdCard, MapPin, Lock, Check } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { RatingBadge } from '@/components/RatingBadge';
import { SocialLogo } from '@/components/SocialLogo';
import { handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { CONTACT_ENTRIES_FULL, type ContactEntry, type ContactEntryType } from '@/lib/contactEntries';
import type { LinkedSummary } from '@/domain/householdLinks';
import { addContactEntry } from '@/app/actions';
import { ContactComposer, draftPlatform, type ComposerDraft } from '@/components/ContactComposer';
import { fill } from '@/lib/householdCopy';

const ICON: Partial<Record<ContactEntryType, typeof Phone>> = { phone: Phone, email: Mail, social: AtSign, id: IdCard, address: MapPin };

/** One contact as the viewer may see it — a masked one with the profile's padlock. */
export function SummaryContactRow({ c, trailing }: { c: ContactEntry; trailing?: ReactNode }) {
    const { t } = useLanguage();
    const branded = c.type === 'social' && c.platform && c.platform !== 'other' && !c.masked;
    const Icon = ICON[c.type] ?? AtSign;
    return (
        // A trailing pill may wrap under the value: the profile grid's column is
        // auto-sized, so an unwrappable row would widen the whole household at 390.
        <li className={`flex items-center gap-2 text-sm min-w-0 ${trailing ? 'flex-wrap gap-y-1' : ''}`}>
            {branded ? <SocialLogo platform={c.platform!} size={16} className="shrink-0" /> : <Icon className="w-4 h-4 shrink-0 text-teal-600" aria-hidden="true" />}
            <span className="w-20 shrink-0 text-stone-500 text-xs">{branded ? '' : t(`adopter.ce_type_${c.type}`)}</span>
            {c.masked ? (
                <span className="flex-1 min-w-0 inline-flex items-center gap-1.5 text-stone-500" aria-label={`${t(`adopter.ce_type_${c.type}`)}: ${t('adopter.ce_masked')}`}>
                    <Lock className="w-3 h-3 opacity-60 shrink-0" aria-hidden="true" />
                    <span className="truncate select-none">{c.value}</span>
                </span>
            ) : (
                <span className={`${trailing ? '' : 'flex-1'} min-w-0 truncate text-stone-800`}>{c.value}</span>
            )}
            {trailing}
        </li>
    );
}

/** The «coincide» pill on the contact that matched what was typed. */
export function MatchesPill() {
    const { t } = useLanguage();
    return (
        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-800" data-testid="contact-matches">
            <Check className="w-3 h-3" aria-hidden="true" />{t('adopter.hh_candidate_matches')}
        </span>
    );
}

export function LinkedProfileSummary({ summary, testId = 'linked-summary', canAddContact = false, minor = false, isMatch }: {
    summary: LinkedSummary;
    testId?: string;
    /** Signed in: «Agregar dato de contacto» adds to this person's own profile (D55). */
    canAddContact?: boolean;
    /** «Menor de edad»: no rating / alerts / activity lines. */
    minor?: boolean;
    /** «¿Es este perfil?»: true for the contact that matched what was typed («coincide»). */
    isMatch?: (c: ContactEntry) => boolean;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const count = (n: number, one: string, many: string) => (n === 1 ? t(one) : fill(t(many), { n }));
    const anyLocked = summary.contacts.some(c => c.masked);

    /** Saves on the person's profile; true closes the composer, false keeps what was typed. */
    async function addToProfile(d: ComposerDraft): Promise<boolean> {
        const platform = draftPlatform(d);
        try {
            const res = await addContactEntry({
                adopterId: summary.profileId, type: d.type, value: d.value,
                ...(platform ? { platform } : {}), ...(d.type === 'phone' && d.apps.length ? { apps: d.apps } : {}),
            });
            if (!res.ok) {
                toast.error(t('errors.generic'), res.error === 'busy' ? t('collab.busy') : res.error === CONTACT_ENTRIES_FULL ? t('adopter.ce_add_full') : t('adopter.ce_add_error'),
                    'errorId' in res ? res.errorId : resolveErrorId(new Error(`addContactEntry (household member): ${res.error}`), 'LinkedProfileSummary'));
                return false;
            }
            // As on the profile itself (ContactEntriesSection): say when an access request was filed for them.
            if (res.status === 'appended') toast.success('✓', t(res.autoRequestFiled ? 'adopter.ce_add_toast_added_with_request' : 'adopter.ce_add_toast_added'));
            // Nothing was added: say why instead of closing silently.
            else if (res.status === 'unlocked_existing') toast.info(t('adopter.hh_contact_already_there_unlocked'));
            else toast.info(t('adopter.hh_contact_already_there'));
            router.refresh();
            return true;
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('adopter.ce_add_error'), resolveErrorId(e, 'LinkedProfileSummary'));
            return false;
        }
    }

    return (
        <div className="min-w-0" data-testid={testId} aria-label={fill(t('adopter.hh_link_summary_aria'), { name: summary.name })}>
            <div className="mt-2 space-y-0.5">
                {!minor && (
                    <>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                            {summary.rating != null && summary.rating >= 1
                                ? <RatingBadge rating={summary.rating} variant="inline" size="md" />
                                : <span className="text-stone-500">{t('adopter.hh_link_unrated')}</span>}
                            <span className="text-stone-400" aria-hidden="true">·</span>
                            {summary.openAlerts > 0
                                ? <span className="font-semibold text-rose-700">{count(summary.openAlerts, 'adopter.hh_link_alerts_one', 'adopter.hh_link_alerts_many')}</span>
                                : <span className="text-stone-500">{t('adopter.hh_link_no_alerts')}</span>}
                        </div>
                        <div className="text-xs text-stone-600">
                            {count(summary.adoptions, 'adopter.hh_link_adoptions_one', 'adopter.hh_link_adoptions_many')}
                            {' · '}
                            {count(summary.records, 'adopter.hh_link_records_one', 'adopter.hh_link_records_many')}
                        </div>
                    </>
                )}
                {summary.ownerName && (
                    <div className="text-xs text-stone-500 break-words">{fill(t('adopter.hh_link_owner'), { name: summary.ownerName })}</div>
                )}
            </div>
            {(summary.contacts.length > 0 || canAddContact) && (
                <div className="mt-3 pt-3 border-t border-dashed border-stone-200">
                    {summary.contacts.length > 0 && (
                        <ul className="space-y-1.5 mb-2">
                            {summary.contacts.map((c, i) => (
                                <SummaryContactRow key={`${c.id ?? c.type}-${i}`} c={c} trailing={isMatch?.(c) ? <MatchesPill /> : undefined} />
                            ))}
                            {summary.moreContacts > 0 && (
                                <li className="text-xs text-stone-500">{fill(t('adopter.hh_link_more_contacts'), { n: summary.moreContacts })}</li>
                            )}
                        </ul>
                    )}
                    {anyLocked && <p className="text-xs text-stone-500 mb-2">{t('adopter.hh_link_locked_note')}</p>}
                    {canAddContact && (
                        <ContactComposer onSubmit={addToProfile} triggerTestId="linked-add-contact" testIdPrefix="linked-contact" />
                    )}
                </div>
            )}
        </div>
    );
}
