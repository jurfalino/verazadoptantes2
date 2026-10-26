'use client';

/**
 * Linked convivientes (spec 2026-10-25 pendientes D, D46, D48).
 *
 * `LinkedProfileSummary`: the live summary of a profile linked through a
 * household — rating and alerts first («★2 · 1 alerta»), then «3 adopciones ·
 * 5 registros», then the contacts exactly as the server masked them for this
 * viewer (a locked one shows the partial value with a padlock, as on the
 * profile), then «Ver perfil completo ↗» in a new tab. A signed-in viewer
 * adds a contact there (D55): it is saved on the LINKED profile through
 * `addContactEntry` — stored once, same rules as on that profile — and the
 * summary refreshes in place.
 *
 * `LivesWithSection`: the linked profile's «Convive con» rows (the host, the
 * same summary, «según {creator}»).
 *
 * `NotLivingTogetherButton`: «No convive» (D48) for the linked profile's team
 * or an admin — on «Convive con» and on the host's household card. It removes
 * the member from the host and the link, on both profiles, for everyone.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, Mail, AtSign, IdCard, MapPin, Lock, ExternalLink, Home } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { RatingBadge } from '@/components/RatingBadge';
import { SocialLogo } from '@/components/SocialLogo';
import { handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import type { ContactEntryType } from '@/lib/contactEntries';
import type { LinkedSummary, LivesWithRow } from '@/domain/householdLinks';
import { reportNotLivingTogether, addContactEntry } from '@/app/actions';
import { ContactComposer, draftPlatform, type ComposerDraft } from '@/components/ContactComposer';

const ICON: Partial<Record<ContactEntryType, typeof Phone>> = { phone: Phone, email: Mail, social: AtSign, id: IdCard, address: MapPin };

const fill = (s: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

export function LinkedProfileSummary({ summary, testId = 'linked-summary', canAddContact = false }: {
    summary: LinkedSummary;
    testId?: string;
    /** Signed in: «Agregar dato de contacto» adds to this linked profile (D55). */
    canAddContact?: boolean;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const count = (n: number, one: string, many: string) => (n === 1 ? t(one) : fill(t(many), { n }));
    const anyLocked = summary.contacts.some(c => c.masked);

    /** Saves on the linked profile; true closes the composer, false keeps what was typed. */
    async function addToLinkedProfile(d: ComposerDraft): Promise<boolean> {
        const platform = draftPlatform(d);
        try {
            const res = await addContactEntry({
                adopterId: summary.profileId, type: d.type, value: d.value,
                ...(platform ? { platform } : {}), ...(d.type === 'phone' && d.apps.length ? { apps: d.apps } : {}),
            });
            if (!res.ok) {
                toast.error(t('errors.generic'), res.error === 'busy' ? t('collab.busy') : t('adopter.ce_add_error'),
                    'errorId' in res ? res.errorId : resolveErrorId(new Error(`addContactEntry (linked): ${res.error}`), 'LinkedProfileSummary'));
                return false;
            }
            // As on the profile itself (ContactEntriesSection): say when an access request was filed for them.
            if (res.status === 'appended') toast.success('✓', t(res.autoRequestFiled ? 'adopter.ce_add_toast_added_with_request' : 'adopter.ce_add_toast_added'));
            else if (res.status === 'unlocked_existing') toast.success('✓', t('adopter.ce_add_toast_unlocked'));
            router.refresh();
            return true;
        } catch (e) {
            toast.error(t('errors.generic'), t('adopter.ce_add_error'), resolveErrorId(e, 'LinkedProfileSummary'));
            return false;
        }
    }

    return (
        <div
            className="mt-2.5 rounded-lg border border-stone-200 bg-white p-3 space-y-1.5 min-w-0"
            data-testid={testId}
            aria-label={fill(t('adopter.hh_link_summary_aria'), { name: summary.name })}
        >
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
            {summary.ownerName && (
                <div className="text-xs text-stone-500 break-words">{fill(t('adopter.hh_link_owner'), { name: summary.ownerName })}</div>
            )}
            {summary.contacts.length > 0 ? (
                <ul className="space-y-1 pt-1">
                    {summary.contacts.map((c, i) => {
                        const branded = c.type === 'social' && c.platform && c.platform !== 'other' && !c.masked;
                        const Icon = ICON[c.type] ?? AtSign;
                        return (
                            <li key={`${c.id ?? c.type}-${i}`} className="flex items-center gap-2 text-sm min-w-0">
                                {branded ? <SocialLogo platform={c.platform!} size={16} className="shrink-0" /> : <Icon className="w-4 h-4 shrink-0 text-teal-600" aria-hidden="true" />}
                                {c.masked ? (
                                    <span className="flex items-center gap-1.5 min-w-0 text-stone-500" aria-label={`${t(`adopter.ce_type_${c.type}`)}: ${t('adopter.ce_masked')}`}>
                                        <Lock className="w-3 h-3 shrink-0 opacity-60" aria-hidden="true" />
                                        <span className="truncate select-none">{c.value}</span>
                                    </span>
                                ) : (
                                    <span className="truncate text-stone-800">{c.value}</span>
                                )}
                            </li>
                        );
                    })}
                    {summary.moreContacts > 0 && (
                        <li className="text-xs text-stone-500">{fill(t('adopter.hh_link_more_contacts'), { n: summary.moreContacts })}</li>
                    )}
                </ul>
            ) : (
                <div className="text-xs italic text-stone-500 pt-1">{t('adopter.hh_link_no_contacts')}</div>
            )}
            {anyLocked && <p className="text-xs text-stone-500">{t('adopter.hh_link_locked_note')}</p>}
            {canAddContact && (
                <ContactComposer
                    onSubmit={addToLinkedProfile}
                    note={fill(t('adopter.hh_link_adds_to'), { name: summary.name || t('adopter.nameless') })}
                    triggerTestId="linked-add-contact"
                    testIdPrefix="linked-contact"
                />
            )}
            <a
                href={`/adopter/${encodeURIComponent(summary.profileId)}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`${testId}-open`}
                className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-teal-700 hover:underline"
            >
                {t('adopter.hh_link_view_full')}
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
        </div>
    );
}

/**
 * «No convive» (D48) for one link, with its confirmation. Shown only when the
 * server says the viewer may (`canReportNotLiving`: the linked profile's team
 * or an admin), on the linked profile's «Convive con» row and on the host's
 * household card. It changes BOTH profiles — the member leaves the host's
 * household and the link goes — so the dialog says so, and that the host's
 * owner is told. The page refreshes after, so both blocks read the new fact.
 */
export function NotLivingTogetherButton({ linkId, personName, hostName, className = '' }: {
    linkId: string;
    /** Who is said not to live there (the linked profile / the member). */
    personName: string;
    /** The profile whose household lists them. */
    hostName: string;
    className?: string;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const names = { person: personName || t('adopter.nameless'), host: hostName || t('adopter.nameless') };

    async function report() {
        setBusy(true);
        try {
            const res = await reportNotLivingTogether(linkId);
            if (res.success) {
                toast.success(t('adopter.hh_not_living_done'));
            } else if (res.error === 'not_found') {
                // Someone already corrected it (or the household changed): show what is true now.
                toast.success(t('common.updated') || 'Actualizado', t('adopter.hh_not_living_stale'));
            } else {
                toast.error(t('errors.generic') || 'Error', t('adopter.hh_not_living_failed'),
                    res.errorId ?? resolveErrorId(new Error(`reportNotLivingTogether: ${res.error}`), 'NotLivingTogetherButton'));
                return;
            }
            router.refresh();
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', t('adopter.hh_not_living_failed'), resolveErrorId(e, 'NotLivingTogetherButton'));
        } finally {
            setBusy(false);
            setOpen(false);
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={busy}
                data-testid="hh-not-living-together"
                className={`inline-flex min-h-[44px] items-center px-3.5 text-sm font-semibold rounded-md border border-stone-200 bg-white text-stone-800 hover:bg-teal-50 disabled:opacity-50 ${className}`}
            >
                {t('adopter.hh_not_living')}
            </button>
            {/* ConfirmDialog renders itself on <body>, out of the profile form's stacking context. */}
            <ConfirmDialog
                open={open}
                busy={busy}
                title={fill(t('adopter.hh_not_living_title'), names)}
                message={fill(t('adopter.hh_not_living_note'), names)}
                confirmLabel={t('adopter.hh_not_living_confirm')}
                onConfirm={() => { void report(); }}
                onCancel={() => setOpen(false)}
            />
        </>
    );
}

/** The linked profile's «Convive con» rows. `personName`: this profile's name, for the «No convive» dialog. */
export function LivesWithSection({ rows, personName, canAddContact = false }: { rows: LivesWithRow[]; personName: string; canAddContact?: boolean }) {
    const { t } = useLanguage();
    if (rows.length === 0) return null;

    return (
        <div className="space-y-3" data-testid="lives-with">
            {rows.map(row => (
                <div key={row.linkId} className="border border-stone-200 rounded-xl p-3.5 bg-stone-50" data-testid="lives-with-row">
                    <div className="flex items-start gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0"><Home className="w-4 h-4" aria-hidden="true" /></div>
                        <div className="min-w-0 flex-1">
                            <div className="font-semibold text-[15px] text-stone-900 break-words">
                                <span className="text-stone-500 font-normal">{t('adopter.hh_lives_with_title')}: </span>
                                <a href={`/adopter/${encodeURIComponent(row.profileId)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 align-middle text-teal-700 hover:underline">
                                    {row.name} <span aria-hidden="true">↗</span>
                                </a>
                            </div>
                            {row.creatorName && <div className="text-xs text-stone-500 break-words">{fill(t('adopter.hh_lives_with_by'), { name: row.creatorName })}</div>}
                        </div>
                    </div>
                    <LinkedProfileSummary summary={row} testId="lives-with-summary" canAddContact={canAddContact} />
                    {row.canReportNotLiving && (
                        <NotLivingTogetherButton linkId={row.linkId} personName={personName} hostName={row.name} className="mt-2.5" />
                    )}
                </div>
            ))}
        </div>
    );
}
