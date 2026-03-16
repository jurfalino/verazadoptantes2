import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Perfil de Ejemplo',
    description:
        'Mirá cómo se ve un perfil de adoptante en BuenAdoptante. Ejemplo de la información que se registra para cada adopción.',
    openGraph: {
        title: 'Perfil de Ejemplo — BuenAdoptante',
        description:
            'Ejemplo de perfil de adoptante con historial de adopciones, verificaciones e información de contacto.',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Perfil de Ejemplo — BuenAdoptante',
        description:
            'Ejemplo de perfil de adoptante con historial de adopciones, verificaciones e información de contacto.',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/demo-profile',
    },
};

export default function DemoProfileLayout({ children }: { children: React.ReactNode }) {
    return children;
}
