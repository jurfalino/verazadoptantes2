'use client';

/**
 * An alert on a person, one way everywhere (audit B2): the profile header's
 * flag pill — rounded, bordered, in the alert's status colour, with a lucide
 * icon and its words — also on a household row, a card's household line, a
 * search card, /my-adopters and an applicant's panel. No «⚠» / «📄» emoji chips.
 *
 * - `md`: the profile header (a button that opens the «Por qué está marcado» hint).
 * - `sm`: a line about a person (rows, cards, lists).
 *
 * Kinds and colours (the profile header's): inexacto = error, duplicado and
 * «N adopciones en N días» = warning, «Pidió en N rescates…» = purple, a bare
 * count («1 alerta») = error. Colours are status CSS variables: theme-safe.
 */
import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, Files, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { OpenAlertKind } from '@/domain/flags';
import { periodAlertDays, type PeriodAlerts } from '@/domain/periodAlerts';
import { TAP_TARGET_44 } from '@/components/ui/tapTarget';

export type AlertKind = 'inaccurate' | 'duplicate' | 'too_many_adoptions' | 'too_many_requests' | 'count';

const KIND: Record<AlertKind, { tone: 'error' | 'warning' | 'purple'; Icon: LucideIcon }> = {
    inaccurate: { tone: 'error', Icon: AlertCircle },
    duplicate: { tone: 'warning', Icon: Files },
    too_many_adoptions: { tone: 'warning', Icon: AlertTriangle },
    too_many_requests: { tone: 'purple', Icon: AlertTriangle },
    count: { tone: 'error', Icon: AlertTriangle },
};

const SIZE = {
    // The line-height is pinned so a row's pills (this and RatingBadge, the same box) line up whatever the parent's font.
    sm: { box: 'gap-1 px-2 py-0.5 text-[11px] leading-4', icon: 'w-3 h-3' },
    md: { box: 'gap-1.5 px-3 py-1.5 text-xs', icon: 'w-3.5 h-3.5' },
} as const;

export function AlertPill({ kind, children, size = 'sm', onClick, pressed, testId }: {
    kind: AlertKind;
    children: ReactNode;
    size?: keyof typeof SIZE;
    /** A button (the profile header's pills open their hint). */
    onClick?: () => void;
    pressed?: boolean;
    testId?: string;
}) {
    const { tone, Icon } = KIND[kind];
    const sz = SIZE[size];
    const cls = `inline-flex items-center ${sz.box} rounded-full border font-semibold whitespace-nowrap`;
    const style = { background: `var(--status-${tone}-bg)`, color: `var(--status-${tone}-text)`, borderColor: `var(--status-${tone}-border)` };
    const body = <><Icon className={`${sz.icon} shrink-0`} strokeWidth={2.25} aria-hidden="true" />{children}</>;
    if (onClick) {
        return (
            <button type="button" onClick={onClick} aria-pressed={pressed} data-testid={testId} data-alert={kind}
                // 44px to the touch (TAP_TARGET_44) at the pill's own size.
                className={`${cls} ${TAP_TARGET_44} transition-all hover:opacity-90 ${pressed ? 'shadow-inner' : ''}`} style={style}>
                {body}
            </button>
        );
    }
    return <span className={cls} style={style} data-testid={testId} data-alert={kind}>{body}</span>;
}

/**
 * A person's open alerts in one pill, where one person is summed up in a line
 * (household rows, match cards, «¿Es este perfil?», a card's household line,
 * the applicants list). `kinds` come from openAlertKinds — the profile
 * header's rule. One kind is that kind's own header pill («Inexacto» in red,
 * «Duplicado» in amber with its Files icon), exactly as the profile header and
 * the search card draw it; two or more are the count pill («2 alertas»).
 * Nothing when there are none.
 */
export function AlertSummary({ kinds, testId }: { kinds: readonly OpenAlertKind[]; testId?: string }) {
    const { t } = useLanguage();
    if (kinds.length === 0) return null;
    if (kinds.length === 1) {
        const kind = kinds[0];
        return <AlertPill kind={kind} testId={testId}>{t(`flags.${kind}`)}</AlertPill>;
    }
    return <AlertPill kind="count" testId={testId}>{t('adopter.hh_link_alerts_many').replace('{n}', String(kinds.length))}</AlertPill>;
}

/**
 * A person's ALERTS — «{count} adopciones en {days} días» and «Pidió en {count}
 * rescates en {days} días» (periodAlerts) — one pill each, as the search card
 * draws its own; a card's household line draws a housemate's the same way.
 * Never a summary: the «N alertas» pill is for flags (AlertSummary). Nothing
 * when there are none.
 */
export function PeriodAlertPills({ alerts, testId }: { alerts: PeriodAlerts | null | undefined; testId?: string }) {
    const { t } = useLanguage();
    const a = alerts?.tooManyAdoptions, r = alerts?.tooManyRequests;
    return (
        <>
            {a && (
                <AlertPill kind="too_many_adoptions" testId={testId}>
                    {t('flags.too_many_adoptions').replace('{count}', String(a.count)).replace('{days}', String(periodAlertDays(a)))}
                </AlertPill>
            )}
            {r && (
                <AlertPill kind="too_many_requests" testId={testId}>
                    {t('flags.too_many_requests').replace('{count}', String(r.count)).replace('{days}', String(periodAlertDays(r)))}
                </AlertPill>
            )}
        </>
    );
}
