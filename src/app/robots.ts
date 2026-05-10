import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: [
                    '/admin/',
                    '/api/',
                    '/keystatic/',
                    '/settings/',
                    '/import/',
                    '/my-adopters/',
                    '/my-adoptions/',
                    '/my-animals/',
                    '/contract/',
                    '/contract-results/',
                    '/form-results/',
                    '/invite/',
                    '/notificaciones',
                    '/organizations',
                    '/health',
                ],
            },
        ],
        sitemap: 'https://buenadoptante.org/sitemap.xml',
    }
}
