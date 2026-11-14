import { describe, it, expect } from 'vitest'
import { withGroupHint, httpsOnly, followInstagramUrl, shownPublisher } from './brandLinks'

describe('withGroupHint', () => {
    it('appends g to an existing query', () => {
        expect(withGroupHint('/animal/abc?lang=en', 'refugio')).toBe('/animal/abc?lang=en&g=refugio')
    })
    it('starts a query when there is none', () => {
        expect(withGroupHint('/animal/abc', 'refugio')).toBe('/animal/abc?g=refugio')
    })
    it('leaves the href alone without a slug', () => {
        expect(withGroupHint('/form?u=1', null)).toBe('/form?u=1')
        expect(withGroupHint('/form?u=1', '')).toBe('/form?u=1')
    })
    it('encodes the slug', () => {
        expect(withGroupHint('/animal/abc', 'a b&c')).toBe('/animal/abc?g=a%20b%26c')
    })
    it('keeps a hash at the end', () => {
        expect(withGroupHint('/animal/abc?lang=pt#top', 'refugio')).toBe('/animal/abc?lang=pt&g=refugio#top')
    })
})

describe('httpsOnly', () => {
    it('keeps https URLs', () => {
        expect(httpsOnly('https://instagram.com/refugio')).toBe('https://instagram.com/refugio')
    })
    it('drops anything that is not https', () => {
        expect(httpsOnly('http://example.com')).toBeNull()
        expect(httpsOnly('javascript:alert(1)')).toBeNull()
        expect(httpsOnly('data:image/png;base64,AAAA')).toBeNull()
        expect(httpsOnly('//example.com/x.png')).toBeNull()
        expect(httpsOnly('not a url')).toBeNull()
        expect(httpsOnly('')).toBeNull()
        expect(httpsOnly(null)).toBeNull()
    })
})

describe('followInstagramUrl', () => {
    const platform = 'https://instagram.com/buenadoptante'
    it("prefers the group's Instagram when branded", () => {
        expect(followInstagramUrl({ instagramUrl: 'https://instagram.com/refugio' }, platform)).toBe('https://instagram.com/refugio')
    })
    it("falls back to the platform's when the group has none (or a non-https one)", () => {
        expect(followInstagramUrl({ instagramUrl: null }, platform)).toBe(platform)
        expect(followInstagramUrl({ instagramUrl: 'javascript:alert(1)' }, platform)).toBe(platform)
    })
    it("uses the platform's when unbranded", () => {
        expect(followInstagramUrl(null, platform)).toBe(platform)
    })
    it('is null when neither is set', () => {
        expect(followInstagramUrl(null, '')).toBeNull()
        expect(followInstagramUrl({ instagramUrl: null }, undefined)).toBeNull()
    })
})

// The canonical shapes the dashboard stores (src/domain/groupBranding.ts normalizeSocialLink) render unchanged.
describe('stored link shapes round-trip to the public page', () => {
    const stored = [
        'https://instagram.com/michis.del_tren',
        'https://facebook.com/michis.del.tren',
        'https://facebook.com/profile.php?id=100083123456789',
        'https://facebook.com/people/Refugio-Gat%C3%ADtos/100083123456789',
        'https://facebook.com/pages/category/Nonprofit/Refugio-123456',
        'https://facebook.com/groups/refugiogatitos',
        'https://facebook.com/share/1AbCdEf',
        'https://facebook.com/share/g/1AbCdEf',
        'https://michisdeltren.org/adopta?x=1',
    ]
    it('httpsOnly keeps every stored link as is', () => {
        for (const url of stored) expect(httpsOnly(url), url).toBe(url)
    })
    it("followInstagramUrl uses the group's stored Instagram as is", () => {
        expect(followInstagramUrl({ instagramUrl: stored[0] }, 'https://instagram.com/buenadoptante')).toBe(stored[0])
    })
})

describe('shownPublisher', () => {
    const rescuer = { displayName: 'Ana', orgName: 'Grupo Y', orgSlug: 'grupo-y', userHandle: 'ana' }
    it('a branded page (hint accepted) names the group whose look it wears, with its back link', () => {
        expect(shownPublisher(rescuer, { orgName: 'Grupo X', orgSlug: 'grupo-x' })).toEqual({ label: 'Grupo X', orgSlug: 'grupo-x', userHandle: null })
    })
    it("unbranded → the poster's group as the API sent it", () => {
        expect(shownPublisher(rescuer, null)).toEqual({ label: 'Grupo Y', orgSlug: 'grupo-y', userHandle: 'ana' })
    })
    it('branding without a slug falls back to the API value; no group → the poster and their handle', () => {
        expect(shownPublisher(rescuer, { orgName: 'Grupo X', orgSlug: null })).toEqual({ label: 'Grupo Y', orgSlug: 'grupo-y', userHandle: 'ana' })
        expect(shownPublisher({ displayName: 'Ana', userHandle: 'ana' }, null)).toEqual({ label: 'Ana', orgSlug: null, userHandle: 'ana' })
    })
})
