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

export type AlertKind = 'inaccurate' | 'duplicate' | 'too_many_adoptions' | 'too_many_requests' | 'count';

const KIND: Record<AlertKind, { tone: 'error' | 'warning' | 'purple'; Icon: LucideIcon }> = {
    inaccurate: { tone: 'error', Icon: AlertCircle },
    duplicate: { tone: 'warning', Icon: Files },
    too_many_adoptions: { tone: 'warning', Icon: AlertTriangle },
    too_many_requests: { tone: 'purple', Icon: AlertTriangle },
    count: { tone: 'error', Icon: AlertTriangle },
};

const SIZE = {
    sm: { box: 'gap-1 px-2 py-0.5 text-[11px]', icon: 'w-3 h-3' },
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
                className={`${cls} transition-all hover:opacity-90 ${pressed ? 'shadow-inner' : ''}`} style={style}>
                {body}
            </button>
        );
    }
    return <span className={cls} style={style} data-testid={testId} data-alert={kind}>{body}</span>;
}
