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
import { NOTIFICATION_TYPES } from './constants';

export const EMAIL_CHANNEL = 'email';
/** `kind` of the follow-up cron's digest email (it has no single notification id). */
export const FOLLOWUP_DIGEST_KIND = 'follow_up_digest';
/** `kind` when an email link carries none. */
export const DEFAULT_EMAIL_KIND = 'notification';

const PARAM_ID = 'n';
const PARAM_CHANNEL = 'ch';
const PARAM_KIND = 'kind';
const TRACKING_PARAMS = [PARAM_ID, PARAM_CHANNEL, PARAM_KIND];

// What a landing URL may put into an event. `kind` is an allowlist (every
// notification type + the digest), so a crafted link can't carry free text such
// as a name; the id is shape-checked (no email, spaces or punctuation).
const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
const KNOWN_KINDS: ReadonlySet<string> = new Set<string>([...NOTIFICATION_TYPES, FOLLOWUP_DIGEST_KIND]);

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
    /** True when the person was signed out and the tags arrived inside the sign-in `callbackUrl`. */
    viaLogin: boolean;
    /** pathname + remaining query + hash, for `history.replaceState`. */
    cleanedUrl: string;
}

/** The email tags in one query string, or null when it carries no `ch=email`. */
function readTags(search: string): { notificationId: string | undefined; kind: string; kept: string } | null {
    const params = new URLSearchParams(search);
    if (params.get(PARAM_CHANNEL) !== EMAIL_CHANNEL) return null;
    const id = params.get(PARAM_ID);
    const kind = params.get(PARAM_KIND);
    const kept = keepSegments(search.replace(/^\?/, ''), TRACKING_PARAMS);
    return {
        notificationId: id && ID_SHAPE.test(id) ? id : undefined,
        kind: kind && KNOWN_KINDS.has(kind) ? kind : DEFAULT_EMAIL_KIND,
        kept: kept.length ? `?${kept.join('&')}` : '',
    };
}

/**
 * Null unless the URL came from one of our emails (`ch=email`). A signed-out
 * click on a protected page is redirected by middleware to
 * `/?callbackUrl=<path+query>`: the tags are then read from (and stripped out
 * of) that same-site callback, so the click is counted once, before sign-in,
 * and the post-login landing carries no tags.
 */
export function parseEmailLanding(loc: { pathname: string; search: string; hash: string }): EmailLanding | null {
    const direct = readTags(loc.search);
    if (direct) {
        return {
            notificationId: direct.notificationId,
            kind: direct.kind,
            viaLogin: false,
            cleanedUrl: `${loc.pathname}${direct.kept}${loc.hash}`,
        };
    }
    const outer = new URLSearchParams(loc.search);
    const cb = outer.get('callbackUrl');
    // Same-site paths only ('/x', never '//host' or 'https://…').
    if (!cb || !cb.startsWith('/') || cb.startsWith('//')) return null;
    const hashAt = cb.indexOf('#');
    const cbNoHash = hashAt === -1 ? cb : cb.slice(0, hashAt);
    const cbHash = hashAt === -1 ? '' : cb.slice(hashAt);
    const qAt = cbNoHash.indexOf('?');
    if (qAt === -1) return null;
    const inner = readTags(cbNoHash.slice(qAt));
    if (!inner) return null;
    const cleanedCb = `${cbNoHash.slice(0, qAt)}${inner.kept}${cbHash}`;
    const rebuilt = loc.search.replace(/^\?/, '').split('&').map(seg =>
        paramKey(seg) === 'callbackUrl' ? `callbackUrl=${encodeURIComponent(cleanedCb)}` : seg,
    ).join('&');
    return {
        notificationId: inner.notificationId,
        kind: inner.kind,
        viaLogin: true,
        cleanedUrl: `${loc.pathname}?${rebuilt}${loc.hash}`,
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
