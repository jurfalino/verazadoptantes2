'use client';

/**
 * Shared bits of the admin «Pedidos de combinación» page (requests and
 * disputes): one profile's card (name, owner, date, and whether it stays —
 * D31), the badge and button styles, and «hace N días». Colours are theme
 * variables or classes remapped under [data-theme] in globals.css.
 */

const DAY_MS = 86_400_000;

export type T = (key: string) => string;

export const BADGE = 'inline-block px-2 py-0.5 rounded-full text-xs font-semibold border';
export const PRIMARY_BTN = 'inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
/** Outlined so it has a shape in both themes (D29). */
export const SECONDARY_BTN = 'inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg text-sm font-semibold border border-[var(--text-faint)] text-[var(--text-primary)] bg-transparent hover:bg-[var(--accent-subtle-bg)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

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
}

/** One profile of a pair: whether it stays or is absorbed, its name (linked), owner and creation date (D31). */
export function AdminSideCard({ side, label, kept, testId, t, formatShortDate }: {
    side: AdminSide;
    label: string;
    kept: boolean;
    testId: string;
    t: T;
    formatShortDate: (ms: number) => string;
}) {
    return (
        <div data-testid={testId} className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-0.5 min-w-0">
            <span className={`${BADGE} ${kept ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-stone-100 border-stone-200 text-stone-600'}`}>{label}</span>
            <div>
                <a href={`/adopter/${encodeURIComponent(side.id)}`} className="inline-flex min-h-[44px] items-center font-semibold text-teal-700 hover:underline break-words">
                    {side.name || t('admin.merge_req_no_name') || '(sin nombre)'}
                </a>
            </div>
            <div className="text-stone-600 break-all">
                <span className="font-medium">{t('admin.merge_req_owner') || 'Dueño'}: </span>
                {side.ownerEmail ?? <span className="italic text-stone-500">{t('admin.merge_req_no_owner') || 'sin dueño'}</span>}
            </div>
            {side.createdAt != null && (
                <div className="text-xs text-stone-500">{(t('admin.merge_req_created') || 'Creado el {date}').replace('{date}', formatShortDate(side.createdAt))}</div>
            )}
        </div>
    );
}
