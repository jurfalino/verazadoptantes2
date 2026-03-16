import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Guía de Adopción Responsable',
    description:
        '6 fases para verificar adoptantes de animales y garantizar adopciones responsables. Guía completa de la comunidad rescatista.',
    openGraph: {
        title: 'Guía de Adopción Responsable — BuenAdoptante',
        description:
            '6 fases para verificar adoptantes de animales y garantizar adopciones responsables.',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Guía de Adopción Responsable — BuenAdoptante',
        description:
            '6 fases para verificar adoptantes de animales y garantizar adopciones responsables.',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/guia',
    },
};

export default function GuiaLayout({ children }: { children: React.ReactNode }) {
    return children;
}
