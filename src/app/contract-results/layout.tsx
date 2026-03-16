import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Resultados del Contrato',
    description:
        'Resultados del contrato de adopción en BuenAdoptante.',
    openGraph: {
        title: 'Resultados del Contrato — BuenAdoptante',
        description:
            'Revisá los resultados del contrato de adopción y las coincidencias encontradas.',
        type: 'website',
        images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Resultados del Contrato — BuenAdoptante',
        description:
            'Revisá los resultados del contrato de adopción y las coincidencias encontradas.',
        images: ['/og-image.png'],
    },
    robots: {
        index: false,
    },
};

export default function ContractResultsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
