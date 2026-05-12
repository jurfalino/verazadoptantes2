import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Quiénes Somos',
    description:
        'Guardianes del Mañana — la red de verificación de adopciones que nació en Belice para proteger a los animales en todo el mundo. Fundada por Jose Castillo y John Usher.',
    openGraph: {
        title: 'Quiénes Somos — Guardianes del Mañana',
        description:
            'Una red global de verificación de adopciones, nacida en Belice. Que ninguna adopción sea a ciegas.',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Quiénes Somos — Guardianes del Mañana',
        description:
            'Una red global de verificación de adopciones, nacida en Belice. Que ninguna adopción sea a ciegas.',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/quienes-somos',
    },
};

export default function QuienesSomosLayout({ children }: { children: React.ReactNode }) {
    return children;
}
