import type { Metadata } from 'next';

export const runtime = 'edge';

export const metadata: Metadata = {
    title: 'Política de Privacidad',
    description:
        'Cómo BuenAdoptante protege tus datos. Cumplimiento de la Ley 25.326 de Protección de Datos Personales de Argentina.',
    openGraph: {
        title: 'Política de Privacidad — BuenAdoptante',
        description:
            'Cómo protegemos los datos personales en la plataforma de verificación de adoptantes.',
        type: 'website',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/privacy',
    },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
    return children;
}
