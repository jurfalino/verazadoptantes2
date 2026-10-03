import { describe, it, expect } from 'vitest'
import { isVideo, posterOf, firstShowable, posterUrls } from './media'

const photo = (url: string) => ({ url, mediaType: 'image' as const })
const video = (url: string, thumbnailUrl: string | null) => ({ url, mediaType: 'video' as const, thumbnailUrl })

describe('posterOf', () => {
    it('draws a photo as itself', () => {
        expect(posterOf(photo('a.jpg'))).toBe('a.jpg')
    })

    it('draws a video as its poster, never as its own URL', () => {
        // The failure this prevents: an .mp4 in an <img>, i.e. a broken frame
        // where the animal should be.
        expect(posterOf(video('v.mp4', 'v.jpg'))).toBe('v.jpg')
    })

    it('says a posterless video cannot be drawn', () => {
        expect(posterOf(video('v.mp4', null))).toBeNull()
        expect(posterOf(video('v.mp4', ''))).toBeNull()
    })

    it('treats a missing mediaType as a photo — legacy rows predate the column', () => {
        expect(posterOf({ url: 'old.jpg' })).toBe('old.jpg')
        expect(isVideo({ url: 'old.jpg' })).toBe(false)
    })
})

describe('firstShowable', () => {
    it('leads with the first photo', () => {
        expect(firstShowable([photo('a.jpg'), photo('b.jpg')])?.url).toBe('a.jpg')
    })

    it('skips past a video that has no poster', () => {
        expect(firstShowable([video('v.mp4', null), photo('b.jpg')])?.url).toBe('b.jpg')
    })

    it('uses a video when it has a poster and comes first', () => {
        expect(firstShowable([video('v.mp4', 'v.jpg'), photo('b.jpg')])?.url).toBe('v.mp4')
    })

    it('returns nothing when there is nothing to draw', () => {
        expect(firstShowable([video('v.mp4', null)])).toBeUndefined()
        expect(firstShowable([])).toBeUndefined()
    })
})

describe('posterUrls', () => {
    it('gives crawlers stills only', () => {
        // og:image and the JSON-LD `image` array: a video URL there renders a
        // broken share card on Facebook and WhatsApp.
        expect(posterUrls([photo('a.jpg'), video('v.mp4', 'v.jpg'), video('x.mp4', null)]))
            .toEqual(['a.jpg', 'v.jpg'])
    })

    it('is empty when nothing can be drawn', () => {
        expect(posterUrls([video('v.mp4', null)])).toEqual([])
    })
})
