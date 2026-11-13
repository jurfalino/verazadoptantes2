import { describe, it, expect } from 'vitest'
import { withGroupHint, httpsOnly } from './brandLinks'

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
