'use client';

/**
 * An alert or a flag on a person, one way everywhere (audit B2): the profile
 * header's pill — rounded, bordered, with an SVG icon and its words — also on
 * a household row, a card's household line, a search card, /my-adopters and an
 * applicant's panel. No «⚠» / «📄» emoji chips.
 *
 * - `md`: the profile header (a button that opens the «Por qué está marcado» hint).
 * - `sm`: a line about a person (rows, cards, lists).
 *
 * An ALERT (computed from the person's records) keeps its status colour:
 * «N adopciones en N días» = warning, «Pidió en N rescates…» = purple.
 * A FLAG (a rescuer's report: «Duplicado», «Inexacto») is not an alert (Jon,
 * 2026-11-01): a neutral grey outlined chip with a flag icon and the flag's
 * own name, drawn after the alerts and never counted as «N alertas». Which
 * flags a rescuer surface draws at all is rescuerFlagKinds (no «Inexacto»).
 * Colours are CSS variables: theme-safe.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Flag, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { rescuerFlagKinds, type OpenAlertKind } from '@/domain/flags';
import { periodAlertDays, type PeriodAlerts } from '@/domain/periodAlerts';
import { TAP_TARGET_44 } from '@/components/ui/tapTarget';

export type AlertKind = OpenAlertKind | 'too_many_adoptions' | 'too_many_requests';

/** `null` tone = a flag: the neutral outlined chip. */
const KIND: Record<AlertKind, { tone: 'warning' | 'purple' | null; Icon: LucideIcon }> = {
    inaccurate: { tone: null, Icon: Flag },
    duplicate: { tone: null, Icon: Flag },
    too_many_adoptions: { tone: 'warning', Icon: AlertTriangle },
    too_many_requests: { tone: 'purple', Icon: AlertTriangle },
};

const FLAG_STYLE = { background: 'transparent', color: 'var(--text-secondary)', borderColor: 'var(--text-faint, var(--border-default))' } as const;

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
    const cls = `inline-flex items-center ${sz.box} rounded-full border ${tone ? 'font-semibold' : 'font-medium'} whitespace-nowrap`;
    const style = tone
        ? { background: `var(--status-${tone}-bg)`, color: `var(--status-${tone}-text)`, borderColor: `var(--status-${tone}-border)` }
        : FLAG_STYLE;
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
 * A person's open FLAGS, where one person is summed up in a line (household
 * rows, match cards, «¿Es este perfil?», the applicants list): one neutral
 * flag chip per kind, by its own name («Duplicado») — never counted into
 * «N alertas» (Jon, 2026-11-01). `kinds` come from openAlertKinds; only the
 * ones a rescuer surface shows are drawn (rescuerFlagKinds: no «Inexacto»).
 * Nothing when there are none.
 */
export function AlertSummary({ kinds, testId }: { kinds: readonly OpenAlertKind[]; testId?: string }) {
    const { t } = useLanguage();
    const shown = rescuerFlagKinds(kinds);
    if (shown.length === 0) return null;
    return <>{shown.map(kind => <AlertPill key={kind} kind={kind} testId={testId}>{t(`flags.${kind}`)}</AlertPill>)}</>;
}

/**
 * A person's ALERTS — «{count} adopciones en {days} días» and «Pidió en {count}
 * rescates en {days} días» (periodAlerts) — one pill each, as the search card
 * draws its own; a card's household line draws a housemate's the same way.
 * Never a summary, and never mixed with flags (AlertSummary). Nothing when
 * there are none.
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
