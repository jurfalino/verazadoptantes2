/**
 * Notification analytics — the pure half (tested in notificationTracking.test.ts).
 *
 * Email links carry `n` (notification id), `ch=email` and `kind` (the notice
 * type, or `follow_up_digest`); `NotificationEmailLanding` reads them on
 * arrival, sends `notification_email_clicked`, and strips them from the
 * address bar. Event properties are only types, ids, counts and source —
 * never titles, bodies, names or emails.
 *
 * No `@/` imports: the follow-up cron Worker bundles this file by relative path
 * (workers/followup-cron/src/copy.ts), like src/domain/followups.ts.
 */

export const EMAIL_CHANNEL = 'email';
/** `kind` of the follow-up cron's digest email (it has no single notification id). */
export const FOLLOWUP_DIGEST_KIND = 'follow_up_digest';
/** `kind` when an email link carries none. */
export const DEFAULT_EMAIL_KIND = 'notification';

const PARAM_ID = 'n';
const PARAM_CHANNEL = 'ch';
const PARAM_KIND = 'kind';
const TRACKING_PARAMS = [PARAM_ID, PARAM_CHANNEL, PARAM_KIND];

// Shapes accepted from a landing URL. Anything else is dropped, so a crafted
// link can't put an email, spaces or capitals into an event (shape check, not
// an allowlist: `kind=juan_perez` still passes).
const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
const KIND_SHAPE = /^[a-z0-9_]{1,64}$/;

function paramKey(segment: string): string {
    const eq = segment.indexOf('=');
    const raw = eq === -1 ? segment : segment.slice(0, eq);
    try { return decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { return raw; }
}

/** Query segments (without the leading `?`) whose key is not in `drop`, verbatim. */
function keepSegments(query: string, drop: string[]): string[] {
    return query.split('&').filter(s => s !== '' && !drop.includes(paramKey(s)));
}

/**
 * Append `params` to `url` (absolute or a path), before any `#hash`. An
 * existing param of the same name is replaced; every other param is kept
 * byte-for-byte (no re-encoding).
 */
export function withTrackingParams(url: string, params: Record<string, string>): string {
    const hashAt = url.indexOf('#');
    const hash = hashAt === -1 ? '' : url.slice(hashAt);
    const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
    const queryAt = beforeHash.indexOf('?');
    const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
    const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

    const kept = keepSegments(query, Object.keys(params));
    const added = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    return `${base}?${[...kept, ...added].join('&')}${hash}`;
}

/** The main link of a notification's email twin. */
export function notificationEmailLink(url: string, notificationId: string, type: string): string {
    return withTrackingParams(url, { [PARAM_ID]: notificationId, [PARAM_CHANNEL]: EMAIL_CHANNEL, [PARAM_KIND]: type });
}

/** Links in the follow-up cron's digest email. */
export function followupDigestLink(url: string): string {
    return withTrackingParams(url, { [PARAM_CHANNEL]: EMAIL_CHANNEL, [PARAM_KIND]: FOLLOWUP_DIGEST_KIND });
}

export interface EmailLanding {
    /** Undefined for the digest, or when the link's id is malformed. */
    notificationId: string | undefined;
    kind: string;
    /** pathname + remaining query + hash, for `history.replaceState`. */
    cleanedUrl: string;
}

/** Null unless the URL came from one of our emails (`ch=email`). */
export function parseEmailLanding(loc: { pathname: string; search: string; hash: string }): EmailLanding | null {
    const params = new URLSearchParams(loc.search);
    if (params.get(PARAM_CHANNEL) !== EMAIL_CHANNEL) return null;

    const id = params.get(PARAM_ID);
    const kind = params.get(PARAM_KIND);
    const kept = keepSegments(loc.search.replace(/^\?/, ''), TRACKING_PARAMS);
    return {
        notificationId: id && ID_SHAPE.test(id) ? id : undefined,
        kind: kind && KIND_SHAPE.test(kind) ? kind : DEFAULT_EMAIL_KIND,
        cleanedUrl: `${loc.pathname}${kept.length ? `?${kept.join('&')}` : ''}${loc.hash}`,
    };
}

/**
 * Hours since `createdAt`, one decimal, never negative. A number is unix
 * SECONDS (legacy rows, as the bell renders them); strings are what the JSON
 * API returns. Undefined when unusable — event props can't hold null.
 */
export function notificationAgeHours(createdAt: number | string | Date | null | undefined, nowMs: number): number | undefined {
    if (createdAt === null || createdAt === undefined) return undefined;
    const ms = typeof createdAt === 'number' ? createdAt * 1000 : new Date(createdAt).getTime();
    if (!Number.isFinite(ms)) return undefined;
    const hours = Math.max(0, (nowMs - ms) / 3_600_000);
    return Math.round(hours * 10) / 10;
}

export type NotificationClickSource = 'bell' | 'page';

/** `notification_clicked` properties. Read state is the row's BEFORE the click. */
export function notificationClickProps(
    item: { id: string; type: string; read: number | boolean; createdAt: number | string | Date | null | undefined },
    source: NotificationClickSource,
    nowMs: number,
): Record<string, string | number | boolean> {
    const age = notificationAgeHours(item.createdAt, nowMs);
    return {
        type: item.type,
        notification_id: item.id,
        source,
        was_unread: !item.read,
        ...(age === undefined ? {} : { age_hours: age }),
    };
}
