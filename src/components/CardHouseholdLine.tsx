'use client';

/**
 * The household line of a card that shows ONE person — a search result, a
 * match card (form, contract, «Posibles coincidencias», save check, import),
 * «¿Es este perfil?» and a Pendientes pair side. One component, one behaviour
 * (option B, Jon 2026-10-28):
 *
 * - It appears ONLY when a housemate has a problem: a low rating (1★/2★, the
 *   pill's «Peligroso»/«Malo») or an ALERT («N adopciones en N días», «Pidió
 *   en N rescates…» — the search card's own rule, periodAlerts). FLAGS
 *   («Inexacto», «Duplicado») never make it appear and are never shown in it.
 *   No problem → nothing at all about the home (householdLineSummary).
 * - Closed by default: one row in the warning tone —
 *       ⌂ Vive con 2 personas  ★ 1.0 · Peligroso  3 adopciones en 10 días  ⌄
 *   the lowest low rating and one pill per alert kind.
 * - Tapping it opens everyone in the home, grouped per home («Convive con» /
 *   «En otro hogar, con»): name, «Menor de edad», rating (or «Sin
 *   calificación») and their alerts. Tapping again closes it.
 *
 * The toggle is a real <button aria-expanded>, at least 44px tall. The search
 * card is itself a link: the box stops the click (preventDefault +
 * stopPropagation, as RatingExplainer does) so opening never navigates. Names
 * are plain text. Gift-only lines are left out (a gift recipient doesn't live
 * there).
 */

import { useId, useState } from 'react';
import { ChevronDown, Home } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { MinorTag } from '@/components/MinorTag';
import { PeriodAlertPills } from '@/components/AlertPill';
import { householdLineSummary, type HouseholdLine } from '@/domain/households';

export function CardHouseholdLine({ lines, className = 'mt-2' }: { lines: HouseholdLine[] | null | undefined; className?: string }) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const listId = useId();
    const summary = householdLineSummary(lines);
    if (!summary.show) return null;
    const count = summary.housemateCount === 1
        ? t('adopter.hh_card_lives_with_one')
        : t('adopter.hh_card_lives_with_many').replace('{n}', String(summary.housemateCount));
    return (
        <div className={className}>
            <div
                className="rounded-lg border text-xs"
                style={{ background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)' }}
                data-testid="card-household-line"
                data-open={open ? 'true' : 'false'}
                role="group"
                aria-label={t('adopter.hh_card_aria')}
                // Inside a card that is a link: a tap here opens / closes the line, never the profile.
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
            >
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    aria-expanded={open}
                    aria-controls={listId}
                    data-testid="card-household-toggle"
                    className="w-full min-h-11 flex items-center gap-x-1.5 gap-y-1 flex-wrap px-3 py-1.5 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                >
                    <Home className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--status-warning-text)' }} aria-hidden="true" />
                    <span className="font-semibold mr-0.5" style={{ color: 'var(--text-primary)' }} data-testid="card-household-count">{count}</span>
                    {summary.worstRating != null && <RatingBadge rating={summary.worstRating} />}
                    <PeriodAlertPills alerts={summary.alerts} testId="card-household-alert" />
                    <span className="sr-only">{open ? t('adopter.hh_card_close') : t('adopter.hh_card_open')}</span>
                    <ChevronDown className={`ml-auto w-4 h-4 shrink-0 ${open ? 'rotate-180' : ''}`}
                        style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
                </button>
                {open && (
                    <div id={listId} className="px-3 pb-2.5 pt-0.5 space-y-1.5 min-w-0" data-testid="card-household-list">
                        {summary.homes.map((home, i) => (
                            <div key={home[0].householdId || i} className="min-w-0">
                                <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                    {i === 0 ? t('adopter.hh_lives_with_title') : t('adopter.hh_other_home_title')}
                                </div>
                                {home.map(p => (
                                    <div key={p.profileId} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0 mt-0.5" data-testid="card-household-person">
                                        <span className="font-medium break-words [overflow-wrap:anywhere]" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                                        {p.isMinor && <MinorTag testId="card-household-minor" />}
                                        <RatingBadge rating={p.rating} />
                                        {/* Their ALERTS only — never their flags. */}
                                        <PeriodAlertPills alerts={p.alerts} testId="card-household-alert" />
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
