import type { Metadata } from 'next';

export const runtime = 'edge';

export const metadata: Metadata = {
    title: 'Términos y Condiciones',
    description:
        'Términos y condiciones de uso de BuenAdoptante. Plataforma colaborativa de verificación de adoptantes de animales.',
    openGraph: {
        title: 'Términos y Condiciones — BuenAdoptante',
        description:
            'Términos de uso de la plataforma de verificación de adoptantes de animales.',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Términos y Condiciones — BuenAdoptante',
        description:
            'Términos de uso de la plataforma de verificación de adoptantes de animales.',
    },
    alternates: {
        canonical: 'https://buenadoptante.org/terms',
    },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
