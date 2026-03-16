import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Funcionalidades',
    description:
        'Conocé todas las herramientas que BuenAdoptante ofrece: búsqueda de adoptantes, registro de adopciones, formularios, contratos y más.',
    openGraph: {
        title: 'Funcionalidades — BuenAdoptante',
        description:
            'Búsqueda de adoptantes, registro de adopciones, formularios y contratos. Todo gratis para refugios y rescatistas.',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Funcionalidades — BuenAdoptante',
        description:
            'Búsqueda de adoptantes, registro de adopciones, formularios y contratos. Todo gratis para refugios y rescatistas.',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/funcionalidades',
    },
};

export default function FuncionalidadesLayout({ children }: { children: React.ReactNode }) {
    return children;
}
