import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Perfil de Adoptante',
    description:
        'Perfil de adoptante en BuenAdoptante. Historial de adopciones, verificaciones e información de contacto.',
    openGraph: {
        title: 'Perfil de Adoptante — BuenAdoptante',
        description:
            'Consultá el historial de adopciones y verificaciones de este adoptante.',
        type: 'website',
        images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Perfil de Adoptante — BuenAdoptante',
        description:
            'Consultá el historial de adopciones y verificaciones de este adoptante.',
        images: ['/og-image.png'],
    },
    robots: {
        index: false,
    },
};

export default function AdopterLayout({ children }: { children: React.ReactNode }) {
    return children;
}
