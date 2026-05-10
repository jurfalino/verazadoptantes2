import type { MetadataRoute } from 'next'

// Frozen at module-load (per build/cold-start) so we don't tell crawlers
// the sitemap "changes" on every fetch.
const LAST_MODIFIED = new Date()

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = 'https://buenadoptante.org'

    return [
        {
            url: baseUrl,
            lastModified: LAST_MODIFIED,
            changeFrequency: 'weekly',
            priority: 1,
        },
        {
            url: `${baseUrl}/guia`,
            lastModified: LAST_MODIFIED,
            changeFrequency: 'monthly',
            priority: 0.9,
        },
        {
            url: `${baseUrl}/funcionalidades`,
            lastModified: LAST_MODIFIED,
            changeFrequency: 'monthly',
            priority: 0.8,
        },
        {
            url: `${baseUrl}/guia/faq`,
            lastModified: LAST_MODIFIED,
            changeFrequency: 'monthly',
            priority: 0.7,
        },
        {
            url: `${baseUrl}/demo-profile`,
            lastModified: LAST_MODIFIED,
            changeFrequency: 'monthly',
            priority: 0.5,
        },
        {
            url: `${baseUrl}/privacy`,
            lastModified: LAST_MODIFIED,
            changeFrequency: 'yearly',
            priority: 0.3,
        },
        {
            url: `${baseUrl}/terms`,
            lastModified: LAST_MODIFIED,
            changeFrequency: 'yearly',
            priority: 0.3,
        },
    ]
}
