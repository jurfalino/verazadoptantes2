'use client';

/**
 * Shared bits of the admin «Pedidos de combinación» page (requests and
 * disputes): «Qué coincide y qué no» for the pair with each profile's head
 * (name, owner, date, and whether it stays — D31), the badge and button
 * styles, and «hace N días». Colours are theme
 * variables or classes remapped under [data-theme] in globals.css.
 */

import MatchCompare from '@/components/MatchCompare';
import { BreakableEmail } from '@/components/ui/BreakableEmail';
import { AbsorbedBadge, KeptBadge } from '@/components/pendientes/ui';

const DAY_MS = 86_400_000;

export type T = (key: string) => string;

export const BADGE = 'inline-block px-2 py-0.5 rounded-full text-xs font-semibold border';

/** "hace 3 días" — `now` is set after mount only (reading the clock at render breaks hydration). */
export function waited(createdAt: number | null, now: number | null, t: T): string {
    if (createdAt == null || now == null) return '';
    const days = Math.max(0, Math.floor((now - createdAt) / DAY_MS));
    if (days === 0) return t('admin.merge_req_today') || 'hoy';
    return days === 1 ? (t('admin.merge_req_day_ago') || 'hace 1 día') : (t('admin.merge_req_days_ago') || 'hace {n} días').replace('{n}', String(days));
}

export interface AdminSide {
    id: string;
    name: string;
    /** Admin page: the owner's email is shown whole. Null = no real owner. */
    ownerEmail: string | null;
    /** epoch ms */
    createdAt: number | null;
    /** Its contacts (whole: admin page), compared in «Qué coincide y qué no». */
    entries: Array<{ type: string; value: string }>;
}

/**
 * One profile's head inside its «Qué coincide y qué no» block (audit A4): whether it
 * stays or is absorbed, its name (linked), owner and creation date (D31) — the
 * comparison underneath is the shared MatchCompare, as in Pendientes.
 */
export function AdminSideHead({ side, kept, testId, t, formatShortDate }: {
    side: AdminSide;
    kept: boolean;
    testId: string;
    t: T;
    formatShortDate: (ms: number) => string;
}) {
    return (
        <div data-testid={testId} className="min-w-0 normal-case tracking-normal font-normal space-y-0.5 text-sm">
            {/* Pendientes' own identity blocks («SE CONSERVA» / «SE SUMA AL OTRO»): one wording for the same decision (audit B11). */}
            {kept ? <KeptBadge t={t} /> : <AbsorbedBadge t={t} />}
            <div>
                <a href={`/adopter/${encodeURIComponent(side.id)}`} className="inline-flex min-h-[44px] items-center font-semibold text-[15px] text-teal-700 hover:underline break-words">
                    {side.name || t('admin.merge_req_no_name') || '(sin nombre)'}
                </a>
            </div>
            <div className="min-w-0 text-stone-600">
                <span className="font-medium">{t('admin.merge_req_owner') || 'Dueño'}: </span>
                {side.ownerEmail ? <BreakableEmail email={side.ownerEmail} /> : <span className="italic text-stone-500">{t('admin.merge_req_no_owner') || 'sin dueño'}</span>}
            </div>
            {side.createdAt != null && (
                <div className="text-xs text-stone-500">{(t('admin.merge_req_created') || 'Creado el {date}').replace('{date}', formatShortDate(side.createdAt))}</div>
            )}
        </div>
    );
}

/** «Qué coincide y qué no» for an admin row: the side that stays first (outlined), the absorbed one second. */
export function AdminPairCompare({ kept, absorbed, matchTypes, testIdPrefix, t, formatShortDate }: {
    kept: AdminSide;
    absorbed: AdminSide;
    matchTypes: string[];
    testIdPrefix: string;
    t: T;
    formatShortDate: (ms: number) => string;
}) {
    return (
        <MatchCompare
            bare
            adopterId={absorbed.id}
            matchTypes={matchTypes}
            profileName={absorbed.name}
            source={{ kind: 'profile', name: kept.name, entries: kept.entries }}
            profileEntries={absorbed.entries}
            // Admins see every value: no false padlock (review of A4).
            fullVisibility
            target="other"
            kept="source"
            sourceHead={<AdminSideHead testId={`${testIdPrefix}-side-keep`} side={kept} kept t={t} formatShortDate={formatShortDate} />}
            targetHead={<AdminSideHead testId={`${testIdPrefix}-side-absorb`} side={absorbed} kept={false} t={t} formatShortDate={formatShortDate} />}
            t={t}
        />
    );
}
