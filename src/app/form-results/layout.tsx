import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Resultados del Formulario',
    description:
        'Resultados del formulario de adopción en BuenAdoptante.',
    openGraph: {
        title: 'Resultados del Formulario — BuenAdoptante',
        description:
            'Revisá las respuestas del formulario de adopción y las coincidencias encontradas.',
        type: 'website',
        images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Resultados del Formulario — BuenAdoptante',
        description:
            'Revisá las respuestas del formulario de adopción y las coincidencias encontradas.',
        images: ['/og-image.png'],
    },
    robots: {
        index: false,
    },
};

export default function FormResultsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
