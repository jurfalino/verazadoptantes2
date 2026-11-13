// Group branding on the public pages. MIRROR of src/domain/groupBranding.ts
// (contract-app cannot import from src/); src/domain/groupBranding.mirror.test.ts
// keeps the palette in sync. Only the palette, types and CSS-var logic live here.

export type Theme = 'dark' | 'light'

export interface Accent {
    id: string
    name: string
    /** dark-theme shades */
    d: string; dStrong: string; dHover: string
    /** light-theme shades */
    l: string; lStrong: string; lHover: string
}

export const ACCENTS: readonly Accent[] = [
    { id: 'violeta', name: 'Violeta', d: '#818cf8', dStrong: '#a5b4fc', dHover: '#6366f1', l: '#4f46e5', lStrong: '#4338ca', lHover: '#3730a3' },
    { id: 'azul', name: 'Azul', d: '#60a5fa', dStrong: '#93c5fd', dHover: '#3b82f6', l: '#2563eb', lStrong: '#1d4ed8', lHover: '#1e40af' },
    { id: 'turquesa', name: 'Turquesa', d: '#2dd4bf', dStrong: '#5eead4', dHover: '#14b8a6', l: '#0f766e', lStrong: '#115e59', lHover: '#134e4a' },
    { id: 'verde', name: 'Verde', d: '#4ade80', dStrong: '#86efac', dHover: '#22c55e', l: '#15803d', lStrong: '#166534', lHover: '#14532d' },
    { id: 'naranja', name: 'Naranja', d: '#fb923c', dStrong: '#fdba74', dHover: '#f97316', l: '#c2410c', lStrong: '#9a3412', lHover: '#7c2d12' },
    { id: 'rosa', name: 'Rosa', d: '#f472b6', dStrong: '#f9a8d4', dHover: '#ec4899', l: '#be185d', lStrong: '#9d174d', lHover: '#831843' },
    { id: 'ambar', name: 'Ámbar', d: '#fbbf24', dStrong: '#fcd34d', dHover: '#f59e0b', l: '#b45309', lStrong: '#92400e', lHover: '#78350f' },
    { id: 'grafito', name: 'Grafito', d: '#cbd5e1', dStrong: '#e2e8f0', dHover: '#94a3b8', l: '#334155', lStrong: '#1e293b', lHover: '#0f172a' },
]

/** Shape returned by the API (`branding` on form / showcase / contract responses). */
export interface PublicBranding {
    orgName: string
    orgSlug: string | null
    theme: Theme
    accentId: string
    logoUrl: string | null
    bannerUrl: string | null
    instagramUrl: string | null
    facebookUrl: string | null
    websiteUrl: string | null
}

const VAR_NAMES = [
    '--ps-accent', '--ps-accent-strong', '--ps-accent-hover', '--ps-text-accent',
    '--ps-accent-glow-rgb', '--ps-accent-tint-rgb', '--ps-on-accent',
] as const

function rgb(hex: string): string {
    const n = parseInt(hex.slice(1), 16)
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

export function brandingCssVars(b: PublicBranding): Record<string, string> {
    const a = ACCENTS.find(x => x.id === b.accentId) ?? ACCENTS[0]
    const light = b.theme === 'light'
    const accent = light ? a.l : a.d
    return {
        '--ps-accent': accent,
        '--ps-accent-strong': light ? a.lStrong : a.dStrong,
        '--ps-accent-hover': light ? a.lHover : a.dHover,
        '--ps-text-accent': light ? a.lStrong : a.dStrong,
        '--ps-accent-glow-rgb': rgb(accent),
        // Washes/badges used indigo-500 (= violeta dHover); keep that relation per accent.
        '--ps-accent-tint-rgb': rgb(light ? a.l : a.dHover),
        '--ps-on-accent': light ? '#ffffff' : '#0f172a',
    }
}

/** null ⇒ today's look: removes the theme attribute and every var we set. */
export function applyBranding(b: PublicBranding | null, root: HTMLElement = document.documentElement): void {
    if (!b) {
        root.removeAttribute('data-ps-theme')
        for (const k of VAR_NAMES) root.style.removeProperty(k)
        return
    }
    root.setAttribute('data-ps-theme', b.theme)
    for (const [k, v] of Object.entries(brandingCssVars(b))) root.style.setProperty(k, v)
}

const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'

/** Accepts exactly the API shape; anything malformed (unknown accent/theme, wrong types, missing fields) → null. */
export function parseBranding(raw: unknown): PublicBranding | null {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    if (r.theme !== 'dark' && r.theme !== 'light') return null
    if (typeof r.accentId !== 'string' || !ACCENTS.some(a => a.id === r.accentId)) return null
    if (typeof r.orgName !== 'string') return null
    for (const k of ['orgSlug', 'logoUrl', 'bannerUrl', 'instagramUrl', 'facebookUrl', 'websiteUrl']) {
        if (!(k in r) || !strOrNull(r[k])) return null
    }
    return {
        orgName: r.orgName, orgSlug: r.orgSlug as string | null, theme: r.theme, accentId: r.accentId,
        logoUrl: r.logoUrl as string | null, bannerUrl: r.bannerUrl as string | null,
        instagramUrl: r.instagramUrl as string | null, facebookUrl: r.facebookUrl as string | null,
        websiteUrl: r.websiteUrl as string | null,
    }
}
