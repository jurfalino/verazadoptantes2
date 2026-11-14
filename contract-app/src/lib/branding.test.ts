import { describe, it, expect } from 'vitest'
import { ACCENTS, brandingCssVars, applyBranding, parseBranding, type PublicBranding } from './branding'

const base = { orgName: 'X', orgSlug: null, logoUrl: null, bannerUrl: null, instagramUrl: null, facebookUrl: null, websiteUrl: null }
const mk = (theme: 'dark' | 'light', accentId: string) => ({ ...base, theme, accentId }) as unknown as PublicBranding

describe('brandingCssVars', () => {
    it('light naranja', () => {
        const v = brandingCssVars(mk('light', 'naranja'))
        expect(v['--ps-accent']).toBe('#c2410c')
        expect(v['--ps-on-accent']).toBe('#ffffff')
        expect(v['--ps-accent-glow-rgb']).toBe('194, 65, 12')
    })
    it('dark naranja', () => {
        const v = brandingCssVars(mk('dark', 'naranja'))
        expect(v['--ps-accent']).toBe('#fb923c')
        expect(v['--ps-on-accent']).toBe('#0f172a')
        expect(v['--ps-accent-strong']).toBe('#fdba74')
        expect(v['--ps-accent-hover']).toBe('#f97316')
        expect(v['--ps-text-accent']).toBe('#fdba74')
    })
    it('dark violeta tint equals the stylesheet default', () => {
        expect(brandingCssVars(mk('dark', 'violeta'))['--ps-accent-tint-rgb']).toBe('99, 102, 241')
    })
})

describe('parseBranding', () => {
    const ok = { ...base, theme: 'light', accentId: 'azul' }
    it('accepts the API shape', () => expect(parseBranding(ok)).toEqual(ok))
    it('rejects unknown accent / theme / bad types / missing fields / non-objects', () => {
        expect(parseBranding({ ...ok, accentId: 'oro' })).toBeNull()
        expect(parseBranding({ ...ok, theme: 'sepia' })).toBeNull()
        expect(parseBranding({ ...ok, orgName: 5 })).toBeNull()
        expect(parseBranding({ ...ok, logoUrl: 3 })).toBeNull()
        expect(parseBranding({ theme: 'light', accentId: 'oro' })).toBeNull()
        const { websiteUrl: _w, ...missing } = ok
        expect(parseBranding(missing)).toBeNull()
        expect(parseBranding(null)).toBeNull()
        expect(parseBranding('x')).toBeNull()
        expect(parseBranding(undefined)).toBeNull()
    })
})

describe('applyBranding', () => {
    const fakeRoot = () => {
        const attrs = new Map<string, string>(), props = new Map<string, string>()
        return {
            attrs, props,
            setAttribute: (k: string, v: string) => attrs.set(k, v),
            removeAttribute: (k: string) => attrs.delete(k),
            style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) },
        }
    }
    it('sets then clears theme and vars', () => {
        const r = fakeRoot()
        applyBranding(mk('light', 'rosa'), r as unknown as HTMLElement)
        expect(r.attrs.get('data-ps-theme')).toBe('light')
        expect(r.props.get('--ps-accent')).toBe('#be185d')
        applyBranding(null, r as unknown as HTMLElement)
        expect(r.attrs.size).toBe(0)
        expect(r.props.size).toBe(0)
    })
    it('palette has 8 accents', () => expect(ACCENTS).toHaveLength(8))
})
