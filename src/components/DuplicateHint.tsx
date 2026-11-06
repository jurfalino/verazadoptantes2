'use client';

/**
 * «Ya está en otro perfil» — the composer's inline duplicate hint (option B,
 * Jon 2026-10-29; prototype proto-shots/dato-coincide.html, column B).
 *
 * Fires when the user types a strong identifier (phone / email / social / id)
 * that other profiles already carry. Two parts:
 *
 * - The inline box (`DupHintBox`): compact, attached to the field, in the
 *   warning tone. One row per match (≤3): the name (plain text), their rating
 *   (RatingBadge, «Sin calificación» when unrated) and «Ver perfil». No
 *   household line here or in the window (Jon 2026-10-31: «we don't want it
 *   there»). The contact just typed is NOT repeated (it is in the field).
 * - «Ver perfil» opens a window over the page (the shared Modal), so whatever
 *   is being typed stays. Its body (`DupHintProfile`) is the match card's:
 *   MatchCardHeader, their contacts as «¿Es este perfil?» shows them (masked by
 *   the server, the one typed marked «coincide»), their activity, then what
 *   the server decided this viewer may do (`match.action`, Jon 2026-10-29,
 *   prototype proto-shots/dato-coincide-v3.html — decideDupHintAction):
 *     - 'continue' (the viewer or their team loaded the profile being edited,
 *       or an admin): «Unir con este perfil» → the shared confirmation
 *       in its absorb mode (ContinueMergeDialog: «¿Unir el perfil de … con el
 *       de …?», what it adds, the rating after, who is told — UX C1) →
 *       continueWithMatchedProfile, then the profile that
 *       stayed opens with «Listo: el perfil de … se unió a este».
 *     - 'flag' (someone else loaded it, or the match has no owner):
 *       «Marcar como posible duplicado» (flagAdopterAsDuplicate — the owners
 *       and the admins are told) and «Abrir perfil ↗».
 *     - 'review_admins' (they already said no): «Pedir revisión a un
 *       administrador» (askAdminsToReviewPair, the «Pendientes» dispute).
 *     - 'pending' (already up for review): only said.
 *     - 'settled' (already recorded as two people: a shared home, «Mantener
 *       separados», «Viven juntos»): «Ya figuran como personas distintas.»
 *   Always: «No es esta persona» → closes the window, drops that row, and saves the
 *   answer (answerNotSamePerson — the consistency rule, 2026-11-06): settled when the
 *   viewer loaded either profile, else opened for the owners, who are named in a toast;
 *   «Abrir perfil ↗» (OpenProfileLink) → writes the search-match grant
 *   (grantSearchMatchAccess) so the new tab renders unmasked, then opens it.
 *
 * Data: getDuplicateHintMatches — the same detection the hint always ran,
 * enriched on the server into the «¿Es este perfil?» card data and the window's answer.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, CheckCircle2, Flag, ShieldQuestion } from 'lucide-react';
import { getDuplicateHintMatches, grantSearchMatchAccess, flagAdopterAsDuplicate, countAdoptersBySocialHandle, continueWithMatchedProfile, askAdminsToReviewPair } from '@/app/actions';
import type { DupHintMatch } from '@/app/actions/households';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { answerNotSamePerson } from '@/app/actions/notSamePerson';
import { trackSamePersonAnswer } from '@/lib/samePersonEvents';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { RatingBadge } from '@/components/RatingBadge';
import { MatchCardHeader } from '@/components/MatchCardParts';
import { PersonActivity } from '@/components/PersonStanding';
import { MatchesPill } from '@/components/LinkedProfileSummary';
import { ContactRow } from '@/components/ContactRow';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { deserializeContactEntries, type ContactEntryType } from '@/lib/contactEntries';
import { SUMMARY_CONTACT_TYPES, MAX_SUMMARY_CONTACTS } from '@/domain/householdLinks';
import { openAlertKinds } from '@/domain/flags';
import { NO_DISMISSED, dismissDupHintMatch, isDupHintType, visibleDupHintMatches, type DupHintDismissed } from '@/domain/dupHint';
import { CONTACT_ENTRIES_FULL } from '@/lib/contactEntries';
import { joinNames } from '@/lib/householdCopy';
import { ContinueMergeDialog } from '@/components/ContinueMergeDialog';
import { OpenProfileLink } from '@/components/OpenProfileLink';
import { SocialPlatformPicker } from '@/components/SocialPlatformPicker';
import type { SocialPlatform } from '@/lib/contactEntries';
import { rememberContinued } from '@/components/ContinuedProfileBanner';

interface Props {
    /** Strong identifier type the user just typed. Address/alias/other are no-op. */
    type: ContactEntryType;
    /** The typed value. Empty string clears the hint. Whitespace is ignored. */
    value: string;
    /** The profile being edited: never a match, and every answer in the window needs it. */
    excludeAdopterId?: string;
    /** The network picked for a social handle: saved with the value on «Continuar». */
    platform?: string;
    /** WhatsApp / Telegram picked for a phone: saved with the value on «Continuar». */
    apps?: string[];
    /** A handle with no network picked: «Continuar» asks for it, as the composer's Save does. */
    needsPlatform?: boolean;
    /** Picks the network from inside the window — the composer's own setter, so both agree (UX I6). */
    onPickPlatform?: (p: SocialPlatform) => void;
    /** «Continuar» saved the typed value but the merge failed: the composer clears it (it is saved). */
    onTypedSaved?: () => void;
    className?: string;
}

/** What a row says once answered: «✓ Marcado» / «✓ Enviado a los administradores». */
export type DupHintDone = 'flagged' | 'sent';

// A social handle on more than this many records is almost certainly a shared /
// rescuer contact mis-entered on adopters, not a real duplicate (dedup spec §4).
const SHARED_HANDLE_WARN = 8;

const WARNING_BOX = { background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)' } as const;

const matchName = (m: DupHintMatch, nameless: string) => m.adopter?.name?.trim() || m.adopterName?.trim() || nameless;

/** The inline box: header + one compact row per match. Presentational. */
export function DupHintBox({ matches, done, onView, className = '' }: {
    matches: readonly DupHintMatch[];
    done: ReadonlyMap<string, DupHintDone>;
    onView: (adopterId: string) => void;
    className?: string;
}) {
    const { t } = useLanguage();
    if (matches.length === 0) return null;
    const header = matches.length === 1
        ? t('adopter.dup_hint_header_one')
        : t('adopter.dup_hint_header_many').replace('{n}', String(matches.length));
    return (
        <div className={`rounded-lg border text-[13px] ${className}`} style={WARNING_BOX} role="note" data-testid="dup-hint">
            <p className="flex items-center gap-1.5 px-3 pt-2 pb-1 font-semibold" style={{ color: 'var(--status-warning-text)' }} data-testid="dup-hint-header">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {header}
            </p>
            <ul>
                {matches.map((m, i) => (
                    <li key={m.adopterId} className={`flex items-center gap-2 pl-3 pr-2 py-1.5 ${i > 0 ? 'border-t' : ''}`}
                        style={i > 0 ? { borderColor: 'var(--status-warning-border)' } : undefined}
                        data-testid="dup-hint-row" data-adopter-id={m.adopterId}>
                        <div className="min-w-0 flex-1">
                            <div className="font-semibold [overflow-wrap:anywhere]" style={{ color: 'var(--text-primary)' }} data-testid="dup-hint-name">
                                {matchName(m, t('adopter.nameless'))}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-1"><RatingBadge rating={m.rating ?? m.avgRating} /></div>
                        </div>
                        {done.has(m.adopterId) ? (
                            <span className="shrink-0 inline-flex items-center gap-1 min-h-[44px] pr-1 text-[13px] font-semibold text-right" style={{ color: 'var(--accent)' }}
                                data-testid={done.get(m.adopterId) === 'sent' ? 'dup-hint-sent' : 'dup-hint-flagged'}>
                                <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                                {done.get(m.adopterId) === 'sent' ? t('adopter.dup_hint_review_sent') : t('adopter.dup_hint_flagged')}
                            </span>
                        ) : (
                            <Button type="button" variant="secondary" size="compact" layoutClassName="shrink-0" onClick={() => onView(m.adopterId)} data-testid="dup-hint-view">
                                {t('adopter.dup_action_view')}
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** The window's body: the match card + the answers the server decided (`match.action`). Presentational. */
export function DupHintProfile({ match, canAct, needsPlatform = false, platform = null, onPickPlatform, platformAsk = false, busy = null, onContinue, onFlag, onReview, onNotThis, onOpenFull }: {
    match: DupHintMatch;
    /** A saved profile is being edited: the window's answer (continue / flag / review) can be given. */
    canAct: boolean;
    /** The typed handle has no network yet: «Continuar» waits for it (the composer's «¿Qué red social es?» *). */
    needsPlatform?: boolean;
    /** The network picked so far, and how to pick it here: the composer's chips, in the window (UX I6). */
    platform?: SocialPlatform | null;
    onPickPlatform?: (p: SocialPlatform) => void;
    /** The network was picked in this window: the chips stay, showing the pick. */
    platformAsk?: boolean;
    /** Which answer is running (its button spins; all are disabled). */
    /** 'checking': a re-check is running (a network picked in the window), so nothing can be pressed on stale data. */
    busy?: 'flag' | 'review' | 'open' | 'checking' | null;
    onContinue: () => void;
    onFlag: () => void;
    onReview: () => void;
    onNotThis: () => void;
    onOpenFull: () => void;
}) {
    const { t } = useLanguage();
    const name = matchName(match, t('adopter.nameless'));
    const matched = new Set(match.matchedEntryIndexes ?? []);
    const shown = deserializeContactEntries(match.adopter?.contactEntries ?? null)
        .map((entry, index) => ({ entry, matched: matched.has(index) }))
        .filter(c => SUMMARY_CONTACT_TYPES.includes(c.entry.type))
        .slice(0, MAX_SUMMARY_CONTACTS);
    const disabled = !!busy;
    const action = canAct ? match.action : null;
    const note = (text: string, testId: string) => (
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }} data-testid={testId}>{text}</p>
    );
    const notThis = (
        <Button type="button" variant="secondary" fullWidth onClick={onNotThis} disabled={disabled} data-testid="dup-hint-not-this">
            {t('formResults.not_this_person')}
        </Button>
    );
    // «Abrir perfil ↗»: the same new-tab link on every surface and for every role (point B, Jon 2026-11-01).
    const openLink = <OpenProfileLink onClick={onOpenFull} disabled={disabled} loading={busy === 'open'} testId="dup-hint-open-full" className="self-center" />;
    return (
        <div className="space-y-3 min-w-0" data-testid="dup-hint-profile" data-action={action ?? 'none'}>
            <MatchCardHeader
                person={{
                    id: match.adopterId, name,
                    rating: match.rating ?? match.avgRating,
                    openAlerts: match.openAlerts ?? openAlertKinds(match.flags),
                    isMinor: !!match.isMinor,
                }}
                thumbnail={match.thumbnail}
                newTab
                testId="dup-hint-window-head"
            />
            {shown.length > 0 && (
                <ul className="pt-3 border-t border-dashed border-stone-200 space-y-1.5">
                    {shown.map((c, i) => (
                        <ContactRow key={`${c.entry.id ?? c.entry.type}-${i}`} entry={c.entry} testId="dup-hint-contact" trailing={c.matched ? <MatchesPill /> : undefined} />
                    ))}
                </ul>
            )}
            {/* Standalone here (every other card writes it after the name): «Sin actividad», capitalised. */}
            {match.activity && <div className="first-letter:uppercase"><PersonActivity activity={match.activity} testId="dup-hint-activity" /></div>}
            <div className="flex flex-col gap-2 pt-1">
                {action === 'continue' && (
                    <>
                        {match.alreadyPending && note(t('adopter.dup_hint_pending'), 'dup-hint-pending-note')}
                        {(needsPlatform || platformAsk) && (
                            // The composer's own ask and its own chips, here (UX I6): they sat behind the window,
                            // so «Continuar» stayed off with no way to pick. Picking one enables it.
                            <div data-testid="dup-hint-needs-platform">
                                <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                                    {t('adopter.ce_social_which')}{needsPlatform && <span style={{ color: 'var(--status-error-text)' }}> *</span>}
                                </p>
                                {onPickPlatform && <SocialPlatformPicker value={platform} locked={false} onChange={onPickPlatform} />}
                            </div>
                        )}
                        <Button type="button" fullWidth onClick={onContinue} disabled={disabled || needsPlatform} data-testid="dup-hint-continue"
                            icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}>
                            {t('adopter.dup_action_join_with_existing')}
                        </Button>
                        {notThis}
                        {openLink}
                    </>
                )}
                {action === 'flag' && (
                    <>
                        {/* Names the profile being edited (UX I5): under the match card it read as being about the match. */}
                        {match.cantJoin && note(t(match.cantJoin === 'no_owner' ? 'adopter.dup_hint_cant_join_no_owner' : 'adopter.dup_hint_cant_join').replace('{name}', match.cantJoinName || t('adopter.nameless')), 'dup-hint-cant-join')}
                        {match.saidNo ? (
                            // Someone already said they are two people and this viewer can't ask the admins:
                            // said, no flag (the server refuses one, with the same reason).
                            note(t('adopter.dup_hint_said_no'), 'dup-hint-said-no')
                        ) : (
                            <>
                                <Button type="button" fullWidth onClick={onFlag} disabled={disabled} loading={busy === 'flag'} data-testid="dup-hint-flag"
                                    icon={<Flag className="w-4 h-4" aria-hidden="true" />}>
                                    {t('adopter.dup_hint_flag_action')}
                                </Button>
                                <p className="-mt-1 text-center text-xs" style={{ color: 'var(--text-muted)' }} data-testid="dup-hint-flag-told">{t('adopter.dup_hint_flag_told')}</p>
                            </>
                        )}
                        {notThis}
                        {/* The same «Abrir perfil ↗» the owner sees, not a big button (point B). */}
                        <OpenProfileLink onClick={onOpenFull} disabled={disabled} loading={busy === 'open'} testId="dup-hint-open-to-add" className="self-center" />
                    </>
                )}
                {action === 'review_admins' && (
                    <>
                        {note(t('adopter.dup_hint_said_no'), 'dup-hint-said-no')}
                        <Button type="button" fullWidth onClick={onReview} disabled={disabled} loading={busy === 'review'} data-testid="dup-hint-review"
                            icon={<ShieldQuestion className="w-4 h-4" aria-hidden="true" />}>
                            {t('myAdopters.pending_d_action_dispute')}
                        </Button>
                        {notThis}
                        {openLink}
                    </>
                )}
                {action === 'settled' && (
                    <>
                        {note(t('adopter.dup_hint_settled'), 'dup-hint-settled')}
                        {notThis}
                        {openLink}
                    </>
                )}
                {action === 'pending' && (
                    <>
                        {note(t('adopter.dup_hint_pending'), 'dup-hint-pending-note')}
                        {notThis}
                        {openLink}
                    </>
                )}
                {action === null && (
                    <>
                        {notThis}
                        {openLink}
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * «Unir con este perfil»'s confirmation: the shared dialog in its absorb mode (UX C1) — the profile being
 * edited stops existing, said in its title and first line — with the rating after and who is told.
 */
export function DupHintContinueDialog({ match, busy, failure, onCancel, onConfirm }: {
    match: DupHintMatch;
    busy: boolean;
    /** Shown under the preview when «Sí, continuar» failed (already in words, with its id). */
    failure: string | null;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const { t } = useLanguage();
    const told = match.toldNames ?? [];
    const currentName = match.preview?.currentName?.trim() ?? '';
    const toldLine = told.length === 0 ? null
        : told.length === 1 ? t('adopter.dup_hint_confirm_told_one').replace('{name}', told[0])
            : t('adopter.dup_hint_confirm_told_many').replace('{names}', joinNames(t, told));
    return (
        <ContinueMergeDialog
            absorb={{ currentName: currentName || t('adopter.nameless') }}
            name={matchName(match, t('adopter.nameless'))}
            newContacts={match.preview?.newContacts ?? []}
            records={match.preview?.records ?? 0}
            busy={busy}
            onCancel={onCancel}
            onConfirm={onConfirm}
            testId="dup-hint-confirm"
            confirmTestId="dup-hint-confirm-yes"
        >
            <p className="flex flex-wrap items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }} data-testid="dup-hint-rating-after">
                {t('adopter.dup_hint_rating_after')} <RatingBadge rating={match.preview?.ratingAfter ?? null} />
            </p>
            {/* «deja de existir» is the dialog's first line (absorb mode); only who is told stays here. */}
            {toldLine && <p className="text-xs [overflow-wrap:anywhere]" style={{ color: 'var(--text-muted)' }} data-testid="dup-hint-confirm-told">{toldLine}</p>}
            {failure && <p role="alert" className="text-sm font-medium [overflow-wrap:anywhere]" style={{ color: 'var(--status-error-text)' }} data-testid="dup-hint-confirm-failed">{failure}</p>}
        </ContinueMergeDialog>
    );
}

export default function DuplicateHint({ type, value, excludeAdopterId, platform, apps, needsPlatform = false, onPickPlatform, onTypedSaved, className }: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [matches, setMatches] = useState<DupHintMatch[]>([]);
    const [handleCount, setHandleCount] = useState(0);
    const [loading, setLoading] = useState(false);
    // The check itself failed: said on the spot with its id, never shown as «no matches».
    const [failedId, setFailedId] = useState<string | null>(null);
    // «No es esta persona», for the value it was answered on.
    const [dismissed, setDismissed] = useState<DupHintDismissed>(NO_DISMISSED);
    const [openId, setOpenIdState] = useState<string | null>(null);
    const [busy, setBusy] = useState<'flag' | 'review' | 'open' | null>(null);
    // The network was picked inside the window: its chips stay on screen until the window closes.
    const [pickedInWindow, setPickedInWindow] = useState(false);
    // Opening or closing the window starts its network ask afresh.
    const setOpenId = (adopterId: string | null) => { setOpenIdState(adopterId); setPickedInWindow(false); };
    // «Unir con este perfil» → its confirmation (the match id), and a failure said in it.
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [continuing, setContinuing] = useState(false);
    const [continueFailure, setContinueFailure] = useState<string | null>(null);
    // Rows answered here: no second flag / request on a double tap, and «✓ …» without a reload.
    const [done, setDone] = useState<ReadonlyMap<string, DupHintDone>>(new Map());
    const markDone = (adopterId: string, what: DupHintDone) => setDone(prev => new Map(prev).set(adopterId, what));
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        // Cancel any in-flight request from a previous value.
        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }

        const v = value.trim();
        setFailedId(null);
        if (!v || !isDupHintType(type)) {
            setMatches([]);
            setHandleCount(0);
            setLoading(false);
            return;
        }

        const ctl = new AbortController();
        abortRef.current = ctl;
        setLoading(true);

        (async () => {
            try {
                const res = await getDuplicateHintMatches({ type, value: v, excludeAdopterId, ...(type === 'social' && platform ? { platform } : {}) });
                if (ctl.signal.aborted) return;
                // A failed check is logged on the server (errorId); the hint is advisory, so the composer carries on.
                if (res.failed) {
                    console.warn('[DuplicateHint] getDuplicateHintMatches failed', { type, excludeAdopterId, errorId: res.errorId });
                    setFailedId(res.errorId ?? resolveErrorId(new Error('getDuplicateHintMatches failed'), 'DuplicateHint.lookup'));
                }
                setMatches(res.results ?? []);
                // For socials, also learn how many records share this handle so a
                // shared/rescuer contact can be surfaced differently (see below).
                if (type === 'social') {
                    const c = await countAdoptersBySocialHandle(v);
                    if (!ctl.signal.aborted) setHandleCount(c);
                } else if (!ctl.signal.aborted) {
                    setHandleCount(0);
                }
            } catch (e) {
                if (ctl.signal.aborted) return;
                setMatches([]);
                // An old tab: the «nueva versión» notice says it; no second message here.
                if (!handledAsStale(e)) setFailedId(resolveErrorId(e, 'DuplicateHint.lookup'));
            } finally {
                if (!ctl.signal.aborted) setLoading(false);
            }
        })();

        return () => {
            ctl.abort();
        };
    }, [type, value, excludeAdopterId, platform]);

    // After a re-check, a window whose match is gone (or now a failure / a shared handle) closes,
    // so the next re-check shows its spinner again.
    useEffect(() => {
        if (!openId || loading) return;
        const sharedHandle = type === 'social' && handleCount > SHARED_HANDLE_WARN;
        const stillThere = !failedId && !sharedHandle && visibleDupHintMatches(matches, dismissed, value).some(m => m.adopterId === openId);
        if (!stillThere) { setOpenIdState(null); setPickedInWindow(false); }
    }, [openId, loading, failedId, handleCount, matches, dismissed, value, type]);

    // A re-check while the window is open (a network picked in it) keeps the window and the matches on screen.
    if (loading && !openId) {
        return (
            <div className={`flex items-center gap-2 text-xs text-stone-500 ${className ?? ''}`}>
                <span className="inline-block w-3 h-3 border-2 border-stone-400 border-t-transparent rounded-full animate-spin" aria-hidden />
                <span>{t('adopter.dup_hint_checking')}</span>
            </div>
        );
    }

    if (failedId) return <DupHintFailed errorId={failedId} className={className} />;

    // Shared/rescuer contact: a handle on many records is a data-quality signal,
    // not a merge suggestion — warn instead of offering to flag them as duplicates.
    if (type === 'social' && handleCount > SHARED_HANDLE_WARN) {
        const msg = t('adopter.dup_hint_shared_handle').replace('{n}', String(handleCount));
        return (
            <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${className ?? ''}`} style={{ ...WARNING_BOX, color: 'var(--status-warning-text)' }} role="status" data-testid="dup-hint-shared">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{msg}</span>
            </div>
        );
    }

    const visible = visibleDupHintMatches(matches, dismissed, value);
    if (visible.length === 0) return null;
    const open = openId ? visible.find(m => m.adopterId === openId) ?? null : null;

    // «No es esta persona» is an answer, saved like «Mantener separados» (spec 2026-11-06,
    // consistency rule — reverses 2026-10-29's "local only"). Hidden on the spot; saved on the server,
    // which settles it (the viewer loaded either profile) or opens it for the owners and names them.
    const handleNotThis = (adopterId: string) => {
        setDismissed(prev => dismissDupHintMatch(prev, value, adopterId));
        setOpenId(null);
        if (!excludeAdopterId) return;
        const typed = isDupHintType(type) ? { type: type as 'phone' | 'email' | 'social' | 'id', value } : undefined;
        void answerNotSamePerson({ adopterId: excludeAdopterId, rejectedIds: [adopterId], ...(typed ? { typed } : {}) })
            .then(res => {
                if (!res.ok) {
                    toast.error(t('errors.generic'), t('errors.dedup_dismiss_failed'), res.errorId ?? resolveErrorId(new Error(`answerNotSamePerson: ${res.error}`), 'DuplicateHint.notThis'));
                    return;
                }
                trackSamePersonAnswer('dup_hint', 'different', res.recorded > 0);
                for (const a of res.asked) {
                    toast.info(t('adopter.dup_hint_asked_owners').replace('{owners}', a.ownerLabels.join(', ')).replace('{other}', a.otherName));
                }
            })
            .catch(e => {
                if (handledAsStale(e)) return;
                toast.error(t('errors.generic'), t('errors.dedup_dismiss_failed'), resolveErrorId(e, 'DuplicateHint.notThis'));
            });
    };

    const handleOpenFull = async (adopterId: string) => {
        setBusy('open');
        try {
            // Awaited, so the new tab loads unmasked; a new tab keeps the composer as it is.
            const res = await grantSearchMatchAccess({ adopterId, query: value.trim() });
            if (!res.ok) console.warn('[DuplicateHint] grantSearchMatchAccess refused — the profile opens masked', { adopterId, error: res.error });
            window.open(`/adopter/${adopterId}`, '_blank', 'noopener,noreferrer');
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', undefined, resolveErrorId(e, 'DuplicateHint.openFull'));
        } finally {
            setBusy(null);
        }
    };

    const handleFlag = async (m: DupHintMatch) => {
        if (!excludeAdopterId || done.has(m.adopterId)) return;
        setBusy('flag');
        try {
            const res = await flagAdopterAsDuplicate({
                currentAdopterId: excludeAdopterId,
                matchedAdopterId: m.adopterId,
                matchedAdopterName: m.adopterName,
            });
            if (res.ok) {
                // Already up for review: nothing new was sent, so it doesn't say «Les avisamos».
                if (res.already) toast.info(t('adopter.dup_hint_pending'));
                else toast.success(t('adopter.dup_hint_flag_success'));
                markDone(m.adopterId, 'flagged');
                setOpenId(null);
            } else if (res.error.startsWith('said_no') || res.error.startsWith('settled_separate')) {
                // Someone already said they are two people / they are recorded as such: the window's own reason, not a failure.
                toast.info(t(res.error.startsWith('said_no') ? 'adopter.dup_hint_said_no' : 'adopter.dup_hint_settled'));
                setOpenId(null);
            } else {
                // `<code>:<errorId>`: the id was logged server-side.
                const errorId = res.error.includes(':') ? res.error.split(':')[1] : resolveErrorId(new Error(`flagAdopterAsDuplicate: ${res.error}`), 'DuplicateHint.flag');
                toast.error(t('errors.generic') || 'Error', t('adopter.dup_hint_flag_failed'), errorId);
            }
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', t('errors.flag_duplicate_failed') || undefined, resolveErrorId(e, 'DuplicateHint.flag'));
        } finally {
            setBusy(null);
        }
    };

    const handleReview = async (m: DupHintMatch) => {
        if (!excludeAdopterId || done.has(m.adopterId)) return;
        setBusy('review');
        try {
            const res = await askAdminsToReviewPair({ currentId: excludeAdopterId, matchId: m.adopterId });
            if (res.ok) {
                // Asking again files nothing new: said so, not «sent».
                if (res.already) toast.info(t('adopter.dup_hint_review_already'));
                else toast.success(t('myAdopters.pending_d_disputed'));
                markDone(m.adopterId, 'sent');
                setOpenId(null);
            } else if (res.error === 'settled_separate') {
                toast.info(t('adopter.dup_hint_settled'));
                setOpenId(null);
            } else {
                toast.error(t('errors.generic') || 'Error', t('adopter.dup_hint_review_failed'), res.errorId);
            }
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', t('adopter.dup_hint_review_failed'), resolveErrorId(e, 'DuplicateHint.review'));
        } finally {
            setBusy(null);
        }
    };

    const confirmContinue = async (m: DupHintMatch) => {
        if (!excludeAdopterId || continuing) return;
        setContinuing(true);
        setContinueFailure(null);
        const failed = (errorId: string) => {
            setContinueFailure(t('adopter.dup_hint_join_failed').replace('{id}', errorId));
            setContinuing(false);
        };
        try {
            const typed = value.trim();
            const res = await continueWithMatchedProfile({
                currentId: excludeAdopterId,
                matchId: m.adopterId,
                ...(typed && isDupHintType(type) ? { typed: { type, value: typed, ...(platform ? { platform } : {}), ...(apps?.length ? { apps } : {}) } } : {}),
            });
            if (res.ok) {
                rememberContinued(res.matchId, { name: res.currentName, told: res.told });
                router.push(`/adopter/${res.matchId}`);
                return;
            }
            if (res.typedSaved) {
                // The value is on this profile now: the composer clears it so it can't be saved twice; the window closes with it.
                toast.error(t('errors.generic') || 'Error', t('adopter.dup_hint_join_failed_saved'), res.errorId);
                setContinuing(false);
                setConfirmId(null);
                onTypedSaved?.();
                return;
            }
            if (res.error === 'settled_separate') {
                setContinueFailure(t('adopter.dup_hint_settled'));
                setContinuing(false);
                return;
            }
            if (res.error === 'not_a_match') {
                // The two profiles share no contact (EM review I1): never joined from here.
                setContinueFailure(t('adopter.dup_hint_not_a_match').replace('{id}', res.errorId));
                setContinuing(false);
                return;
            }
            if (res.error === 'platform_required') {
                setContinueFailure(t('adopter.ce_social_which'));
                setContinuing(false);
                return;
            }
            if (res.error === CONTACT_ENTRIES_FULL) {
                // An expected rule (the profile holds the most contacts it can), not a failure.
                setContinueFailure(t('adopter.ce_add_full'));
                setContinuing(false);
                return;
            }
            failed(res.errorId);
        } catch (e) {
            // An old tab: the «nueva versión» notice says it; no second message here.
            if (handledAsStale(e)) { setContinuing(false); return; }
            failed(resolveErrorId(e, 'DuplicateHint.continue'));
        }
    };

    const confirming = confirmId ? visible.find(m => m.adopterId === confirmId) ?? null : null;

    return (
        <>
            <DupHintBox matches={visible} done={done} onView={setOpenId} className={`mt-2 ${className ?? ''}`} />
            {open && (
                <Modal title={t('adopter.hh_candidate_title')} onClose={() => setOpenId(null)} busy={!!busy} testId="dup-hint-window">
                    <DupHintProfile
                        match={open}
                        canAct={!!excludeAdopterId}
                        needsPlatform={needsPlatform}
                        platform={(platform as SocialPlatform | undefined) ?? null}
                        onPickPlatform={type === 'social' && onPickPlatform ? (p) => { setPickedInWindow(true); onPickPlatform(p); } : undefined}
                        platformAsk={pickedInWindow}
                        busy={busy ?? (loading ? 'checking' : null)}
                        onContinue={() => { setContinueFailure(null); setConfirmId(open.adopterId); setOpenId(null); }}
                        onFlag={() => handleFlag(open)}
                        onReview={() => handleReview(open)}
                        onNotThis={() => handleNotThis(open.adopterId)}
                        onOpenFull={() => handleOpenFull(open.adopterId)}
                    />
                </Modal>
            )}
            {confirming && (
                <DupHintContinueDialog
                    match={confirming}
                    busy={continuing}
                    failure={continueFailure}
                    onCancel={() => { setConfirmId(null); setContinueFailure(null); }}
                    onConfirm={() => { void confirmContinue(confirming); }}
                />
            )}
        </>
    );
}

/** The check failed: one quiet line with its id, so it never reads as «no matches». */
export function DupHintFailed({ errorId, className }: { errorId: string; className?: string }) {
    const { t } = useLanguage();
    return (
        <p className={`flex items-start gap-2 text-xs ${className ?? ''}`} style={{ color: 'var(--text-muted)' }} role="status" data-testid="dup-hint-failed">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--status-warning-text)' }} aria-hidden="true" />
            <span>{t('adopter.dup_hint_failed').replace('{id}', errorId)}</span>
        </p>
    );
}
