'use client';

/**
 * A banner at the top of a profile that tells the viewer something about it
 * and, maybe, offers an action (audit B7): «¿Deshacer el cambio de nombre?»,
 * «¿No es la misma persona?», «Posible duplicado de …», «Eliminación
 * solicitada». One shape for all of them — the house callout (rounded, bordered,
 * status CSS variables: theme-safe), a 20px lucide icon, a title in the tone's
 * colour, a muted line, and the actions as matrix buttons (compact, ≥44px).
 *
 * `tone`: 'warning' asks for attention; 'info' is a neutral state (e.g. after
 * a dispute was raised there is nothing left to do here).
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function ProfilePromptBanner({ tone, icon: Icon, title, children, actions, testId, role = 'status', titleId, singleLine = false }: {
    tone: 'warning' | 'info';
    icon: LucideIcon;
    title: ReactNode;
    children?: ReactNode;
    actions?: ReactNode;
    testId?: string;
    role?: 'status' | 'dialog' | 'region';
    /** The title's id, for a banner that is labelled by it (`role="dialog"`). */
    titleId?: string;
    /** One row: the actions sit at the title's right, for a banner with no muted line. */
    singleLine?: boolean;
}) {
    if (singleLine) {
        return (
            <div data-testid={testId} data-tone={tone} role={role} aria-labelledby={titleId}
                className="rounded-xl border px-4 py-2 text-sm flex items-center gap-3 min-h-[52px]"
                style={{ background: `var(--status-${tone}-bg)`, borderColor: `var(--status-${tone}-border)`, color: 'var(--text-primary)' }}>
                <Icon className="w-5 h-5 shrink-0" style={{ color: `var(--status-${tone}-text)` }} aria-hidden="true" />
                {/* Two lines at most, never cut: beside a 44px button that is still one row's height. */}
                <p id={titleId} className="font-semibold line-clamp-2 break-words min-w-0 flex-1" style={{ color: `var(--status-${tone}-text)` }}>{title}</p>
                {actions && <div className="shrink-0 flex gap-2">{actions}</div>}
            </div>
        );
    }
    return (
        <div data-testid={testId} data-tone={tone} role={role} aria-labelledby={titleId}
            className="rounded-xl border p-4 text-sm flex items-start gap-3"
            style={{ background: `var(--status-${tone}-bg)`, borderColor: `var(--status-${tone}-border)`, color: 'var(--text-primary)' }}>
            <Icon className="w-5 h-5 mt-px shrink-0" style={{ color: `var(--status-${tone}-text)` }} aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <p id={titleId} className="font-semibold break-words" style={{ color: `var(--status-${tone}-text)` }}>{title}</p>
                {children && <div className="text-[13px] mt-0.5 break-words" style={{ color: 'var(--text-muted)' }}>{children}</div>}
                {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
            </div>
        </div>
    );
}
