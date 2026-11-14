/**
 * Group branding — pure rules (spec: docs/superpowers/specs/2026-11-13-group-branding-design.md).
 * NO DB / server imports. contract-app renders the same palette on public pages.
 */
import type { DocsSource } from './adoptionDocs';

export const GROUP_THEMES = ['dark', 'light'] as const;
export type GroupTheme = (typeof GROUP_THEMES)[number];

export type Accent = {
    id: string; name: string;
    /** dark-theme shades */ d: string; dStrong: string; dHover: string;
    /** light-theme shades */ l: string; lStrong: string; lHover: string;
};

export const ACCENTS = [
    { id: 'violeta', name: 'Violeta', d: '#818cf8', dStrong: '#a5b4fc', dHover: '#6366f1', l: '#4f46e5', lStrong: '#4338ca', lHover: '#3730a3' },
    { id: 'azul', name: 'Azul', d: '#60a5fa', dStrong: '#93c5fd', dHover: '#3b82f6', l: '#2563eb', lStrong: '#1d4ed8', lHover: '#1e40af' },
    { id: 'turquesa', name: 'Turquesa', d: '#2dd4bf', dStrong: '#5eead4', dHover: '#14b8a6', l: '#0f766e', lStrong: '#115e59', lHover: '#134e4a' },
    { id: 'verde', name: 'Verde', d: '#4ade80', dStrong: '#86efac', dHover: '#22c55e', l: '#15803d', lStrong: '#166534', lHover: '#14532d' },
    { id: 'naranja', name: 'Naranja', d: '#fb923c', dStrong: '#fdba74', dHover: '#f97316', l: '#c2410c', lStrong: '#9a3412', lHover: '#7c2d12' },
    { id: 'rosa', name: 'Rosa', d: '#f472b6', dStrong: '#f9a8d4', dHover: '#ec4899', l: '#be185d', lStrong: '#9d174d', lHover: '#831843' },
    { id: 'ambar', name: 'Ámbar', d: '#fbbf24', dStrong: '#fcd34d', dHover: '#f59e0b', l: '#b45309', lStrong: '#92400e', lHover: '#78350f' },
    { id: 'grafito', name: 'Grafito', d: '#cbd5e1', dStrong: '#e2e8f0', dHover: '#94a3b8', l: '#334155', lStrong: '#1e293b', lHover: '#0f172a' },
] as const satisfies readonly Accent[];

export type AccentId = (typeof ACCENTS)[number]['id'];
export const DEFAULT_THEME: GroupTheme = 'dark';
export const DEFAULT_ACCENT_ID: AccentId = 'violeta';

export const ORG_IMAGE_KINDS = ['logo', 'banner'] as const;
export type OrgImageKind = (typeof ORG_IMAGE_KINDS)[number];
// Bounded by Next's default 1 MB server-action body limit (setGroupImage is an action): the client (Task 8) must check the size before sending.
export const ORG_IMAGE_MAX_DATA_URL = 750_000;
export const LOGO_MAX_PX = 512;
export const BANNER_MAX_PX = 1600;

// ── Social links ───────────────────────────────────────────────────
export type SocialKind = 'instagram' | 'facebook' | 'website';
export type LinkResult = { ok: true; url: string | null } | { ok: false };

const BAD: LinkResult = { ok: false };
const WEBSITE_MAX = 200;
const IG_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const FB_HANDLE = /^[A-Za-z0-9.]{5,50}$/;
const IG_HOSTS = ['instagram.com', 'www.instagram.com'];
const FB_HOSTS = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com'];

function parseUrl(raw: string): URL | null {
    try {
        const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
    } catch {
        return null;
    }
}

const looksLikeUrl = (raw: string) => /^(https?:\/\/|www\.)/i.test(raw) || raw.includes('/');

/** A bare network host typed as if it were a handle («instagram.com», «@facebook.com») — never a handle. */
const isBareHost = (handle: string) => [...IG_HOSTS, ...FB_HOSTS].includes(handle.toLowerCase());

function pathSegments(u: URL): string[] {
    return u.pathname.split('/').filter(Boolean);
}

// Instagram paths that are a post/reel/page of the site, not a profile: refused, never stored as `instagram.com/p`.
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal', 's', 'share']);

function normalizeInstagram(raw: string): LinkResult {
    if (!looksLikeUrl(raw)) {
        const handle = raw.replace(/^@/, '');
        if (isBareHost(handle) || IG_RESERVED.has(handle.toLowerCase())) return BAD;
        return IG_HANDLE.test(handle) ? { ok: true, url: `https://instagram.com/${handle}` } : BAD;
    }
    const u = parseUrl(raw);
    if (!u || !IG_HOSTS.includes(u.hostname.toLowerCase())) return BAD;
    const handle = pathSegments(u)[0] ?? '';
    if (IG_RESERVED.has(handle.toLowerCase())) return BAD;
    return IG_HANDLE.test(handle) ? { ok: true, url: `https://instagram.com/${handle}` } : BAD;
}

// One path segment as the URL parser leaves it (non-ASCII arrives percent-encoded).
const FB_SEGMENT = /^[A-Za-z0-9._~%-]{1,100}$/;
const FB_ID = /^\d{1,30}$/;
// Facebook paths that are not a page/profile (a post, photo, video, event…): refused rather than truncated.
const FB_RESERVED = new Set([
    'watch', 'events', 'event', 'photo', 'photo.php', 'photos', 'videos', 'video.php', 'story.php', 'permalink.php',
    'posts', 'reel', 'reels', 'stories', 'marketplace', 'hashtag', 'search', 'login', 'login.php', 'home.php',
    'sharer', 'sharer.php', 'l.php', 'dialog', 'plugins', 'help', 'privacy', 'policies', 'settings', 'notifications',
    'messages', 'friends', 'bookmarks', 'gaming', 'media', 'business', 'ads',
]);
// First segments that only mean something with the rest of the path (see facebookFullPath / profile.php).
const FB_PATH_KINDS = new Set(['people', 'pages', 'groups', 'share']);

/**
 * Facebook URLs whose page lives in a multi-segment path. The full path is kept (query/hash/trailing slash
 * dropped); `null` = not one of these shapes or malformed.
 */
function facebookFullPath(segs: string[]): string | null {
    const [head, ...rest] = segs;
    const kind = head.toLowerCase();
    if (!rest.every(s => FB_SEGMENT.test(s))) return null;
    let ok = false;
    if (kind === 'people') ok = rest.length === 2 && FB_ID.test(rest[1]); // people/<name>/<id>
    else if (kind === 'pages') ok = rest.length >= 1 && rest.length <= 3; // pages/<name>/<id>, pages/category/<cat>/<name-id>
    else if (kind === 'groups') ok = rest.length >= 1 && rest.length <= 3; // groups/<g>, groups/<g>/posts/<id>
    // share/<code> and share/<type letter>/<code> (g group, p post, r reel, v video): the app's «copy link».
    else if (kind === 'share') ok = rest.length === 1 || (rest.length === 2 && /^[a-z]$/i.test(rest[0]));
    return ok ? `https://facebook.com/${[kind, ...rest].join('/')}` : null;
}

function normalizeFacebook(raw: string): LinkResult {
    if (!looksLikeUrl(raw)) {
        const handle = raw.replace(/^@/, '');
        const lower = handle.toLowerCase();
        if (isBareHost(handle) || FB_RESERVED.has(lower) || FB_PATH_KINDS.has(lower) || lower === 'profile.php') return BAD;
        return FB_HANDLE.test(handle) ? { ok: true, url: `https://facebook.com/${handle}` } : BAD;
    }
    const u = parseUrl(raw);
    if (!u || !FB_HOSTS.includes(u.hostname.toLowerCase())) return BAD;
    const segs = pathSegments(u);
    const seg = segs[0] ?? '';
    const head = seg.toLowerCase();
    if (head === 'profile.php') {
        const id = u.searchParams.get('id');
        return id && FB_ID.test(id) ? { ok: true, url: `https://facebook.com/profile.php?id=${id}` } : BAD;
    }
    if (FB_PATH_KINDS.has(head)) {
        const url = facebookFullPath(segs);
        return url && url.length <= WEBSITE_MAX ? { ok: true, url } : BAD;
    }
    if (FB_RESERVED.has(head)) return BAD;
    return FB_HANDLE.test(seg) ? { ok: true, url: `https://facebook.com/${seg}` } : BAD;
}

function normalizeWebsite(raw: string): LinkResult {
    if (raw.length > WEBSITE_MAX) return BAD;
    // A scheme other than http(s) (javascript:, data:, ftp:) is refused, not prefixed.
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return BAD;
    // Public pages only render https links, so http:// is stored as https:// — the dashboard preview (built from
    // the stored value) and the public pages then agree. A bare domain already gets https:// in parseUrl.
    const u = parseUrl(raw.replace(/^http:\/\//i, 'https://'));
    if (!u || !u.hostname.includes('.') || u.username || u.password) return BAD;
    const url = u.pathname === '/' && !u.search && !u.hash ? u.origin : u.href;
    return url.length <= WEBSITE_MAX ? { ok: true, url } : BAD;
}

/** Empty → no link. Otherwise the canonical URL for that network, or `{ ok: false }`. */
export function normalizeSocialLink(kind: SocialKind, raw: string): LinkResult {
    const v = raw.trim();
    if (!v) return { ok: true, url: null };
    if (kind === 'instagram') return normalizeInstagram(v);
    if (kind === 'facebook') return normalizeFacebook(v);
    return normalizeWebsite(v);
}

// ── Branding fields ────────────────────────────────────────────────
export type BrandingFields = {
    theme: GroupTheme; accentId: AccentId;
    instagramUrl: string | null; facebookUrl: string | null; websiteUrl: string | null;
};
export type BrandingInput = { theme: string; accentId: string; instagram: string; facebook: string; website: string };
export type BrandingField = 'theme' | 'accent' | SocialKind;

const isTheme = (v: unknown): v is GroupTheme => (GROUP_THEMES as readonly unknown[]).includes(v);
const isAccentId = (v: unknown): v is AccentId => ACCENTS.some(a => a.id === v);

/** Validates the settings form; on failure names the first bad field. */
export function sanitizeBrandingInput(input: unknown): { ok: true; value: BrandingFields } | { ok: false; field: BrandingField } {
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    if (!isTheme(i.theme)) return { ok: false, field: 'theme' };
    if (!isAccentId(i.accentId)) return { ok: false, field: 'accent' };
    const links: Partial<Record<SocialKind, string | null>> = {};
    for (const kind of ['instagram', 'facebook', 'website'] as const) {
        const raw = i[kind];
        if (typeof raw !== 'string') return { ok: false, field: kind };
        const r = normalizeSocialLink(kind, raw);
        if (!r.ok) return { ok: false, field: kind };
        links[kind] = r.url;
    }
    return {
        ok: true,
        value: {
            theme: i.theme, accentId: i.accentId,
            instagramUrl: links.instagram ?? null, facebookUrl: links.facebook ?? null, websiteUrl: links.website ?? null,
        },
    };
}

export type PublicBranding = BrandingFields & { orgName: string; orgSlug: string | null; logoUrl: string | null; bannerUrl: string | null };

/** True if anything is set beyond today's look (default theme + accent, no images, no links). */
export function hasBranding(b: Omit<PublicBranding, 'orgName' | 'orgSlug'>): boolean {
    return b.theme !== DEFAULT_THEME || b.accentId !== DEFAULT_ACCENT_ID
        || !!(b.logoUrl || b.bannerUrl || b.instagramUrl || b.facebookUrl || b.websiteUrl);
}

/**
 * Whose branding a rescuer's page shows: the `?g=` hint if they belong to it
 * (a forged hint is ignored), else their chosen group. Always a member, or null.
 */
export function pickBrandingOrgId(a: { hintOrgId: string | null; memberOrgIds: readonly string[]; source: DocsSource }): string | null {
    if (a.hintOrgId && a.memberOrgIds.includes(a.hintOrgId)) return a.hintOrgId;
    if (a.source.type === 'org' && a.memberOrgIds.includes(a.source.orgId)) return a.source.orgId;
    return null;
}

/** The branding columns of an organizations row (all nullable). */
export type OrgBrandingRow = {
    name: string; slug: string | null;
    logoUrl: string | null; bannerUrl: string | null;
    brandTheme: string | null; brandAccent: string | null;
    instagramUrl: string | null; facebookUrl: string | null; websiteUrl: string | null;
};

/** A stored row as the public pages read it: NULL or unknown theme/accent → the defaults. */
export function brandingFromOrgRow(row: OrgBrandingRow): PublicBranding {
    return {
        orgName: row.name,
        orgSlug: row.slug ?? null,
        theme: isTheme(row.brandTheme) ? row.brandTheme : DEFAULT_THEME,
        accentId: isAccentId(row.brandAccent) ? row.brandAccent : DEFAULT_ACCENT_ID,
        logoUrl: row.logoUrl ?? null,
        bannerUrl: row.bannerUrl ?? null,
        instagramUrl: row.instagramUrl ?? null,
        facebookUrl: row.facebookUrl ?? null,
        websiteUrl: row.websiteUrl ?? null,
    };
}
