'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    DEFAULT_TIMEZONE,
    formatShortDate as formatShortDateIn,
    formatDateTime as formatDateTimeIn,
    formatDateTimeFull as formatDateTimeFullIn,
    formatRelativeTime as formatRelativeTimeIn,
} from '@/lib/dates';

/**
 * The zone every rendered date is formatted in, resolved once per request from
 * `user_profiles.timezone` (see `resolveViewerTimezone`) and handed down from
 * the root layout.
 *
 * Why a context rather than reading the browser's zone directly: this value is
 * used during SSR *and* during hydration, and both passes must agree or React
 * discards the server tree (#418 — errorId 43d67f9e, 2026-09-07). A context
 * seeded from the server is identical in both passes; `Intl.DateTimeFormat()
 * .resolvedOptions().timeZone` is not, because the server has no idea what the
 * browser will say.
 *
 * It is also deliberately *not* read from the live `cf-timezone` request header.
 * Cloudflare reports the egress location, so a user on a VPN gets someone
 * else's zone — see `.agents/audits/2026-09-04-vpn-stale-data.md`, where CF
 * reported `loc=US` for an Argentine user. The stored profile value is stable
 * and the user can correct it in Configuración.
 */
const TimezoneContext = createContext<string>(DEFAULT_TIMEZONE);

export function TimezoneProvider({
    timezone,
    children,
}: {
    timezone: string | null | undefined;
    children: React.ReactNode;
}) {
    return (
        <TimezoneContext.Provider value={timezone || DEFAULT_TIMEZONE}>
            {children}
        </TimezoneContext.Provider>
    );
}

/** The viewer's IANA zone. Falls back to `DEFAULT_TIMEZONE` outside a provider. */
export function useTimezone(): string {
    return useContext(TimezoneContext);
}

/**
 * The date formatters, pre-bound to the viewer's zone.
 *
 * Call sites keep the same shape they had before the zone was threaded through
 * (`formatShortDate(value)`), so adopting this is a one-line change per
 * component rather than an edit at every call.
 */
export function useDateFormat() {
    const timeZone = useTimezone();
    return useMemo(() => ({
        formatShortDate: (input: Date | number | string) => formatShortDateIn(input, timeZone),
        formatDateTime: (input: Date | number | string) => formatDateTimeIn(input, timeZone),
        formatDateTimeFull: (input: Date | number | string) => formatDateTimeFullIn(input, timeZone),
    }), [timeZone]);
}

/**
 * Relative time ("hace 2 horas"), rendered client-side only.
 *
 * Returns `null` until after mount. Relative time reads the wall clock, so the
 * server's value and the browser's are computed at different instants and drift
 * across bucket edges — pinning a zone cannot fix that. Rendering nothing on the
 * first paint and filling in on mount is the only way to keep it hydration-safe.
 */
export function useRelativeTime() {
    const [now, setNow] = useState<Date | null>(null);
    useEffect(() => { setNow(new Date()); }, []);
    return useCallback(
        (input: Date | number | string, lang: 'es' | 'en' = 'es'): string | null =>
            now ? formatRelativeTimeIn(input, lang, now) : null,
        [now],
    );
}
