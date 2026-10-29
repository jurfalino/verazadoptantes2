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
 *   (RatingBadge, «Sin calificación» when unrated), their household line only
 *   when a housemate has a problem (CardHouseholdLine — the one rendering), and
 *   «Ver perfil». The contact just typed is NOT repeated (it is in the field).
 * - «Ver perfil» opens a window over the page (the shared Modal), so whatever
 *   is being typed stays. Its body (`DupHintProfile`) is the match card's:
 *   MatchCardHeader, their contacts as «¿Es este perfil?» shows them (masked by
 *   the server, the one typed marked «coincide»), their activity, then:
 *     1. «Es la misma persona» → flags the pair for admin review
 *        (flagAdopterAsDuplicate) — only on a saved profile (`excludeAdopterId`).
 *        Flag, never merge (segregation of duties): merging soft-deletes a
 *        record another rescuer may own; an admin decides.
 *     2. «No es esta persona» → closes the window and drops that row while the
 *        typed value stays the same. Local only: no server write, no toast.
 *     3. «Abrir perfil completo en otra pestaña» → writes the search-match
 *        grant (grantSearchMatchAccess) so the new tab renders unmasked, then
 *        opens it; the composer is untouched.
 *
 * Data: getDuplicateHintMatches — the same detection the hint always ran,
 * enriched on the server into the «¿Es este perfil?» card data.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Check, CheckCircle2 } from 'lucide-react';
import { getDuplicateHintMatches, grantSearchMatchAccess, flagAdopterAsDuplicate, countAdoptersBySocialHandle } from '@/app/actions';
import type { DupHintMatch } from '@/app/actions/households';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { RatingBadge } from '@/components/RatingBadge';
import { CardHouseholdLine } from '@/components/CardHouseholdLine';
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

interface Props {
    /** Strong identifier type the user just typed. Address/alias/other are no-op. */
    type: ContactEntryType;
    /** The typed value. Empty string clears the hint. Whitespace is ignored. */
    value: string;
    /** The profile being edited: never a match, and «Es la misma persona» needs it. */
    excludeAdopterId?: string;
    className?: string;
}

// A social handle on more than this many records is almost certainly a shared /
// rescuer contact mis-entered on adopters, not a real duplicate (dedup spec §4).
const SHARED_HANDLE_WARN = 8;

const WARNING_BOX = { background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)' } as const;

const matchName = (m: DupHintMatch, nameless: string) => m.adopter?.name?.trim() || m.adopterName?.trim() || nameless;

/** The inline box: header + one compact row per match. Presentational. */
export function DupHintBox({ matches, flagged, onView, className = '' }: {
    matches: readonly DupHintMatch[];
    flagged: ReadonlySet<string>;
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
                            <CardHouseholdLine lines={m.householdLine} className="mt-1" />
                        </div>
                        {flagged.has(m.adopterId) ? (
                            <span className="shrink-0 inline-flex items-center gap-1 min-h-[44px] pr-1 text-[13px] font-semibold text-teal-700" data-testid="dup-hint-flagged">
                                <Check className="w-4 h-4" aria-hidden="true" />{t('adopter.dup_hint_flagged')}
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

/** The window's body: the match card + the three answers. Presentational. */
export function DupHintProfile({ match, canFlag, flagging = false, opening = false, onSame, onNotThis, onOpenFull }: {
    match: DupHintMatch;
    /** A saved profile is being edited: «Es la misma persona» can flag the pair. */
    canFlag: boolean;
    flagging?: boolean;
    opening?: boolean;
    onSame: () => void;
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
    const busy = flagging || opening;
    return (
        <div className="space-y-3 min-w-0" data-testid="dup-hint-profile">
            <MatchCardHeader
                person={{
                    id: match.adopterId, name,
                    rating: match.rating ?? match.avgRating,
                    openAlerts: match.openAlerts ?? openAlertKinds(match.flags),
                    isMinor: !!match.isMinor,
                    households: match.householdLine,
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
            {match.activity && <div><PersonActivity activity={match.activity} testId="dup-hint-activity" /></div>}
            <div className="flex flex-col gap-2 pt-1">
                {canFlag && (
                    <Button type="button" fullWidth onClick={onSame} disabled={busy} loading={flagging} data-testid="dup-hint-same"
                        icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}>
                        {t('formResults.same_person')}
                    </Button>
                )}
                <Button type="button" variant="secondary" fullWidth onClick={onNotThis} disabled={busy} data-testid="dup-hint-not-this">
                    {t('formResults.not_this_person')}
                </Button>
                <button type="button" onClick={onOpenFull} disabled={busy} data-testid="dup-hint-open-full"
                    className="inline-flex items-center justify-center gap-1 min-h-[44px] px-2 rounded-xl text-[13px] font-semibold text-teal-700 hover:underline disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                    {t('adopter.dup_hint_open_full')}
                    <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}

export default function DuplicateHint({ type, value, excludeAdopterId, className }: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [matches, setMatches] = useState<DupHintMatch[]>([]);
    const [handleCount, setHandleCount] = useState(0);
    const [loading, setLoading] = useState(false);
    // The check itself failed: said on the spot with its id, never shown as «no matches».
    const [failedId, setFailedId] = useState<string | null>(null);
    // «No es esta persona», for the value it was answered on.
    const [dismissed, setDismissed] = useState<DupHintDismissed>(NO_DISMISSED);
    const [openId, setOpenId] = useState<string | null>(null);
    const [flagging, setFlagging] = useState(false);
    const [opening, setOpening] = useState(false);
    // Pairs already flagged here: no second flag row on a double tap, and «✓ Marcado» without a reload.
    const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
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
                const res = await getDuplicateHintMatches({ type, value: v, excludeAdopterId });
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
    }, [type, value, excludeAdopterId]);

    if (loading) {
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

    const handleNotThis = (adopterId: string) => {
        setDismissed(prev => dismissDupHintMatch(prev, value, adopterId));
        setOpenId(null);
    };

    const handleOpenFull = async (adopterId: string) => {
        setOpening(true);
        try {
            // Awaited, so the new tab loads unmasked; a new tab keeps the composer as it is.
            const res = await grantSearchMatchAccess({ adopterId, query: value.trim() });
            if (!res.ok) console.warn('[DuplicateHint] grantSearchMatchAccess refused — the profile opens masked', { adopterId, error: res.error });
            window.open(`/adopter/${adopterId}`, '_blank', 'noopener,noreferrer');
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', undefined, resolveErrorId(e, 'DuplicateHint.openFull'));
        } finally {
            setOpening(false);
        }
    };

    const handleSame = async (m: DupHintMatch) => {
        if (!excludeAdopterId || flagged.has(m.adopterId)) return;
        setFlagging(true);
        try {
            const res = await flagAdopterAsDuplicate({
                currentAdopterId: excludeAdopterId,
                matchedAdopterId: m.adopterId,
                matchedAdopterName: m.adopterName,
            });
            if (res.ok) {
                toast.success('🚩', t('adopter.dup_hint_flag_success'));
                setFlagged(prev => new Set(prev).add(m.adopterId));
                setOpenId(null);
            } else {
                // `internal_error:<errorId>`: the id was logged server-side.
                const errorId = res.error.includes(':') ? res.error.split(':')[1] : undefined;
                toast.error(t('errors.generic') || 'Error', t('adopter.dup_hint_flag_failed'), errorId);
            }
        } catch (e) {
            console.error('[DuplicateHint] flagAdopterAsDuplicate threw:', { excludeAdopterId, matchedAdopterId: m.adopterId, error: e });
            toast.error(t('errors.generic') || 'Error', t('errors.flag_duplicate_failed') || undefined, resolveErrorId(e, 'DuplicateHint'));
        } finally {
            setFlagging(false);
        }
    };

    return (
        <>
            <DupHintBox matches={visible} flagged={flagged} onView={setOpenId} className={`mt-2 ${className ?? ''}`} />
            {open && (
                <Modal title={t('adopter.hh_candidate_title')} onClose={() => setOpenId(null)} busy={flagging} testId="dup-hint-window">
                    <DupHintProfile
                        match={open}
                        canFlag={!!excludeAdopterId}
                        flagging={flagging}
                        opening={opening}
                        onSame={() => handleSame(open)}
                        onNotThis={() => handleNotThis(open.adopterId)}
                        onOpenFull={() => handleOpenFull(open.adopterId)}
                    />
                </Modal>
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
