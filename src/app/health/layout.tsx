import type { Metadata } from 'next';

export const runtime = 'edge';

export const metadata: Metadata = {
    title: 'Estado del Sistema',
    description:
        'Estado en tiempo real de los servicios de BuenAdoptante: plataforma, contratos y extracción con IA.',
    openGraph: {
        title: 'Estado del Sistema — BuenAdoptante',
        description:
            'Monitoreo en tiempo real del estado operativo de todos los servicios de BuenAdoptante.',
        type: 'website',
    },
    twitter: {
        card: 'summary',
        title: 'Estado del Sistema — BuenAdoptante',
        description:
            'Monitoreo en tiempo real del estado operativo de todos los servicios de BuenAdoptante.',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/health',
    },
};

export default function HealthLayout({ children }: { children: React.ReactNode }) {
    return children;
}
